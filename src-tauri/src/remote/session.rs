use crate::error::AppError;
use crate::remote::ssh::{
    build_ssh_serve_args, configure_password_auth_for_tokio, normalize_remote_stderr,
};
use crate::remote::types::{
    RemoteCommandError, RemoteConnectionSecret, RemoteHostProfile, RemoteSessionState,
    RemoteSessionStatus,
};
use once_cell::sync::Lazy;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;

// Tool installs and upgrades can legitimately take several minutes on remote
// servers. Timing out the helper session also tears down any in-process remote
// routing runtime, so keep this higher than normal UI request timeouts.
const REMOTE_SESSION_REQUEST_TIMEOUT: Duration = Duration::from_secs(15 * 60);

static REMOTE_SESSION_MANAGER: Lazy<RemoteSessionManager> =
    Lazy::new(RemoteSessionManager::default);

pub fn remote_session_manager() -> &'static RemoteSessionManager {
    &REMOTE_SESSION_MANAGER
}

#[cfg(unix)]
type PasswordAuthGuard = tempfile::TempPath;

#[cfg(not(unix))]
type PasswordAuthGuard = ();

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteSessionRequestLine<'a> {
    id: &'a str,
    command: &'a [String],
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSessionResponseLine {
    pub id: String,
    pub ok: bool,
    pub data: Option<Value>,
    pub error: Option<RemoteCommandError>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RemoteSessionError {
    InvalidJson(String),
    MissingData,
    CommandFailed(RemoteCommandError),
    Transport(String),
    Io(String),
    Timeout,
    Closed,
}

impl std::fmt::Display for RemoteSessionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidJson(message) => {
                write!(f, "Remote session returned invalid JSON: {message}")
            }
            Self::MissingData => write!(f, "Remote session returned ok without data"),
            Self::CommandFailed(error) => write!(f, "{}: {}", error.code, error.message),
            Self::Transport(message) => write!(f, "{message}"),
            Self::Io(message) => write!(f, "Remote session I/O failed: {message}"),
            Self::Timeout => write!(f, "Remote session command timed out"),
            Self::Closed => write!(
                f,
                "Remote helper session closed before returning a response"
            ),
        }
    }
}

impl std::error::Error for RemoteSessionError {}

pub fn parse_session_response_line(
    line: &str,
) -> Result<RemoteSessionResponseLine, RemoteSessionError> {
    serde_json::from_str(line).map_err(|error| RemoteSessionError::InvalidJson(error.to_string()))
}

pub fn build_session_request_line(
    id: &str,
    command: &[String],
) -> Result<String, RemoteSessionError> {
    serde_json::to_string(&RemoteSessionRequestLine { id, command })
        .map_err(|error| RemoteSessionError::InvalidJson(error.to_string()))
}

#[derive(Default)]
pub struct RemoteSessionManager {
    sessions: Arc<Mutex<HashMap<String, ManagedRemoteSession>>>,
}

struct ManagedRemoteSession {
    identity: Option<RemoteSessionIdentity>,
    status: RemoteSessionStatus,
    executor: Option<Arc<dyn RemoteSessionExecutor>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct RemoteSessionIdentity {
    profile_id: String,
    host: String,
    port: u16,
    username: String,
    auth_method: crate::remote::types::RemoteAuthMethod,
    helper_path: String,
    password_fingerprint: Option<[u8; 32]>,
}

impl RemoteSessionIdentity {
    fn new(profile: &RemoteHostProfile, secret: Option<&RemoteConnectionSecret>) -> Self {
        Self {
            profile_id: profile.id.clone(),
            host: profile.host.clone(),
            port: profile.port,
            username: profile.username.clone(),
            auth_method: profile.auth_method.clone(),
            helper_path: profile.helper_path.clone(),
            password_fingerprint: secret
                .and_then(|value| value.password.as_deref())
                .map(|password| Sha256::digest(password.as_bytes()).into()),
        }
    }
}

trait RemoteSessionExecutor: Send + Sync {
    fn execute<'a>(
        &'a self,
        request_id: &'a str,
        command: &'a [String],
    ) -> Pin<Box<dyn Future<Output = Result<Value, RemoteSessionError>> + Send + 'a>>;

    fn close<'a>(&'a self) -> Pin<Box<dyn Future<Output = ()> + Send + 'a>>;
}

impl RemoteSessionManager {
    pub async fn status(&self, profile_id: &str) -> RemoteSessionStatus {
        self.sessions
            .lock()
            .await
            .get(profile_id)
            .map(|session| session.status.clone())
            .unwrap_or(RemoteSessionStatus {
                profile_id: profile_id.to_string(),
                state: RemoteSessionState::Idle,
                last_error: None,
                active_request_id: None,
            })
    }

    #[allow(dead_code)]
    pub(crate) async fn set_status(&self, status: RemoteSessionStatus) {
        let mut sessions = self.sessions.lock().await;
        sessions
            .entry(status.profile_id.clone())
            .and_modify(|session| session.status = status.clone())
            .or_insert(ManagedRemoteSession {
                identity: None,
                status,
                executor: None,
            });
    }

    pub async fn close(&self, profile_id: &str) -> bool {
        let session = self.sessions.lock().await.remove(profile_id);
        if let Some(session) = session {
            if let Some(executor) = session.executor {
                executor.close().await;
            }
            true
        } else {
            false
        }
    }

    pub async fn execute_json<T>(
        &self,
        profile: RemoteHostProfile,
        secret: Option<RemoteConnectionSecret>,
        helper_args: Vec<String>,
    ) -> Result<T, AppError>
    where
        T: DeserializeOwned + Send + 'static,
    {
        let value = self.execute_value(profile, secret, helper_args).await?;
        serde_json::from_value(value).map_err(|error| {
            AppError::Message(format!("Remote session returned invalid data: {error}"))
        })
    }

    async fn execute_value(
        &self,
        profile: RemoteHostProfile,
        secret: Option<RemoteConnectionSecret>,
        helper_args: Vec<String>,
    ) -> Result<Value, AppError> {
        let request_id = uuid::Uuid::new_v4().to_string();
        self.set_status(RemoteSessionStatus {
            profile_id: profile.id.clone(),
            state: RemoteSessionState::Connecting,
            last_error: None,
            active_request_id: Some(request_id.clone()),
        })
        .await;

        let executor = self
            .get_or_start_executor(&profile, secret.as_ref())
            .await?;
        self.set_status(RemoteSessionStatus {
            profile_id: profile.id.clone(),
            state: RemoteSessionState::Busy,
            last_error: None,
            active_request_id: Some(request_id.clone()),
        })
        .await;

        let session_result = tokio::time::timeout(
            REMOTE_SESSION_REQUEST_TIMEOUT,
            executor.execute(&request_id, &helper_args),
        )
        .await
        .unwrap_or(Err(RemoteSessionError::Timeout));

        match &session_result {
            Ok(_) => {
                self.set_status(RemoteSessionStatus {
                    profile_id: profile.id.clone(),
                    state: RemoteSessionState::Ready,
                    last_error: None,
                    active_request_id: None,
                })
                .await;
            }
            Err(error) => {
                let failed_status = RemoteSessionStatus {
                    profile_id: profile.id.clone(),
                    state: RemoteSessionState::Failed,
                    last_error: Some(error.to_string()),
                    active_request_id: None,
                };

                if should_drop_executor_after_error(error) {
                    let mut sessions = self.sessions.lock().await;
                    sessions.insert(
                        profile.id.clone(),
                        ManagedRemoteSession {
                            identity: Some(RemoteSessionIdentity::new(&profile, secret.as_ref())),
                            status: failed_status,
                            executor: None,
                        },
                    );
                } else {
                    self.set_status(failed_status).await;
                }
            }
        }

        session_result.map_err(|error| AppError::Message(error.to_string()))
    }

    async fn get_or_start_executor(
        &self,
        profile: &RemoteHostProfile,
        secret: Option<&RemoteConnectionSecret>,
    ) -> Result<Arc<dyn RemoteSessionExecutor>, AppError> {
        let identity = RemoteSessionIdentity::new(profile, secret);
        if let Some(executor) = self.take_reusable_executor(&identity).await {
            return Ok(executor);
        }

        self.set_status(RemoteSessionStatus {
            profile_id: profile.id.clone(),
            state: RemoteSessionState::Connecting,
            last_error: None,
            active_request_id: None,
        })
        .await;

        let process = RemoteSessionProcess::start(profile, secret).await?;
        let executor: Arc<dyn RemoteSessionExecutor> = Arc::new(Mutex::new(process));
        let mut sessions = self.sessions.lock().await;
        sessions.insert(
            profile.id.clone(),
            ManagedRemoteSession {
                identity: Some(identity),
                status: RemoteSessionStatus {
                    profile_id: profile.id.clone(),
                    state: RemoteSessionState::Ready,
                    last_error: None,
                    active_request_id: None,
                },
                executor: Some(executor.clone()),
            },
        );
        Ok(executor)
    }

    async fn take_reusable_executor(
        &self,
        identity: &RemoteSessionIdentity,
    ) -> Option<Arc<dyn RemoteSessionExecutor>> {
        let stale_session = {
            let mut sessions = self.sessions.lock().await;
            if let Some(session) = sessions.get(&identity.profile_id) {
                if session.identity.as_ref() == Some(identity) {
                    return session.executor.clone();
                }
            }
            sessions.remove(&identity.profile_id)
        };

        if let Some(executor) = stale_session.and_then(|session| session.executor) {
            executor.close().await;
        }
        None
    }
}

fn should_drop_executor_after_error(error: &RemoteSessionError) -> bool {
    matches!(
        error,
        RemoteSessionError::InvalidJson(_)
            | RemoteSessionError::Transport(_)
            | RemoteSessionError::Io(_)
            | RemoteSessionError::Timeout
            | RemoteSessionError::Closed
    )
}

struct RemoteSessionProcess {
    profile: RemoteHostProfile,
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    stderr: BufReader<ChildStderr>,
    _askpass: Option<PasswordAuthGuard>,
}

impl RemoteSessionProcess {
    async fn start(
        profile: &RemoteHostProfile,
        secret: Option<&RemoteConnectionSecret>,
    ) -> Result<Self, AppError> {
        let mut command = Command::new("ssh");
        command.args(build_ssh_serve_args(profile));
        let askpass = configure_password_auth_for_tokio(profile, secret, &mut command)?;
        command.stdin(Stdio::piped());
        command.stdout(Stdio::piped());
        command.stderr(Stdio::piped());

        let mut child = command.spawn().map_err(|error| {
            AppError::Message(format!("Failed to start remote helper session: {error}"))
        })?;

        let stdin = child.stdin.take().ok_or_else(|| {
            AppError::Message("Remote helper session stdin unavailable".to_string())
        })?;
        let stdout = child.stdout.take().ok_or_else(|| {
            AppError::Message("Remote helper session stdout unavailable".to_string())
        })?;
        let stderr = child.stderr.take().ok_or_else(|| {
            AppError::Message("Remote helper session stderr unavailable".to_string())
        })?;

        Ok(Self {
            profile: profile.clone(),
            child,
            stdin,
            stdout: BufReader::new(stdout),
            stderr: BufReader::new(stderr),
            _askpass: askpass,
        })
    }

    async fn read_transport_error(&mut self, fallback: impl Into<String>) -> RemoteSessionError {
        let mut stderr = String::new();
        if tokio::time::timeout(
            Duration::from_millis(500),
            self.stderr.read_to_string(&mut stderr),
        )
        .await
        .ok()
        .and_then(Result::ok)
        .unwrap_or(0)
            > 0
        {
            let stderr = stderr.trim();
            if !stderr.is_empty() {
                return RemoteSessionError::Transport(normalize_remote_stderr(
                    &self.profile,
                    stderr,
                ));
            }
        }

        RemoteSessionError::Io(fallback.into())
    }

    async fn execute_value(
        &mut self,
        request_id: &str,
        command: &[String],
    ) -> Result<Value, RemoteSessionError> {
        let mut request = build_session_request_line(request_id, command)?;
        request.push('\n');
        if let Err(error) = self.stdin.write_all(request.as_bytes()).await {
            return Err(self.read_transport_error(error.to_string()).await);
        }
        if let Err(error) = self.stdin.flush().await {
            return Err(self.read_transport_error(error.to_string()).await);
        }

        let mut line = String::new();
        let read = self
            .stdout
            .read_line(&mut line)
            .await
            .map_err(|error| RemoteSessionError::Io(error.to_string()))?;
        if read == 0 {
            return Err(self
                .read_transport_error("Remote helper session closed before returning a response")
                .await);
        }

        let response = parse_session_response_line(line.trim())?;
        if response.id != request_id {
            return Err(RemoteSessionError::Io(format!(
                "Remote session response id mismatch: expected {request_id}, got {}",
                response.id
            )));
        }
        if response.ok {
            Ok(response.data.unwrap_or(Value::Null))
        } else {
            Err(RemoteSessionError::CommandFailed(response.error.unwrap_or(
                RemoteCommandError {
                    code: "remote_error".to_string(),
                    message: "Remote helper command failed".to_string(),
                },
            )))
        }
    }
}

impl RemoteSessionExecutor for Mutex<RemoteSessionProcess> {
    fn execute<'a>(
        &'a self,
        request_id: &'a str,
        command: &'a [String],
    ) -> Pin<Box<dyn Future<Output = Result<Value, RemoteSessionError>> + Send + 'a>> {
        Box::pin(async move { self.lock().await.execute_value(request_id, command).await })
    }

    fn close<'a>(&'a self) -> Pin<Box<dyn Future<Output = ()> + Send + 'a>> {
        Box::pin(async move {
            let mut process = self.lock().await;
            let _ = process.child.kill().await;
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    struct FakeExecutor {
        response: Result<Value, RemoteSessionError>,
        execute_count: Arc<AtomicUsize>,
        closed: Arc<AtomicBool>,
    }

    impl FakeExecutor {
        fn new(response: Value) -> Self {
            Self {
                response: Ok(response),
                execute_count: Arc::new(AtomicUsize::new(0)),
                closed: Arc::new(AtomicBool::new(false)),
            }
        }

        fn failing(error: RemoteSessionError) -> Self {
            Self {
                response: Err(error),
                execute_count: Arc::new(AtomicUsize::new(0)),
                closed: Arc::new(AtomicBool::new(false)),
            }
        }
    }

    impl RemoteSessionExecutor for FakeExecutor {
        fn execute<'a>(
            &'a self,
            _request_id: &'a str,
            _command: &'a [String],
        ) -> Pin<Box<dyn Future<Output = Result<Value, RemoteSessionError>> + Send + 'a>> {
            Box::pin(async move {
                self.execute_count.fetch_add(1, Ordering::SeqCst);
                self.response.clone()
            })
        }

        fn close<'a>(&'a self) -> Pin<Box<dyn Future<Output = ()> + Send + 'a>> {
            Box::pin(async move {
                self.closed.store(true, Ordering::SeqCst);
            })
        }
    }

    fn profile() -> RemoteHostProfile {
        RemoteHostProfile {
            id: "prod".to_string(),
            name: "Production".to_string(),
            host: "example.com".to_string(),
            port: 22,
            username: "ccswitch".to_string(),
            auth_method: crate::remote::types::RemoteAuthMethod::SshAgent,
            helper_path: "/usr/local/bin/cc-switch-helper".to_string(),
            created_at: 1,
            updated_at: 1,
        }
    }

    #[test]
    fn transport_error_display_uses_user_facing_message_without_io_prefix() {
        let error = RemoteSessionError::Transport("远程主机密钥已变更".to_string());

        assert_eq!(error.to_string(), "远程主机密钥已变更");
    }

    #[tokio::test]
    async fn execute_json_reuses_existing_executor() {
        let manager = RemoteSessionManager::default();
        let executor = Arc::new(FakeExecutor::new(serde_json::json!({"value": 42})));
        manager.sessions.lock().await.insert(
            "prod".to_string(),
            ManagedRemoteSession {
                identity: Some(RemoteSessionIdentity::new(&profile(), None)),
                status: RemoteSessionStatus {
                    profile_id: "prod".to_string(),
                    state: RemoteSessionState::Ready,
                    last_error: None,
                    active_request_id: None,
                },
                executor: Some(executor.clone()),
            },
        );

        let value: Value = manager
            .execute_json(profile(), None, vec!["status".to_string()])
            .await
            .expect("session value");

        assert_eq!(value, serde_json::json!({"value": 42}));
        assert_eq!(executor.execute_count.load(Ordering::SeqCst), 1);
        assert_eq!(
            manager.status("prod").await.state,
            RemoteSessionState::Ready
        );
    }

    #[tokio::test]
    async fn ok_without_data_deserializes_as_unit() {
        let manager = RemoteSessionManager::default();
        let executor = Arc::new(FakeExecutor::new(Value::Null));
        manager.sessions.lock().await.insert(
            "prod".to_string(),
            ManagedRemoteSession {
                identity: Some(RemoteSessionIdentity::new(&profile(), None)),
                status: RemoteSessionStatus {
                    profile_id: "prod".to_string(),
                    state: RemoteSessionState::Ready,
                    last_error: None,
                    active_request_id: None,
                },
                executor: Some(executor.clone()),
            },
        );

        manager
            .execute_json::<()>(
                profile(),
                None,
                vec![
                    "routing-config".to_string(),
                    "auto-failover".to_string(),
                    "set".to_string(),
                ],
            )
            .await
            .expect("unit command should accept ok without data");

        assert_eq!(executor.execute_count.load(Ordering::SeqCst), 1);
        assert_eq!(
            manager.status("prod").await.state,
            RemoteSessionState::Ready
        );
    }

    #[tokio::test]
    async fn close_existing_session_closes_executor() {
        let manager = RemoteSessionManager::default();
        let executor = Arc::new(FakeExecutor::new(Value::Null));
        manager.sessions.lock().await.insert(
            "prod".to_string(),
            ManagedRemoteSession {
                identity: Some(RemoteSessionIdentity::new(&profile(), None)),
                status: RemoteSessionStatus {
                    profile_id: "prod".to_string(),
                    state: RemoteSessionState::Ready,
                    last_error: None,
                    active_request_id: None,
                },
                executor: Some(executor.clone()),
            },
        );

        assert!(manager.close("prod").await);
        assert!(executor.closed.load(Ordering::SeqCst));
        assert_eq!(manager.status("prod").await.state, RemoteSessionState::Idle);
    }

    #[tokio::test]
    async fn command_failed_error_preserves_executor() {
        let manager = RemoteSessionManager::default();
        let executor = Arc::new(FakeExecutor::failing(RemoteSessionError::CommandFailed(
            RemoteCommandError {
                code: "tools_lifecycle_failed".to_string(),
                message: "npm failed".to_string(),
            },
        )));
        manager.sessions.lock().await.insert(
            "prod".to_string(),
            ManagedRemoteSession {
                identity: Some(RemoteSessionIdentity::new(&profile(), None)),
                status: RemoteSessionStatus {
                    profile_id: "prod".to_string(),
                    state: RemoteSessionState::Ready,
                    last_error: None,
                    active_request_id: None,
                },
                executor: Some(executor.clone()),
            },
        );

        let error = manager
            .execute_json::<Value>(profile(), None, vec!["tools".to_string()])
            .await
            .expect_err("command failure should surface");

        assert!(error.to_string().contains("tools_lifecycle_failed"));
        assert_eq!(
            manager.status("prod").await.state,
            RemoteSessionState::Failed
        );

        assert!(manager.close("prod").await);
        assert!(executor.closed.load(Ordering::SeqCst));
    }

    #[test]
    fn connection_identity_covers_every_ssh_input_without_storing_the_password() {
        let original_profile = profile();
        let original_secret = RemoteConnectionSecret {
            password: Some("old-password".to_string()),
        };
        let original = RemoteSessionIdentity::new(&original_profile, Some(&original_secret));

        let renamed = RemoteHostProfile {
            name: "Renamed".to_string(),
            updated_at: 2,
            ..original_profile.clone()
        };
        assert_eq!(
            original,
            RemoteSessionIdentity::new(&renamed, Some(&original_secret))
        );

        let mut variants = Vec::new();
        variants.push(RemoteHostProfile {
            host: "other.example.com".to_string(),
            ..original_profile.clone()
        });
        variants.push(RemoteHostProfile {
            port: 2222,
            ..original_profile.clone()
        });
        variants.push(RemoteHostProfile {
            username: "other-user".to_string(),
            ..original_profile.clone()
        });
        variants.push(RemoteHostProfile {
            helper_path: "/opt/cc-switch-remote-helper".to_string(),
            ..original_profile.clone()
        });
        variants.push(RemoteHostProfile {
            auth_method: crate::remote::types::RemoteAuthMethod::KeyFile {
                path: "/tmp/id_ed25519".to_string(),
            },
            ..original_profile.clone()
        });
        for variant in variants {
            assert_ne!(
                original,
                RemoteSessionIdentity::new(&variant, Some(&original_secret))
            );
        }

        let changed_secret = RemoteConnectionSecret {
            password: Some("new-password".to_string()),
        };
        assert_ne!(
            original,
            RemoteSessionIdentity::new(&original_profile, Some(&changed_secret))
        );
        assert!(!format!("{original:?}").contains("old-password"));
    }

    #[tokio::test]
    async fn changed_connection_identity_closes_and_removes_the_old_executor() {
        let manager = RemoteSessionManager::default();
        let executor = Arc::new(FakeExecutor::new(Value::Null));
        let original_profile = profile();
        manager.sessions.lock().await.insert(
            original_profile.id.clone(),
            ManagedRemoteSession {
                identity: Some(RemoteSessionIdentity::new(&original_profile, None)),
                status: RemoteSessionStatus {
                    profile_id: original_profile.id.clone(),
                    state: RemoteSessionState::Ready,
                    last_error: None,
                    active_request_id: None,
                },
                executor: Some(executor.clone()),
            },
        );
        let changed_profile = RemoteHostProfile {
            host: "replacement.example.com".to_string(),
            ..original_profile
        };

        let reusable = manager
            .take_reusable_executor(&RemoteSessionIdentity::new(&changed_profile, None))
            .await;

        assert!(reusable.is_none());
        assert!(executor.closed.load(Ordering::SeqCst));
        assert_eq!(manager.status("prod").await.state, RemoteSessionState::Idle);
    }

    #[tokio::test]
    async fn equivalent_connection_identity_reuses_the_executor() {
        let manager = RemoteSessionManager::default();
        let executor = Arc::new(FakeExecutor::new(Value::Null));
        let original_profile = profile();
        manager.sessions.lock().await.insert(
            original_profile.id.clone(),
            ManagedRemoteSession {
                identity: Some(RemoteSessionIdentity::new(&original_profile, None)),
                status: RemoteSessionStatus {
                    profile_id: original_profile.id.clone(),
                    state: RemoteSessionState::Ready,
                    last_error: None,
                    active_request_id: None,
                },
                executor: Some(executor.clone()),
            },
        );
        let equivalent_profile = RemoteHostProfile {
            name: "Renamed only".to_string(),
            updated_at: 9,
            ..original_profile
        };

        let reusable = manager
            .take_reusable_executor(&RemoteSessionIdentity::new(&equivalent_profile, None))
            .await;

        assert!(reusable.is_some());
        assert!(!executor.closed.load(Ordering::SeqCst));
    }
}
