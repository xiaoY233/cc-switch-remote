use crate::app_config::{InstalledSkill, UnmanagedSkill};
use crate::prompt::Prompt;
use crate::provider::UniversalProvider;
use crate::services::provider_secrets::{
    redact_provider_map_secret_values, redact_secret_values, restore_redacted_secret_values,
    restore_redacted_secret_values_for,
};
use crate::services::skill::{
    DiscoverableSkill, ImportSkillSelection, SkillBackupEntry, SkillRepo, SkillService,
    SkillStorageLocation, SkillUninstallResult, SkillUpdateInfo,
};
use crate::services::ProviderSortUpdate;
use crate::{
    AppError, AppState, AppType, Database, McpServer, McpService, PromptService, Provider,
    ProviderService,
};
use indexmap::IndexMap;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
#[cfg(feature = "proxy-runtime")]
use std::fs;
#[cfg(feature = "proxy-runtime")]
use std::process::{Command, Stdio};
use std::str::FromStr;
use std::sync::Arc;
#[cfg(feature = "proxy-runtime")]
use std::time::Duration;

use crate::proxy::providers::codex_oauth_auth::{CodexOAuthError, CodexOAuthManager};
use crate::proxy::providers::copilot_auth::{
    CopilotAuthError, CopilotAuthManager, CopilotModel, GitHubAccount, GitHubDeviceCodeResponse,
};

#[cfg(feature = "proxy-runtime")]
static ROUTING_RUNTIME: Lazy<Result<tokio::runtime::Runtime, String>> =
    Lazy::new(|| tokio::runtime::Runtime::new().map_err(|e| e.to_string()));
#[cfg(feature = "proxy-runtime")]
static ROUTING_STATE: Lazy<Result<AppState, String>> = Lazy::new(|| {
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    Ok(AppState::new_with_managed_auth_runtime(
        db,
        crate::proxy::managed_auth_runtime::ManagedAuthRuntime {
            copilot: Some(COPILOT_AUTH_MANAGER.clone()),
            codex_oauth: Some(CODEX_OAUTH_MANAGER.clone()),
        },
    ))
});

static AUTH_RUNTIME: Lazy<Result<tokio::runtime::Runtime, String>> =
    Lazy::new(|| tokio::runtime::Runtime::new().map_err(|e| e.to_string()));
static COPILOT_AUTH_MANAGER: Lazy<Arc<CopilotAuthManager>> =
    Lazy::new(|| Arc::new(CopilotAuthManager::new(crate::config::get_app_config_dir())));
static CODEX_OAUTH_MANAGER: Lazy<Arc<CodexOAuthManager>> =
    Lazy::new(|| Arc::new(CodexOAuthManager::new(crate::config::get_app_config_dir())));

const AUTH_PROVIDER_GITHUB_COPILOT: &str = "github_copilot";
const AUTH_PROVIDER_CODEX_OAUTH: &str = "codex_oauth";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusPayload {
    pub version: String,
    pub build: Option<String>,
    pub platform: String,
    pub arch: String,
    pub capabilities: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ManagedAuthAccount {
    pub id: String,
    pub provider: String,
    pub login: String,
    pub avatar_url: Option<String>,
    pub authenticated_at: i64,
    pub is_default: bool,
    pub github_domain: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ManagedAuthStatus {
    pub provider: String,
    pub authenticated: bool,
    pub default_account_id: Option<String>,
    pub migration_error: Option<String>,
    pub accounts: Vec<ManagedAuthAccount>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ManagedAuthDeviceCodeResponse {
    pub provider: String,
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
}

pub fn status_payload() -> StatusPayload {
    StatusPayload {
        version: env!("CARGO_PKG_VERSION").to_string(),
        build: option_env!("CC_SWITCH_REMOTE_HELPER_BUILD")
            .filter(|value| !value.trim().is_empty() && *value != "unknown")
            .map(str::to_string),
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        capabilities: crate::remote_capabilities::remote_helper_capabilities(),
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteFetchModelsOptions {
    pub base_url: Option<String>,
    pub is_full_url: Option<bool>,
    pub models_url: Option<String>,
    pub custom_user_agent: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteTestUsageScriptOptions {
    pub script_code: String,
    pub timeout: Option<u64>,
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub access_token: Option<String>,
    pub user_id: Option<String>,
    pub template_type: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteBalanceOptions {
    pub base_url: String,
    pub api_key: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteCodingPlanQuotaOptions {
    pub base_url: String,
    pub api_key: String,
    pub access_key_id: Option<String>,
    pub secret_access_key: Option<String>,
}

fn auth_runtime() -> Result<&'static tokio::runtime::Runtime, String> {
    AUTH_RUNTIME.as_ref().map_err(Clone::clone)
}

pub fn fetch_models_for_provider(
    app_type: AppType,
    provider_id: &str,
    options_json: &str,
) -> Result<Vec<crate::services::model_fetch::FetchedModel>, String> {
    let options: RemoteFetchModelsOptions = serde_json::from_str(options_json)
        .map_err(|e| format!("Invalid model fetch options: {e}"))?;
    let db = Database::init().map_err(|e| e.to_string())?;
    let providers = db
        .get_all_providers(app_type.as_str())
        .map_err(|e| e.to_string())?;
    let provider = providers
        .get(provider_id)
        .ok_or_else(|| format!("Provider not found: {provider_id}"))?;
    let (stored_base_url, api_key) = provider.resolve_usage_credentials(&app_type);
    let base_url = options
        .base_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(stored_base_url.as_str());
    let user_agent = crate::provider::parse_custom_user_agent(options.custom_user_agent.as_deref())
        .ok()
        .flatten();

    auth_runtime()?.block_on(crate::services::model_fetch::fetch_models(
        base_url,
        &api_key,
        options.is_full_url.unwrap_or(false),
        options.models_url.as_deref(),
        user_agent,
    ))
}

fn build_command_state() -> Result<AppState, String> {
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    Ok(AppState::new_with_managed_auth_runtime(
        db,
        crate::proxy::managed_auth_runtime::ManagedAuthRuntime {
            copilot: Some(COPILOT_AUTH_MANAGER.clone()),
            codex_oauth: Some(CODEX_OAUTH_MANAGER.clone()),
        },
    ))
}

pub fn query_provider_usage(
    app_type: AppType,
    provider_id: &str,
) -> Result<crate::provider::UsageResult, String> {
    let state = build_command_state()?;
    auth_runtime()?
        .block_on(crate::services::ProviderService::query_usage(
            &state,
            app_type,
            provider_id,
        ))
        .map_err(|e| e.to_string())
}

pub fn test_usage_script(
    app_type: AppType,
    provider_id: &str,
    options_json: &str,
) -> Result<crate::provider::UsageResult, String> {
    let options: RemoteTestUsageScriptOptions = serde_json::from_str(options_json)
        .map_err(|e| format!("Invalid usage script test options: {e}"))?;
    let state = build_command_state()?;
    auth_runtime()?
        .block_on(crate::services::ProviderService::test_usage_script(
            &state,
            app_type,
            provider_id,
            &options.script_code,
            options.timeout.unwrap_or(10),
            options.api_key.as_deref(),
            options.base_url.as_deref(),
            options.access_token.as_deref(),
            options.user_id.as_deref(),
            options.template_type.as_deref(),
        ))
        .map_err(|e| e.to_string())
}

pub fn get_balance(options_json: &str) -> Result<crate::provider::UsageResult, String> {
    let options: RemoteBalanceOptions =
        serde_json::from_str(options_json).map_err(|e| format!("Invalid balance options: {e}"))?;
    auth_runtime()?.block_on(crate::services::balance::get_balance(
        &options.base_url,
        &options.api_key,
    ))
}

pub fn get_coding_plan_quota(
    options_json: &str,
) -> Result<crate::services::subscription::SubscriptionQuota, String> {
    let options: RemoteCodingPlanQuotaOptions = serde_json::from_str(options_json)
        .map_err(|e| format!("Invalid coding plan quota options: {e}"))?;
    auth_runtime()?.block_on(crate::services::coding_plan::get_coding_plan_quota(
        &options.base_url,
        &options.api_key,
        options.access_key_id.as_deref(),
        options.secret_access_key.as_deref(),
    ))
}

pub fn fetch_codex_oauth_models(
    auth_provider: &str,
    account_id: Option<&str>,
) -> Result<Vec<crate::services::model_fetch::FetchedModel>, String> {
    if ensure_auth_provider(auth_provider)? != AUTH_PROVIDER_CODEX_OAUTH {
        return Err(format!(
            "Model list is only supported for {AUTH_PROVIDER_CODEX_OAUTH}"
        ));
    }

    auth_runtime()?.block_on(async {
        let resolved = match account_id
            .map(str::trim)
            .filter(|id| !id.is_empty() && *id != "-")
        {
            Some(id) => Some(id.to_string()),
            None => CODEX_OAUTH_MANAGER.default_account_id().await,
        };
        let Some(id) = resolved else {
            return Err("No ChatGPT account available".to_string());
        };

        let token = CODEX_OAUTH_MANAGER
            .get_valid_token_for_account(&id)
            .await
            .map_err(|e| format!("Codex OAuth token unavailable: {e}"))?;

        crate::services::codex_oauth_models::fetch_models_with_token(&token, &id).await
    })
}

pub fn get_codex_oauth_quota(
    auth_provider: &str,
    account_id: Option<&str>,
) -> Result<crate::services::subscription::SubscriptionQuota, String> {
    if ensure_auth_provider(auth_provider)? != AUTH_PROVIDER_CODEX_OAUTH {
        return Err(format!(
            "Quota is only supported for {AUTH_PROVIDER_CODEX_OAUTH}"
        ));
    }

    auth_runtime()?.block_on(async {
        let resolved = match account_id
            .map(str::trim)
            .filter(|id| !id.is_empty() && *id != "-")
        {
            Some(id) => Some(id.to_string()),
            None => CODEX_OAUTH_MANAGER.default_account_id().await,
        };
        let Some(id) = resolved else {
            return Ok(crate::services::subscription::SubscriptionQuota::not_found(
                AUTH_PROVIDER_CODEX_OAUTH,
            ));
        };

        let token = match CODEX_OAUTH_MANAGER.get_valid_token_for_account(&id).await {
            Ok(token) => token,
            Err(e) => {
                return Ok(crate::services::subscription::SubscriptionQuota::error(
                    AUTH_PROVIDER_CODEX_OAUTH,
                    crate::services::subscription::CredentialStatus::Expired,
                    format!("Codex OAuth token unavailable: {e}"),
                ));
            }
        };

        Ok(crate::services::subscription::query_codex_quota(
            &token,
            Some(&id),
            AUTH_PROVIDER_CODEX_OAUTH,
            "Codex OAuth access token expired or rejected. Please re-login via cc-switch.",
        )
        .await)
    })
}

pub fn get_subscription_quota(
    tool: &str,
) -> Result<crate::services::subscription::SubscriptionQuota, String> {
    auth_runtime()?.block_on(crate::services::subscription::get_subscription_quota(tool))
}

pub fn fetch_copilot_models(
    auth_provider: &str,
    account_id: Option<&str>,
) -> Result<Vec<CopilotModel>, String> {
    if ensure_auth_provider(auth_provider)? != AUTH_PROVIDER_GITHUB_COPILOT {
        return Err(format!(
            "Model list is only supported for {AUTH_PROVIDER_GITHUB_COPILOT}"
        ));
    }

    auth_runtime()?.block_on(async {
        match account_id
            .map(str::trim)
            .filter(|id| !id.is_empty() && *id != "-")
        {
            Some(id) => COPILOT_AUTH_MANAGER
                .fetch_models_for_account(id)
                .await
                .map_err(|e| e.to_string()),
            None => COPILOT_AUTH_MANAGER
                .fetch_models()
                .await
                .map_err(|e| e.to_string()),
        }
    })
}

pub fn fetch_copilot_usage(
    auth_provider: &str,
    account_id: Option<&str>,
) -> Result<crate::proxy::providers::copilot_auth::CopilotUsageResponse, String> {
    if ensure_auth_provider(auth_provider)? != AUTH_PROVIDER_GITHUB_COPILOT {
        return Err(format!(
            "Usage is only supported for {AUTH_PROVIDER_GITHUB_COPILOT}"
        ));
    }

    auth_runtime()?.block_on(async {
        match account_id
            .map(str::trim)
            .filter(|id| !id.is_empty() && *id != "-")
        {
            Some(id) => COPILOT_AUTH_MANAGER
                .fetch_usage_for_account(id)
                .await
                .map_err(|e| e.to_string()),
            None => COPILOT_AUTH_MANAGER
                .fetch_usage()
                .await
                .map_err(|e| e.to_string()),
        }
    })
}

fn ensure_auth_provider(auth_provider: &str) -> Result<&'static str, String> {
    match auth_provider {
        AUTH_PROVIDER_GITHUB_COPILOT => Ok(AUTH_PROVIDER_GITHUB_COPILOT),
        AUTH_PROVIDER_CODEX_OAUTH => Ok(AUTH_PROVIDER_CODEX_OAUTH),
        _ => Err(format!("Unsupported auth provider: {auth_provider}")),
    }
}

fn map_auth_account(
    provider: &str,
    account: GitHubAccount,
    default_account_id: Option<&str>,
) -> ManagedAuthAccount {
    ManagedAuthAccount {
        is_default: default_account_id == Some(account.id.as_str()),
        id: account.id,
        provider: provider.to_string(),
        login: account.login,
        avatar_url: account.avatar_url,
        authenticated_at: account.authenticated_at,
        github_domain: account.github_domain,
    }
}

fn map_device_code_response(
    provider: &str,
    response: GitHubDeviceCodeResponse,
) -> ManagedAuthDeviceCodeResponse {
    ManagedAuthDeviceCodeResponse {
        provider: provider.to_string(),
        device_code: response.device_code,
        user_code: response.user_code,
        verification_uri: response.verification_uri,
        expires_in: response.expires_in,
        interval: response.interval,
    }
}

pub fn auth_start_login(
    auth_provider: &str,
    github_domain: Option<&str>,
) -> Result<ManagedAuthDeviceCodeResponse, String> {
    let auth_provider = ensure_auth_provider(auth_provider)?;
    auth_runtime()?.block_on(async {
        match auth_provider {
            AUTH_PROVIDER_GITHUB_COPILOT => {
                let response = COPILOT_AUTH_MANAGER
                    .start_device_flow(github_domain)
                    .await
                    .map_err(|e| e.to_string())?;
                Ok(map_device_code_response(auth_provider, response))
            }
            AUTH_PROVIDER_CODEX_OAUTH => {
                let response = CODEX_OAUTH_MANAGER
                    .start_device_flow()
                    .await
                    .map_err(|e| e.to_string())?;
                Ok(map_device_code_response(auth_provider, response))
            }
            _ => unreachable!(),
        }
    })
}

pub fn auth_poll_for_account(
    auth_provider: &str,
    device_code: &str,
    github_domain: Option<&str>,
) -> Result<Option<ManagedAuthAccount>, String> {
    let auth_provider = ensure_auth_provider(auth_provider)?;
    auth_runtime()?.block_on(async {
        match auth_provider {
            AUTH_PROVIDER_GITHUB_COPILOT => {
                match COPILOT_AUTH_MANAGER
                    .poll_for_token(device_code, github_domain)
                    .await
                {
                    Ok(account) => {
                        let default_account_id =
                            COPILOT_AUTH_MANAGER.get_status().await.default_account_id;
                        Ok(account.map(|account| {
                            map_auth_account(auth_provider, account, default_account_id.as_deref())
                        }))
                    }
                    Err(CopilotAuthError::AuthorizationPending) => Ok(None),
                    Err(e) => Err(e.to_string()),
                }
            }
            AUTH_PROVIDER_CODEX_OAUTH => {
                match CODEX_OAUTH_MANAGER.poll_for_token(device_code).await {
                    Ok(account) => {
                        let default_account_id =
                            CODEX_OAUTH_MANAGER.get_status().await.default_account_id;
                        Ok(account.map(|account| {
                            map_auth_account(auth_provider, account, default_account_id.as_deref())
                        }))
                    }
                    Err(CodexOAuthError::AuthorizationPending) => Ok(None),
                    Err(e) => Err(e.to_string()),
                }
            }
            _ => unreachable!(),
        }
    })
}

pub fn auth_list_accounts(auth_provider: &str) -> Result<Vec<ManagedAuthAccount>, String> {
    let auth_provider = ensure_auth_provider(auth_provider)?;
    auth_runtime()?.block_on(async {
        match auth_provider {
            AUTH_PROVIDER_GITHUB_COPILOT => {
                let status = COPILOT_AUTH_MANAGER.get_status().await;
                let default_account_id = status.default_account_id.clone();
                Ok(status
                    .accounts
                    .into_iter()
                    .map(|account| {
                        map_auth_account(auth_provider, account, default_account_id.as_deref())
                    })
                    .collect())
            }
            AUTH_PROVIDER_CODEX_OAUTH => {
                let status = CODEX_OAUTH_MANAGER.get_status().await;
                let default_account_id = status.default_account_id.clone();
                Ok(status
                    .accounts
                    .into_iter()
                    .map(|account| {
                        map_auth_account(auth_provider, account, default_account_id.as_deref())
                    })
                    .collect())
            }
            _ => unreachable!(),
        }
    })
}

pub fn auth_get_status(auth_provider: &str) -> Result<ManagedAuthStatus, String> {
    let auth_provider = ensure_auth_provider(auth_provider)?;
    auth_runtime()?.block_on(async {
        match auth_provider {
            AUTH_PROVIDER_GITHUB_COPILOT => {
                let status = COPILOT_AUTH_MANAGER.get_status().await;
                let default_account_id = status.default_account_id.clone();
                Ok(ManagedAuthStatus {
                    provider: auth_provider.to_string(),
                    authenticated: status.authenticated,
                    default_account_id: default_account_id.clone(),
                    migration_error: status.migration_error,
                    accounts: status
                        .accounts
                        .into_iter()
                        .map(|account| {
                            map_auth_account(auth_provider, account, default_account_id.as_deref())
                        })
                        .collect(),
                })
            }
            AUTH_PROVIDER_CODEX_OAUTH => {
                let status = CODEX_OAUTH_MANAGER.get_status().await;
                let default_account_id = status.default_account_id.clone();
                Ok(ManagedAuthStatus {
                    provider: auth_provider.to_string(),
                    authenticated: status.authenticated,
                    default_account_id: default_account_id.clone(),
                    migration_error: None,
                    accounts: status
                        .accounts
                        .into_iter()
                        .map(|account| {
                            map_auth_account(auth_provider, account, default_account_id.as_deref())
                        })
                        .collect(),
                })
            }
            _ => unreachable!(),
        }
    })
}

pub fn auth_remove_account(auth_provider: &str, account_id: &str) -> Result<bool, String> {
    let auth_provider = ensure_auth_provider(auth_provider)?;
    auth_runtime()?.block_on(async {
        match auth_provider {
            AUTH_PROVIDER_GITHUB_COPILOT => COPILOT_AUTH_MANAGER
                .remove_account(account_id)
                .await
                .map_err(|e| e.to_string())?,
            AUTH_PROVIDER_CODEX_OAUTH => CODEX_OAUTH_MANAGER
                .remove_account(account_id)
                .await
                .map_err(|e| e.to_string())?,
            _ => unreachable!(),
        }
        Ok(true)
    })
}

pub fn auth_set_default_account(auth_provider: &str, account_id: &str) -> Result<bool, String> {
    let auth_provider = ensure_auth_provider(auth_provider)?;
    auth_runtime()?.block_on(async {
        match auth_provider {
            AUTH_PROVIDER_GITHUB_COPILOT => COPILOT_AUTH_MANAGER
                .set_default_account(account_id)
                .await
                .map_err(|e| e.to_string())?,
            AUTH_PROVIDER_CODEX_OAUTH => CODEX_OAUTH_MANAGER
                .set_default_account(account_id)
                .await
                .map_err(|e| e.to_string())?,
            _ => unreachable!(),
        }
        Ok(true)
    })
}

pub fn auth_logout(auth_provider: &str) -> Result<bool, String> {
    let auth_provider = ensure_auth_provider(auth_provider)?;
    auth_runtime()?.block_on(async {
        match auth_provider {
            AUTH_PROVIDER_GITHUB_COPILOT => COPILOT_AUTH_MANAGER
                .clear_auth()
                .await
                .map_err(|e| e.to_string())?,
            AUTH_PROVIDER_CODEX_OAUTH => CODEX_OAUTH_MANAGER
                .clear_auth()
                .await
                .map_err(|e| e.to_string())?,
            _ => unreachable!(),
        }
        Ok(true)
    })
}

#[cfg(feature = "proxy-runtime")]
fn routing_runtime() -> Result<&'static tokio::runtime::Runtime, String> {
    ROUTING_RUNTIME.as_ref().map_err(Clone::clone)
}

#[cfg(feature = "proxy-runtime")]
fn routing_state() -> Result<&'static AppState, String> {
    ROUTING_STATE.as_ref().map_err(Clone::clone)
}

#[cfg(feature = "proxy-runtime")]
const ROUTING_DAEMON_SERVICE_NAME: &str = "cc-switch-remote-routing.service";
#[cfg(feature = "proxy-runtime")]
const ROUTING_DAEMON_PID_FILE: &str = "routing-runtime.pid";
#[cfg(feature = "proxy-runtime")]
const ROUTING_DAEMON_LOG_FILE: &str = "routing-runtime.log";

#[cfg(feature = "proxy-runtime")]
fn routing_daemon_runtime_dir() -> std::path::PathBuf {
    crate::config::get_app_config_dir().join("runtime")
}

#[cfg(feature = "proxy-runtime")]
fn routing_daemon_pid_path() -> std::path::PathBuf {
    routing_daemon_runtime_dir().join(ROUTING_DAEMON_PID_FILE)
}

#[cfg(feature = "proxy-runtime")]
fn routing_daemon_log_path() -> std::path::PathBuf {
    routing_daemon_runtime_dir().join(ROUTING_DAEMON_LOG_FILE)
}

#[cfg(feature = "proxy-runtime")]
fn quote_systemd_exec_arg(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

#[cfg(feature = "proxy-runtime")]
fn routing_daemon_service_unit(helper_path: &str) -> String {
    format!(
        r#"[Unit]
Description=CC Switch Remote Routing Runtime
After=network-online.target

[Service]
Type=simple
ExecStart={} --json routing-runtime daemon-run
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
"#,
        quote_systemd_exec_arg(helper_path)
    )
}

#[cfg(feature = "proxy-runtime")]
fn routing_status_probe_url(listen_address: &str, listen_port: u16) -> String {
    let host = match listen_address {
        "0.0.0.0" => "127.0.0.1".to_string(),
        "::" => "[::1]".to_string(),
        value if value.contains(':') && !value.starts_with('[') => format!("[{value}]"),
        value => value.to_string(),
    };
    format!("http://{host}:{listen_port}/status")
}

#[cfg(feature = "proxy-runtime")]
fn proxy_info_from_status(
    status: &crate::proxy::types::ProxyStatus,
) -> crate::proxy::types::ProxyServerInfo {
    crate::proxy::types::ProxyServerInfo {
        address: status.address.clone(),
        port: status.port,
        started_at: chrono::Utc::now().to_rfc3339(),
    }
}

#[cfg(feature = "proxy-runtime")]
async fn probe_routing_runtime_status(
    state: &AppState,
) -> Result<crate::proxy::types::ProxyStatus, String> {
    let config = state
        .db
        .get_proxy_config()
        .await
        .map_err(|e| format!("获取代理配置失败: {e}"))?;

    if config.listen_port == 0 {
        return Ok(crate::proxy::types::ProxyStatus {
            running: false,
            address: config.listen_address,
            port: config.listen_port,
            ..Default::default()
        });
    }

    let url = routing_status_probe_url(&config.listen_address, config.listen_port);
    match reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|e| e.to_string())?
        .get(url)
        .send()
        .await
    {
        Ok(response) if response.status().is_success() => response
            .json::<crate::proxy::types::ProxyStatus>()
            .await
            .map_err(|e| format!("解析远程路由状态失败: {e}")),
        _ => Ok(crate::proxy::types::ProxyStatus {
            running: false,
            address: config.listen_address,
            port: config.listen_port,
            ..Default::default()
        }),
    }
}

#[cfg(feature = "proxy-runtime")]
async fn effective_routing_runtime_status(
    state: &AppState,
) -> Result<crate::proxy::types::ProxyStatus, String> {
    let in_process = state.proxy_service.get_status().await?;
    if in_process.running {
        return Ok(in_process);
    }
    probe_routing_runtime_status(state).await
}

#[cfg(feature = "proxy-runtime")]
fn systemd_user_service_path() -> std::path::PathBuf {
    crate::config::get_home_dir()
        .join(".config")
        .join("systemd")
        .join("user")
        .join(ROUTING_DAEMON_SERVICE_NAME)
}

#[cfg(feature = "proxy-runtime")]
fn run_systemctl_user(args: &[&str]) -> Result<(), String> {
    let output = Command::new("systemctl")
        .arg("--user")
        .args(args)
        .output()
        .map_err(|e| format!("systemctl --user 执行失败: {e}"))?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Err(if stderr.is_empty() { stdout } else { stderr })
}

#[cfg(feature = "proxy-runtime")]
fn start_systemd_user_daemon() -> Result<(), String> {
    let helper_path = std::env::current_exe()
        .map_err(|e| format!("获取 Helper 路径失败: {e}"))?
        .to_string_lossy()
        .to_string();
    let service_path = systemd_user_service_path();
    let service_dir = service_path
        .parent()
        .ok_or_else(|| "无法解析 systemd user service 目录".to_string())?;
    fs::create_dir_all(service_dir).map_err(|e| format!("创建 systemd user 目录失败: {e}"))?;
    fs::write(&service_path, routing_daemon_service_unit(&helper_path))
        .map_err(|e| format!("写入 systemd user service 失败: {e}"))?;

    run_systemctl_user(&["daemon-reload"])?;
    run_systemctl_user(&["enable", "--now", ROUTING_DAEMON_SERVICE_NAME])
}

#[cfg(feature = "proxy-runtime")]
fn spawn_detached_routing_daemon() -> Result<(), String> {
    fs::create_dir_all(routing_daemon_runtime_dir())
        .map_err(|e| format!("创建远程路由运行目录失败: {e}"))?;
    let helper_path = std::env::current_exe().map_err(|e| format!("获取 Helper 路径失败: {e}"))?;
    let log_file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(routing_daemon_log_path())
        .map_err(|e| format!("打开远程路由日志失败: {e}"))?;
    let log_file_for_stderr = log_file
        .try_clone()
        .map_err(|e| format!("复制远程路由日志句柄失败: {e}"))?;

    let mut command = Command::new("setsid");
    command
        .arg(&helper_path)
        .args(["--json", "routing-runtime", "daemon-run"])
        .stdin(Stdio::null())
        .stdout(Stdio::from(log_file))
        .stderr(Stdio::from(log_file_for_stderr));

    let child = match command.spawn() {
        Ok(child) => child,
        Err(_) => {
            let log_file = fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(routing_daemon_log_path())
                .map_err(|e| format!("打开远程路由日志失败: {e}"))?;
            let log_file_for_stderr = log_file
                .try_clone()
                .map_err(|e| format!("复制远程路由日志句柄失败: {e}"))?;
            Command::new(helper_path)
                .args(["--json", "routing-runtime", "daemon-run"])
                .stdin(Stdio::null())
                .stdout(Stdio::from(log_file))
                .stderr(Stdio::from(log_file_for_stderr))
                .spawn()
                .map_err(|e| format!("启动远程路由后台进程失败: {e}"))?
        }
    };

    fs::write(routing_daemon_pid_path(), child.id().to_string())
        .map_err(|e| format!("写入远程路由 PID 失败: {e}"))?;
    Ok(())
}

#[cfg(feature = "proxy-runtime")]
fn stop_pid_file_daemon() -> Result<bool, String> {
    let pid_path = routing_daemon_pid_path();
    let raw = match fs::read_to_string(&pid_path) {
        Ok(value) => value,
        Err(_) => return Ok(false),
    };
    let pid = raw
        .trim()
        .parse::<u32>()
        .map_err(|e| format!("远程路由 PID 无效: {e}"))?;
    let status = Command::new("kill")
        .arg(pid.to_string())
        .status()
        .map_err(|e| format!("停止远程路由后台进程失败: {e}"))?;
    let _ = fs::remove_file(pid_path);
    Ok(status.success())
}

#[cfg(feature = "proxy-runtime")]
async fn wait_for_routing_status(
    state: &AppState,
    running: bool,
) -> Result<crate::proxy::types::ProxyStatus, String> {
    let mut last = effective_routing_runtime_status(state).await?;
    for _ in 0..20 {
        if last.running == running {
            return Ok(last);
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
        last = effective_routing_runtime_status(state).await?;
    }
    Ok(last)
}

#[cfg(feature = "proxy-runtime")]
async fn repair_enabled_routing_takeovers(state: &AppState) -> Result<(), String> {
    for app_type in ["claude", "codex", "gemini"] {
        let config = state
            .db
            .get_proxy_config_for_app(app_type)
            .await
            .map_err(|e| e.to_string())?;
        if config.enabled {
            state
                .proxy_service
                .set_takeover_for_app(app_type, true)
                .await?;
        }
    }
    Ok(())
}

#[cfg(feature = "proxy-runtime")]
async fn disable_enabled_routing_takeovers(state: &AppState) -> Result<(), String> {
    for app_type in ["claude", "codex", "gemini"] {
        state
            .proxy_service
            .set_takeover_for_app(app_type, false)
            .await?;
    }
    Ok(())
}

#[cfg(feature = "proxy-runtime")]
pub fn routing_runtime_status() -> Result<crate::proxy::types::ProxyStatus, String> {
    let state = routing_state()?;
    routing_runtime()?.block_on(effective_routing_runtime_status(state))
}

#[cfg(not(feature = "proxy-runtime"))]
pub fn routing_runtime_status() -> Result<crate::proxy::types::ProxyStatus, String> {
    Err("This helper build does not include remote routing runtime support".to_string())
}

#[cfg(feature = "proxy-runtime")]
pub fn routing_runtime_start() -> Result<crate::proxy::types::ProxyServerInfo, String> {
    let state = routing_state()?;
    routing_runtime()?.block_on(async {
        let info = state.proxy_service.start().await?;
        repair_enabled_routing_takeovers(state).await?;
        Ok(info)
    })
}

#[cfg(not(feature = "proxy-runtime"))]
pub fn routing_runtime_start() -> Result<crate::proxy::types::ProxyServerInfo, String> {
    Err("This helper build does not include remote routing runtime support".to_string())
}

#[cfg(feature = "proxy-runtime")]
pub fn routing_runtime_stop() -> Result<bool, String> {
    let state = routing_state()?;
    routing_runtime()?.block_on(async {
        disable_enabled_routing_takeovers(state).await?;
        if state.proxy_service.is_running().await {
            state.proxy_service.stop().await?;
        }
        Ok(true)
    })
}

#[cfg(not(feature = "proxy-runtime"))]
pub fn routing_runtime_stop() -> Result<bool, String> {
    Err("This helper build does not include remote routing runtime support".to_string())
}

#[cfg(feature = "proxy-runtime")]
pub fn routing_runtime_daemon_status() -> Result<crate::proxy::types::ProxyStatus, String> {
    routing_runtime_status()
}

#[cfg(not(feature = "proxy-runtime"))]
pub fn routing_runtime_daemon_status() -> Result<crate::proxy::types::ProxyStatus, String> {
    Err("This helper build does not include remote routing daemon support".to_string())
}

#[cfg(feature = "proxy-runtime")]
pub fn routing_runtime_daemon_start() -> Result<crate::proxy::types::ProxyServerInfo, String> {
    let state = routing_state()?;
    routing_runtime()?.block_on(async {
        let current = effective_routing_runtime_status(state).await?;
        if current.running {
            repair_enabled_routing_takeovers(state).await?;
            return Ok(proxy_info_from_status(&current));
        }

        let systemd_error = match start_systemd_user_daemon() {
            Ok(()) => {
                let status = wait_for_routing_status(state, true).await?;
                if status.running {
                    repair_enabled_routing_takeovers(state).await?;
                    return Ok(proxy_info_from_status(&status));
                }
                let error = "systemd user service 启动后未就绪".to_string();
                log::warn!("{error}，回退后台进程");
                let _ = run_systemctl_user(&["disable", "--now", ROUTING_DAEMON_SERVICE_NAME]);
                Some(error)
            }
            Err(error) => {
                log::warn!("远程路由 systemd user 启动失败，回退后台进程: {error}");
                Some(error)
            }
        };

        spawn_detached_routing_daemon()?;
        let status = wait_for_routing_status(state, true).await?;
        if !status.running {
            return Err(format!(
                "远程路由 daemon 启动后未就绪，systemd 状态: {}",
                systemd_error.unwrap_or_else(|| "未使用 systemd".to_string())
            ));
        }
        repair_enabled_routing_takeovers(state).await?;
        Ok(proxy_info_from_status(&status))
    })
}

#[cfg(not(feature = "proxy-runtime"))]
pub fn routing_runtime_daemon_start() -> Result<crate::proxy::types::ProxyServerInfo, String> {
    Err("This helper build does not include remote routing daemon support".to_string())
}

#[cfg(feature = "proxy-runtime")]
pub fn routing_runtime_daemon_stop() -> Result<bool, String> {
    let state = routing_state()?;
    routing_runtime()?.block_on(async {
        disable_enabled_routing_takeovers(state).await?;
        if state.proxy_service.is_running().await {
            let _ = state.proxy_service.stop().await;
        }
        if let Err(error) = run_systemctl_user(&["disable", "--now", ROUTING_DAEMON_SERVICE_NAME]) {
            log::warn!("停止远程路由 systemd user service 失败，尝试 PID 回退: {error}");
        }
        let _ = stop_pid_file_daemon();
        let status = wait_for_routing_status(state, false).await?;
        if status.running {
            return Err("远程路由 daemon 仍在运行".to_string());
        }
        Ok(true)
    })
}

#[cfg(not(feature = "proxy-runtime"))]
pub fn routing_runtime_daemon_stop() -> Result<bool, String> {
    Err("This helper build does not include remote routing daemon support".to_string())
}

#[cfg(feature = "proxy-runtime")]
pub fn routing_runtime_daemon_run() -> Result<(), String> {
    fs::create_dir_all(routing_daemon_runtime_dir())
        .map_err(|e| format!("创建远程路由运行目录失败: {e}"))?;
    fs::write(routing_daemon_pid_path(), std::process::id().to_string())
        .map_err(|e| format!("写入远程路由 PID 失败: {e}"))?;
    let state = routing_state()?;
    routing_runtime()?.block_on(async {
        let _info = state.proxy_service.start().await?;
        repair_enabled_routing_takeovers(state).await?;
        std::future::pending::<()>().await;
        #[allow(unreachable_code)]
        Ok(())
    })
}

#[cfg(not(feature = "proxy-runtime"))]
pub fn routing_runtime_daemon_run() -> Result<(), String> {
    Err("This helper build does not include remote routing daemon support".to_string())
}

pub fn get_settings() -> crate::settings::AppSettings {
    crate::settings::get_settings_for_frontend()
}

pub fn save_settings(settings_json: &str) -> Result<bool, String> {
    let settings: crate::settings::AppSettings =
        serde_json::from_str(settings_json).map_err(|e| e.to_string())?;
    crate::settings::update_settings(settings).map_err(|e| e.to_string())?;
    Ok(true)
}

pub fn get_app_config_dir() -> String {
    crate::config::get_app_config_dir()
        .to_string_lossy()
        .to_string()
}

pub fn set_app_config_dir(path: &str) -> Result<bool, String> {
    crate::app_store::set_app_config_dir_override_for_cli(Some(path)).map_err(|e| e.to_string())?;
    Ok(true)
}

pub fn webdav_test_connection(settings_json: &str, preserve: &str) -> Result<Value, String> {
    let settings: crate::settings::WebDavSyncSettings =
        serde_json::from_str(settings_json).map_err(|e| e.to_string())?;
    let preserve_empty = parse_bool(preserve)?;
    let resolved = resolve_webdav_password_for_request(
        settings,
        crate::settings::get_webdav_sync_settings(),
        preserve_empty,
    );
    let runtime = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
    runtime
        .block_on(crate::services::webdav_sync::check_connection(&resolved))
        .map_err(|e| e.to_string())?;
    Ok(json!({
        "success": true,
        "message": "WebDAV connection ok"
    }))
}

pub fn webdav_save_settings(settings_json: &str, password_touched: &str) -> Result<Value, String> {
    let settings: crate::settings::WebDavSyncSettings =
        serde_json::from_str(settings_json).map_err(|e| e.to_string())?;
    let password_touched = parse_bool(password_touched)?;
    let existing = crate::settings::get_webdav_sync_settings();
    let mut sync_settings =
        resolve_webdav_password_for_request(settings, existing.clone(), !password_touched);
    if let Some(existing_settings) = existing {
        sync_settings.status = existing_settings.status;
    }
    sync_settings.normalize();
    sync_settings.validate().map_err(|e| e.to_string())?;
    crate::settings::set_webdav_sync_settings(Some(sync_settings)).map_err(|e| e.to_string())?;
    Ok(json!({ "success": true }))
}

pub fn webdav_upload() -> Result<Value, String> {
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    let mut settings = require_enabled_webdav_settings()?;
    let runtime = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
    let result = runtime.block_on(crate::services::webdav_sync::run_with_sync_lock(
        crate::services::webdav_sync::upload(&db, &mut settings),
    ));
    map_webdav_sync_result(result, &mut settings, "manual")
}

pub fn webdav_download() -> Result<Value, String> {
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    let db_for_sync = Arc::clone(&db);
    let mut settings = require_enabled_webdav_settings()?;
    let runtime = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
    let mut value = map_webdav_sync_result(
        runtime.block_on(crate::services::webdav_sync::run_with_sync_lock(
            crate::services::webdav_sync::download(&db, &mut settings),
        )),
        &mut settings,
        "manual",
    )?;
    attach_cli_warning(&mut value, run_cli_post_import_sync(db_for_sync).err());
    Ok(value)
}

pub fn webdav_download_preflight(
) -> Result<crate::remote_restore_preflight::RestorePreflightReport, String> {
    let settings = require_enabled_webdav_settings()?;
    let runtime = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
    runtime
        .block_on(crate::services::webdav_sync::run_with_sync_lock(
            crate::services::webdav_sync::preflight_download(&settings),
        ))
        .map_err(|e| e.to_string())
}

pub fn webdav_download_with_mode(
    mode: crate::remote_restore_preflight::RestoreMode,
) -> Result<Value, String> {
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    let db_for_sync = Arc::clone(&db);
    let mut settings = require_enabled_webdav_settings()?;
    let runtime = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
    let mut value = map_webdav_sync_result(
        runtime.block_on(crate::services::webdav_sync::run_with_sync_lock(
            crate::services::webdav_sync::download_with_restore_mode(&db, &mut settings, mode),
        )),
        &mut settings,
        "manual",
    )?;
    attach_cli_warning(&mut value, run_cli_post_import_sync(db_for_sync).err());
    Ok(value)
}

pub fn webdav_fetch_remote_info() -> Result<Value, String> {
    let settings = require_enabled_webdav_settings()?;
    let runtime = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
    let info = runtime
        .block_on(crate::services::webdav_sync::fetch_remote_info(&settings))
        .map_err(|e| e.to_string())?;
    Ok(info.unwrap_or_else(|| json!({ "empty": true })))
}

pub fn s3_test_connection(settings_json: &str, preserve: &str) -> Result<Value, String> {
    let settings: crate::settings::S3SyncSettings =
        serde_json::from_str(settings_json).map_err(|e| e.to_string())?;
    let preserve_empty = parse_bool(preserve)?;
    let resolved = resolve_s3_secret_for_request(
        settings,
        crate::settings::get_s3_sync_settings(),
        preserve_empty,
    );
    let runtime = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
    runtime
        .block_on(crate::services::s3_sync::check_connection(&resolved))
        .map_err(|e| e.to_string())?;
    Ok(json!({
        "success": true,
        "message": "S3 connection ok"
    }))
}

pub fn s3_save_settings(settings_json: &str, password_touched: &str) -> Result<Value, String> {
    let settings: crate::settings::S3SyncSettings =
        serde_json::from_str(settings_json).map_err(|e| e.to_string())?;
    let password_touched = parse_bool(password_touched)?;
    let existing = crate::settings::get_s3_sync_settings();
    let mut sync_settings =
        resolve_s3_secret_for_request(settings, existing.clone(), !password_touched);
    if let Some(existing_settings) = existing {
        sync_settings.status = existing_settings.status;
    }
    sync_settings.normalize();
    sync_settings.validate().map_err(|e| e.to_string())?;
    crate::settings::set_s3_sync_settings(Some(sync_settings)).map_err(|e| e.to_string())?;
    Ok(json!({ "success": true }))
}

pub fn s3_upload() -> Result<Value, String> {
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    let mut settings = require_enabled_s3_settings()?;
    let runtime = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
    let result = runtime.block_on(crate::services::s3_sync::run_with_sync_lock(
        crate::services::s3_sync::upload(&db, &mut settings),
    ));
    map_s3_sync_result(result, &mut settings, "manual")
}

pub fn s3_download() -> Result<Value, String> {
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    let db_for_sync = Arc::clone(&db);
    let mut settings = require_enabled_s3_settings()?;
    let runtime = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
    let mut value = map_s3_sync_result(
        runtime.block_on(crate::services::s3_sync::run_with_sync_lock(
            crate::services::s3_sync::download(&db, &mut settings),
        )),
        &mut settings,
        "manual",
    )?;
    attach_cli_warning(&mut value, run_cli_post_import_sync(db_for_sync).err());
    Ok(value)
}

pub fn s3_download_preflight(
) -> Result<crate::remote_restore_preflight::RestorePreflightReport, String> {
    let settings = require_enabled_s3_settings()?;
    let runtime = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
    runtime
        .block_on(crate::services::s3_sync::run_with_sync_lock(
            crate::services::s3_sync::preflight_download(&settings),
        ))
        .map_err(|e| e.to_string())
}

pub fn s3_download_with_mode(
    mode: crate::remote_restore_preflight::RestoreMode,
) -> Result<Value, String> {
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    let db_for_sync = Arc::clone(&db);
    let mut settings = require_enabled_s3_settings()?;
    let runtime = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
    let mut value = map_s3_sync_result(
        runtime.block_on(crate::services::s3_sync::run_with_sync_lock(
            crate::services::s3_sync::download_with_restore_mode(&db, &mut settings, mode),
        )),
        &mut settings,
        "manual",
    )?;
    attach_cli_warning(&mut value, run_cli_post_import_sync(db_for_sync).err());
    Ok(value)
}

pub fn s3_fetch_remote_info() -> Result<Value, String> {
    let settings = require_enabled_s3_settings()?;
    let runtime = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
    let info = runtime
        .block_on(crate::services::s3_sync::fetch_remote_info(&settings))
        .map_err(|e| e.to_string())?;
    Ok(info.unwrap_or_else(|| json!({ "empty": true })))
}

fn resolve_webdav_password_for_request(
    mut incoming: crate::settings::WebDavSyncSettings,
    existing: Option<crate::settings::WebDavSyncSettings>,
    preserve_empty_password: bool,
) -> crate::settings::WebDavSyncSettings {
    if let Some(existing_settings) = existing {
        if preserve_empty_password && incoming.password.is_empty() {
            incoming.password = existing_settings.password;
        }
    }
    incoming
}

fn resolve_s3_secret_for_request(
    mut incoming: crate::settings::S3SyncSettings,
    existing: Option<crate::settings::S3SyncSettings>,
    preserve_empty_secret: bool,
) -> crate::settings::S3SyncSettings {
    if let Some(existing_settings) = existing {
        if preserve_empty_secret && incoming.secret_access_key.is_empty() {
            incoming.secret_access_key = existing_settings.secret_access_key;
        }
    }
    incoming
}

fn require_enabled_webdav_settings() -> Result<crate::settings::WebDavSyncSettings, String> {
    let settings = crate::settings::get_webdav_sync_settings()
        .ok_or_else(|| "WebDAV sync is not configured.".to_string())?;
    if !settings.enabled {
        return Err("WebDAV sync is disabled.".to_string());
    }
    Ok(settings)
}

fn require_enabled_s3_settings() -> Result<crate::settings::S3SyncSettings, String> {
    let settings = crate::settings::get_s3_sync_settings()
        .ok_or_else(|| "S3 sync is not configured.".to_string())?;
    if !settings.enabled {
        return Err("S3 sync is disabled.".to_string());
    }
    Ok(settings)
}

fn map_webdav_sync_result(
    result: Result<Value, crate::AppError>,
    settings: &mut crate::settings::WebDavSyncSettings,
    source: &str,
) -> Result<Value, String> {
    match result {
        Ok(value) => Ok(value),
        Err(error) => {
            settings.status.last_error = Some(error.to_string());
            settings.status.last_error_source = Some(source.to_string());
            let _ = crate::settings::update_webdav_sync_status(settings.status.clone());
            Err(error.to_string())
        }
    }
}

fn map_s3_sync_result(
    result: Result<Value, crate::AppError>,
    settings: &mut crate::settings::S3SyncSettings,
    source: &str,
) -> Result<Value, String> {
    match result {
        Ok(value) => Ok(value),
        Err(error) => {
            settings.status.last_error = Some(error.to_string());
            settings.status.last_error_source = Some(source.to_string());
            let _ = crate::settings::update_s3_sync_status(settings.status.clone());
            Err(error.to_string())
        }
    }
}

fn run_cli_post_import_sync(db: Arc<Database>) -> Result<(), String> {
    let state = AppState::new(db);
    ProviderService::sync_current_to_live(&state)
        .and_then(|_| crate::settings::reload_settings())
        .map_err(|e| e.to_string())
}

fn attach_cli_warning(value: &mut Value, warning: Option<String>) {
    if let Some(message) = warning {
        if let Some(object) = value.as_object_mut() {
            object.insert("warning".to_string(), Value::String(message));
        }
    }
}

pub fn migrate_skill_storage(
    target: &str,
) -> Result<crate::services::skill::MigrationResult, String> {
    let target = parse_skill_storage_location(target)?;
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    SkillService::migrate_storage(&db, target).map_err(|e| e.to_string())
}

pub fn apply_claude_plugin_config(official: &str) -> Result<bool, String> {
    let official = parse_bool(official)?;
    if official {
        crate::claude_plugin::clear_claude_config().map_err(|e| e.to_string())
    } else {
        crate::claude_plugin::write_claude_config().map_err(|e| e.to_string())
    }
}

pub fn set_claude_onboarding_skip(enabled: &str) -> Result<bool, String> {
    if parse_bool(enabled)? {
        crate::claude_mcp::set_has_completed_onboarding().map_err(|e| e.to_string())
    } else {
        crate::claude_mcp::clear_has_completed_onboarding().map_err(|e| e.to_string())
    }
}

fn parse_skill_storage_location(value: &str) -> Result<SkillStorageLocation, String> {
    match value {
        "cc_switch" => Ok(SkillStorageLocation::CcSwitch),
        "unified" => Ok(SkillStorageLocation::Unified),
        _ => Err(format!("Unsupported skill storage location: {value}")),
    }
}

fn parse_bool(value: &str) -> Result<bool, String> {
    match value {
        "true" => Ok(true),
        "false" => Ok(false),
        _ => Err(format!("Expected boolean true or false, got: {value}")),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStatePayload {
    pub providers: serde_json::Value,
    pub current_provider_id: String,
}

pub fn tool_versions(
    tools_json: &str,
) -> Result<Vec<crate::tool_environment::ToolVersion>, String> {
    let tools: Option<Vec<String>> = if tools_json.trim().is_empty() || tools_json == "-" {
        None
    } else {
        Some(serde_json::from_str(tools_json).map_err(|e| e.to_string())?)
    };
    let should_repair_claude_path = match tools.as_ref() {
        None => true,
        Some(requested) => requested.iter().any(|tool| tool == "claude"),
    };
    if should_repair_claude_path {
        let _ = crate::tool_environment::repair_remote_tool_shell_path_after_install(vec![
            "claude".to_string(),
        ]);
    }
    let runtime = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
    runtime.block_on(crate::tool_environment::get_tool_versions(tools, None))
}

pub fn run_tool_lifecycle_action(tools_json: &str, action: &str) -> Result<(), String> {
    let tools: Vec<String> = if tools_json.trim().is_empty() || tools_json == "-" {
        Vec::new()
    } else {
        serde_json::from_str(tools_json).map_err(|e| e.to_string())?
    };
    let runtime = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
    runtime.block_on(crate::tool_environment::run_tool_lifecycle_action(
        tools.clone(),
        action.to_string(),
        None,
    ))?;

    if action == "install" {
        crate::tool_environment::repair_remote_tool_shell_path_after_install(tools)?;
    }

    Ok(())
}

pub fn probe_tool_installations(
    tools_json: &str,
) -> Result<Vec<crate::tool_environment::ToolInstallationReport>, String> {
    let tools: Vec<String> = if tools_json.trim().is_empty() || tools_json == "-" {
        Vec::new()
    } else {
        serde_json::from_str(tools_json).map_err(|e| e.to_string())?
    };
    let runtime = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
    runtime.block_on(crate::tool_environment::probe_tool_installations(tools))
}

pub fn list_sessions() -> Result<Vec<crate::session_manager::SessionMeta>, String> {
    Ok(crate::session_manager::scan_sessions())
}

pub fn session_messages(
    provider_id: &str,
    source_path: &str,
) -> Result<Vec<crate::session_manager::SessionMessage>, String> {
    crate::session_manager::load_messages(provider_id, source_path)
}

pub fn delete_session(
    provider_id: &str,
    session_id: &str,
    source_path: &str,
) -> Result<bool, String> {
    crate::session_manager::delete_session(provider_id, session_id, source_path)
}

pub fn delete_sessions(
    items_json: &str,
) -> Result<Vec<crate::session_manager::DeleteSessionOutcome>, String> {
    let items: Vec<crate::session_manager::DeleteSessionRequest> =
        serde_json::from_str(items_json).map_err(|e| e.to_string())?;
    Ok(crate::session_manager::delete_sessions(&items))
}

fn parse_hermes_memory_kind(kind: &str) -> Result<crate::hermes_config::MemoryKind, String> {
    serde_json::from_value(json!(kind)).map_err(|e| e.to_string())
}

pub fn get_hermes_memory(kind: &str) -> Result<String, String> {
    let kind = parse_hermes_memory_kind(kind)?;
    crate::hermes_config::read_memory(kind).map_err(|e| e.to_string())
}

pub fn set_hermes_memory(kind: &str, content: &str) -> Result<(), String> {
    let kind = parse_hermes_memory_kind(kind)?;
    crate::hermes_config::write_memory(kind, content).map_err(|e| e.to_string())
}

pub fn get_hermes_memory_limits() -> Result<crate::hermes_config::HermesMemoryLimits, String> {
    crate::hermes_config::read_memory_limits().map_err(|e| e.to_string())
}

pub fn get_hermes_model_config() -> Result<Option<crate::hermes_config::HermesModelConfig>, String>
{
    crate::hermes_config::get_model_config().map_err(|e| e.to_string())
}

pub fn set_hermes_memory_enabled(
    kind: &str,
    enabled: bool,
) -> Result<crate::hermes_config::HermesWriteOutcome, String> {
    let kind = parse_hermes_memory_kind(kind)?;
    crate::hermes_config::set_memory_enabled(kind, enabled).map_err(|e| e.to_string())
}

pub fn list_providers(app: AppType) -> Result<serde_json::Value, String> {
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    let state = AppState::new(db);
    let providers = ProviderService::list(&state, app).map_err(|e| e.to_string())?;
    let mut value = serde_json::to_value(providers).map_err(|e| e.to_string())?;
    redact_provider_map_secret_values(&mut value);
    Ok(value)
}

pub fn current_provider(app: AppType) -> Result<String, String> {
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    let state = AppState::new(db);
    ProviderService::current(&state, app).map_err(|e| e.to_string())
}

pub fn provider_state(app: AppType) -> Result<ProviderStatePayload, String> {
    Ok(ProviderStatePayload {
        providers: list_providers(app.clone())?,
        current_provider_id: current_provider(app)?,
    })
}

pub fn switch_provider(app: AppType, id: &str) -> Result<crate::services::SwitchResult, String> {
    #[cfg(feature = "proxy-runtime")]
    {
        let state = routing_state()?;
        let runtime = routing_runtime()?;
        let app_type = app.as_str().to_string();
        let provider_id = id.to_string();

        let routed = runtime.block_on(async {
            let config = state
                .db
                .get_proxy_config_for_app(&app_type)
                .await
                .map_err(|e| e.to_string())?;

            if config.enabled && state.proxy_service.is_running().await {
                state
                    .proxy_service
                    .switch_proxy_target(&app_type, &provider_id)
                    .await?;
                return Ok::<bool, String>(true);
            }

            Ok::<bool, String>(false)
        })?;

        if routed {
            return Ok(crate::services::SwitchResult::default());
        }
    }

    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    let state = AppState::new(db);
    ProviderService::switch(&state, app, id).map_err(|e| e.to_string())
}

pub fn add_provider(app: AppType, provider_json: &str, add_to_live: bool) -> Result<bool, String> {
    let provider: Provider = serde_json::from_str(provider_json).map_err(|e| e.to_string())?;
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    let state = AppState::new(db);
    ProviderService::add(&state, app, provider, add_to_live).map_err(|e| e.to_string())
}

pub fn update_provider(
    app: AppType,
    provider_json: &str,
    original_id: Option<&str>,
) -> Result<bool, String> {
    let mut provider: Provider = serde_json::from_str(provider_json).map_err(|e| e.to_string())?;
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    let state = AppState::new(db);
    let provider_id = original_id.unwrap_or(provider.id.as_str());
    if let Some(existing_provider) = state
        .db
        .get_provider_by_id(provider_id, app.as_str())
        .map_err(|e| e.to_string())?
    {
        restore_redacted_secret_values(&existing_provider, &mut provider)
            .map_err(|e| e.to_string())?;
    }
    ProviderService::update(&state, app, original_id, provider).map_err(|e| e.to_string())
}

pub fn delete_provider(app: AppType, id: &str) -> Result<bool, String> {
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    let state = AppState::new(db);
    ProviderService::delete(&state, app, id)
        .map(|_| true)
        .map_err(|e| e.to_string())
}

pub fn remove_provider_from_live_config(app: AppType, id: &str) -> Result<bool, String> {
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    let state = AppState::new(db);
    ProviderService::remove_from_live_config(&state, app, id)
        .map(|_| true)
        .map_err(|e| e.to_string())
}

pub fn live_provider_ids(app: AppType) -> Result<Vec<String>, String> {
    match app {
        AppType::OpenCode => crate::opencode_config::get_providers()
            .map(|providers| providers.keys().cloned().collect())
            .map_err(|e| e.to_string()),
        AppType::OpenClaw => crate::openclaw_config::get_providers()
            .map(|providers| providers.keys().cloned().collect())
            .map_err(|e| e.to_string()),
        AppType::Hermes => crate::hermes_config::get_providers()
            .map(|providers| providers.keys().cloned().collect())
            .map_err(|e| e.to_string()),
        _ => Err(format!(
            "App {} does not support live provider IDs",
            app.as_str()
        )),
    }
}

pub fn stream_check_provider(
    app: AppType,
    provider_id: &str,
) -> Result<crate::services::stream_check::StreamCheckResult, String> {
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    let state = AppState::new(db);
    let config = state
        .db
        .get_stream_check_config()
        .map_err(|e| e.to_string())?;
    let providers = state
        .db
        .get_all_providers(app.as_str())
        .map_err(|e| e.to_string())?;
    let provider = providers
        .get(provider_id)
        .ok_or_else(|| format!("供应商 {provider_id} 不存在"))?;
    let runtime = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
    let result = runtime
        .block_on(
            crate::services::stream_check::StreamCheckService::check_with_retry(
                &app, provider, &config, None,
            ),
        )
        .map_err(|e| e.to_string())?;

    let _ = state
        .db
        .save_stream_check_log(provider_id, &provider.name, app.as_str(), &result);

    Ok(result)
}

pub fn get_stream_check_config() -> Result<crate::services::stream_check::StreamCheckConfig, String>
{
    let db = Database::init().map_err(|e| e.to_string())?;
    db.get_stream_check_config().map_err(|e| e.to_string())
}

pub fn save_stream_check_config(config_json: &str) -> Result<bool, String> {
    let config: crate::services::stream_check::StreamCheckConfig =
        serde_json::from_str(config_json).map_err(|e| e.to_string())?;
    let db = Database::init().map_err(|e| e.to_string())?;
    db.save_stream_check_config(&config)
        .map_err(|e| e.to_string())?;
    Ok(true)
}

pub fn get_log_config() -> Result<crate::proxy::types::LogConfig, String> {
    let db = Database::init().map_err(|e| e.to_string())?;
    db.get_log_config().map_err(|e| e.to_string())
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageQueryParams {
    pub start_date: Option<i64>,
    pub end_date: Option<i64>,
    pub app_type: Option<String>,
    pub provider_name: Option<String>,
    pub model: Option<String>,
}

fn parse_usage_params(params_json: &str) -> Result<UsageQueryParams, String> {
    if params_json.trim().is_empty() || params_json == "-" {
        return Ok(UsageQueryParams::default());
    }
    serde_json::from_str(params_json).map_err(|e| e.to_string())
}

pub fn usage_summary(
    params_json: &str,
) -> Result<crate::services::usage_stats::UsageSummary, String> {
    let params = parse_usage_params(params_json)?;
    let db = Database::init().map_err(|e| e.to_string())?;
    db.get_usage_summary(
        params.start_date,
        params.end_date,
        params.app_type.as_deref(),
        params.provider_name.as_deref(),
        params.model.as_deref(),
    )
    .map_err(|e| e.to_string())
}

pub fn usage_summary_by_app(
    params_json: &str,
) -> Result<Vec<crate::services::usage_stats::UsageSummaryByApp>, String> {
    let params = parse_usage_params(params_json)?;
    let db = Database::init().map_err(|e| e.to_string())?;
    db.get_usage_summary_by_app(
        params.start_date,
        params.end_date,
        params.provider_name.as_deref(),
        params.model.as_deref(),
    )
    .map_err(|e| e.to_string())
}

pub fn usage_trends(
    params_json: &str,
) -> Result<Vec<crate::services::usage_stats::DailyStats>, String> {
    let params = parse_usage_params(params_json)?;
    let db = Database::init().map_err(|e| e.to_string())?;
    db.get_daily_trends(
        params.start_date,
        params.end_date,
        params.app_type.as_deref(),
        params.provider_name.as_deref(),
        params.model.as_deref(),
    )
    .map_err(|e| e.to_string())
}

pub fn usage_provider_stats(
    params_json: &str,
) -> Result<Vec<crate::services::usage_stats::ProviderStats>, String> {
    let params = parse_usage_params(params_json)?;
    let db = Database::init().map_err(|e| e.to_string())?;
    db.get_provider_stats(
        params.start_date,
        params.end_date,
        params.app_type.as_deref(),
        params.provider_name.as_deref(),
        params.model.as_deref(),
    )
    .map_err(|e| e.to_string())
}

pub fn usage_model_stats(
    params_json: &str,
) -> Result<Vec<crate::services::usage_stats::ModelStats>, String> {
    let params = parse_usage_params(params_json)?;
    let db = Database::init().map_err(|e| e.to_string())?;
    db.get_model_stats(
        params.start_date,
        params.end_date,
        params.app_type.as_deref(),
        params.provider_name.as_deref(),
        params.model.as_deref(),
    )
    .map_err(|e| e.to_string())
}

pub fn usage_request_logs(
    filters_json: &str,
    page: u32,
    page_size: u32,
) -> Result<crate::services::usage_stats::PaginatedLogs, String> {
    let filters: crate::services::usage_stats::LogFilters =
        if filters_json.trim().is_empty() || filters_json == "-" {
            Default::default()
        } else {
            serde_json::from_str(filters_json).map_err(|e| e.to_string())?
        };
    let db = Database::init().map_err(|e| e.to_string())?;
    db.get_request_logs(&filters, page, page_size)
        .map_err(|e| e.to_string())
}

pub fn usage_request_detail(
    request_id: &str,
) -> Result<Option<crate::services::usage_stats::RequestLogDetail>, String> {
    let db = Database::init().map_err(|e| e.to_string())?;
    db.get_request_detail(request_id).map_err(|e| e.to_string())
}

pub fn usage_data_sources() -> Result<Vec<crate::services::session_usage::DataSourceSummary>, String>
{
    let db = Database::init().map_err(|e| e.to_string())?;
    crate::services::session_usage::get_data_source_breakdown(&db).map_err(|e| e.to_string())
}

pub fn usage_sync_session() -> Result<crate::services::session_usage::SessionSyncResult, String> {
    let db = Database::init().map_err(|e| e.to_string())?;
    crate::services::session_usage_sync::sync_all_session_usage(&db).map_err(|e| e.to_string())
}

pub fn usage_model_pricing() -> Result<Vec<crate::services::usage_pricing::ModelPricingInfo>, String>
{
    let db = Database::init().map_err(|e| e.to_string())?;
    crate::services::usage_pricing::get_model_pricing(&db).map_err(|e| e.to_string())
}

pub fn usage_update_model_pricing(
    model_id: &str,
    display_name: &str,
    input_cost: &str,
    output_cost: &str,
    cache_read_cost: &str,
    cache_creation_cost: &str,
) -> Result<(), String> {
    let db = Database::init().map_err(|e| e.to_string())?;
    crate::services::usage_pricing::update_model_pricing(
        &db,
        model_id.to_string(),
        display_name.to_string(),
        input_cost.to_string(),
        output_cost.to_string(),
        cache_read_cost.to_string(),
        cache_creation_cost.to_string(),
    )
    .map_err(|e| e.to_string())
}

pub fn usage_delete_model_pricing(model_id: &str) -> Result<(), String> {
    let db = Database::init().map_err(|e| e.to_string())?;
    crate::services::usage_pricing::delete_model_pricing(&db, model_id.to_string())
        .map_err(|e| e.to_string())
}

pub fn save_log_config(config_json: &str) -> Result<bool, String> {
    let config: crate::proxy::types::LogConfig =
        serde_json::from_str(config_json).map_err(|e| e.to_string())?;
    let db = Database::init().map_err(|e| e.to_string())?;
    db.set_log_config(&config).map_err(|e| e.to_string())?;
    log::set_max_level(config.to_level_filter());
    Ok(true)
}

pub fn sort_providers(app: AppType, updates_json: &str) -> Result<bool, String> {
    let updates: Vec<ProviderSortUpdate> =
        serde_json::from_str(updates_json).map_err(|e| e.to_string())?;
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    let state = AppState::new(db);
    ProviderService::update_sort_order(&state, app, updates).map_err(|e| e.to_string())
}

pub fn import_providers(app: AppType) -> Result<bool, String> {
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    let state = AppState::new(db);
    match app {
        AppType::OpenCode => crate::services::provider::import_opencode_providers_from_live(&state)
            .map(|count| count > 0)
            .or_else(live_config_missing_as_false),
        AppType::OpenClaw => crate::services::provider::import_openclaw_providers_from_live(&state)
            .map(|count| count > 0)
            .or_else(live_config_missing_as_false),
        AppType::Hermes => crate::services::provider::import_hermes_providers_from_live(&state)
            .map(|count| count > 0)
            .or_else(live_config_missing_as_false),
        AppType::ClaudeDesktop => {
            ProviderService::import_claude_desktop_providers_from_claude(&state)
                .map(|count| count > 0)
                .map_err(|e| e.to_string())
        }
        _ => import_default_config_internal(&state, app).or_else(live_config_missing_as_false),
    }
}

pub fn list_universal_providers() -> Result<IndexMap<String, UniversalProvider>, String> {
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    let state = AppState::new(db);
    let providers = ProviderService::list_universal(&state).map_err(|e| e.to_string())?;
    let mut value = serde_json::to_value(providers).map_err(|e| e.to_string())?;
    redact_provider_map_secret_values(&mut value);
    let providers: std::collections::HashMap<String, UniversalProvider> =
        serde_json::from_value(value).map_err(|e| e.to_string())?;
    Ok(providers.into_iter().collect())
}

pub fn get_universal_provider(id: &str) -> Result<Option<UniversalProvider>, String> {
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    let state = AppState::new(db);
    let provider = ProviderService::get_universal(&state, id).map_err(|e| e.to_string())?;
    let Some(provider) = provider else {
        return Ok(None);
    };
    let mut value = serde_json::to_value(provider).map_err(|e| e.to_string())?;
    redact_secret_values(&mut value);
    serde_json::from_value(value)
        .map(Some)
        .map_err(|e| e.to_string())
}

pub fn upsert_universal_provider(provider_json: &str) -> Result<bool, String> {
    let mut provider: UniversalProvider =
        serde_json::from_str(provider_json).map_err(|e| e.to_string())?;
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    let state = AppState::new(db);
    if let Some(existing_provider) =
        ProviderService::get_universal(&state, &provider.id).map_err(|e| e.to_string())?
    {
        restore_redacted_secret_values_for(&existing_provider, &mut provider)
            .map_err(|e| e.to_string())?;
    }
    ProviderService::upsert_universal(&state, provider).map_err(|e| e.to_string())
}

pub fn delete_universal_provider(id: &str) -> Result<bool, String> {
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    let state = AppState::new(db);
    ProviderService::delete_universal(&state, id).map_err(|e| e.to_string())
}

pub fn sync_universal_provider(id: &str) -> Result<bool, String> {
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    let state = AppState::new(db);
    ProviderService::sync_universal_to_apps(&state, id).map_err(|e| e.to_string())
}

pub fn get_routing_global_config() -> Result<crate::proxy::types::GlobalProxyConfig, String> {
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    let runtime = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
    runtime
        .block_on(db.get_global_proxy_config())
        .map_err(|e| e.to_string())
}

pub fn update_routing_global_config(config_json: &str) -> Result<(), String> {
    let config: crate::proxy::types::GlobalProxyConfig =
        serde_json::from_str(config_json).map_err(|e| e.to_string())?;
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    let runtime = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
    runtime
        .block_on(db.update_global_proxy_config(config))
        .map_err(|e| e.to_string())
}

pub fn get_routing_app_config(
    app_type: &str,
) -> Result<crate::proxy::types::AppProxyConfig, String> {
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    let runtime = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
    runtime
        .block_on(db.get_proxy_config_for_app(app_type))
        .map_err(|e| e.to_string())
}

#[cfg(feature = "proxy-runtime")]
pub fn preflight_routing_app(
    app_type: &str,
) -> Result<crate::proxy::types::AppRoutingPreflight, String> {
    let state = routing_state()?;
    state.proxy_service.preflight_takeover_for_app(app_type)
}

#[cfg(not(feature = "proxy-runtime"))]
pub fn preflight_routing_app(
    app_type: &str,
) -> Result<crate::proxy::types::AppRoutingPreflight, String> {
    Ok(crate::proxy::types::AppRoutingPreflight {
        app_type: app_type.to_string(),
        can_enable: false,
        reason: Some(
            "This helper build does not include remote routing runtime support".to_string(),
        ),
    })
}

pub fn get_default_cost_multiplier(app_type: &str) -> Result<String, String> {
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    let runtime = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
    runtime
        .block_on(db.get_default_cost_multiplier(app_type))
        .map_err(|e| e.to_string())
}

pub fn set_default_cost_multiplier(app_type: &str, value: &str) -> Result<(), String> {
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    let runtime = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
    runtime
        .block_on(db.set_default_cost_multiplier(app_type, value))
        .map_err(|e| e.to_string())
}

pub fn get_pricing_model_source(app_type: &str) -> Result<String, String> {
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    let runtime = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
    runtime
        .block_on(db.get_pricing_model_source(app_type))
        .map_err(|e| e.to_string())
}

pub fn set_pricing_model_source(app_type: &str, value: &str) -> Result<(), String> {
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    let runtime = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
    runtime
        .block_on(db.set_pricing_model_source(app_type, value))
        .map_err(|e| e.to_string())
}

pub fn get_routing_failover_queue(
    app_type: &str,
) -> Result<Vec<crate::database::FailoverQueueItem>, String> {
    let db = Database::init().map_err(|e| e.to_string())?;
    db.get_failover_queue(app_type).map_err(|e| e.to_string())
}

pub fn get_routing_available_failover_providers(app_type: &str) -> Result<Vec<Provider>, String> {
    let db = Database::init().map_err(|e| e.to_string())?;
    db.get_available_providers_for_failover(app_type)
        .map_err(|e| e.to_string())
}

pub fn add_routing_failover_queue(app_type: &str, provider_id: &str) -> Result<(), String> {
    let db = Database::init().map_err(|e| e.to_string())?;
    db.add_to_failover_queue(app_type, provider_id)
        .map_err(|e| e.to_string())
}

pub fn remove_routing_failover_queue(app_type: &str, provider_id: &str) -> Result<(), String> {
    let db = Database::init().map_err(|e| e.to_string())?;
    db.remove_from_failover_queue(app_type, provider_id)
        .map_err(|e| e.to_string())
}

pub fn get_routing_auto_failover_enabled(app_type: &str) -> Result<bool, String> {
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    let runtime = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
    runtime
        .block_on(db.get_proxy_config_for_app(app_type))
        .map(|config| config.auto_failover_enabled)
        .map_err(|e| e.to_string())
}

pub fn set_routing_auto_failover_enabled(app_type: &str, enabled: bool) -> Result<(), String> {
    let app = AppType::from_str(app_type).map_err(|_| format!("Invalid app type: {app_type}"))?;

    #[cfg(feature = "proxy-runtime")]
    let state = routing_state()?;
    #[cfg(feature = "proxy-runtime")]
    let db = state.db.clone();
    #[cfg(feature = "proxy-runtime")]
    let runtime = routing_runtime()?;

    #[cfg(not(feature = "proxy-runtime"))]
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    #[cfg(not(feature = "proxy-runtime"))]
    let runtime = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;

    runtime.block_on(async {
        let mut config = db
            .get_proxy_config_for_app(app_type)
            .await
            .map_err(|e| e.to_string())?;
        let previous_config = config.clone();

        if enabled && !config.enabled {
            return Err("需要先启用该应用的远程路由，再开启故障转移".to_string());
        }

        let mut auto_added_provider_id: Option<String> = None;
        let p1_provider_id = if enabled {
            let mut queue = db.get_failover_queue(app_type).map_err(|e| e.to_string())?;
            if queue.is_empty() {
                let current_id = crate::settings::get_effective_current_provider(&db, &app)
                    .map_err(|e| e.to_string())?
                    .ok_or_else(|| {
                        "故障转移队列为空，且未设置当前供应商，无法开启故障转移".to_string()
                    })?;

                db.add_to_failover_queue(app_type, &current_id)
                    .map_err(|e| e.to_string())?;
                auto_added_provider_id = Some(current_id);

                queue = db.get_failover_queue(app_type).map_err(|e| e.to_string())?;
            }

            queue
                .first()
                .map(|item| item.provider_id.clone())
                .ok_or_else(|| "故障转移队列为空，无法开启故障转移".to_string())?
        } else {
            String::new()
        };

        #[cfg(not(feature = "proxy-runtime"))]
        if enabled {
            if let Some(provider_id) = auto_added_provider_id {
                let _ = db.remove_from_failover_queue(app_type, &provider_id);
            }
            return Err(
                "This helper build does not include remote routing runtime support".to_string(),
            );
        }

        config.auto_failover_enabled = enabled;
        if let Err(error) = db.update_proxy_config_for_app(config).await {
            if let Some(provider_id) = auto_added_provider_id {
                let _ = db.remove_from_failover_queue(app_type, &provider_id);
            }
            return Err(error.to_string());
        }

        if enabled {
            #[cfg(feature = "proxy-runtime")]
            if let Err(error) = state
                .proxy_service
                .switch_proxy_target(app_type, &p1_provider_id)
                .await
            {
                let _ = db.update_proxy_config_for_app(previous_config).await;
                if let Some(provider_id) = auto_added_provider_id {
                    let _ = db.remove_from_failover_queue(app_type, &provider_id);
                }
                return Err(error);
            }
        }

        Ok(())
    })
}

pub fn update_routing_app_config(config_json: &str) -> Result<(), String> {
    let config: crate::proxy::types::AppProxyConfig =
        serde_json::from_str(config_json).map_err(|e| e.to_string())?;

    #[cfg(feature = "proxy-runtime")]
    {
        let state = routing_state()?;
        let db = state.db.clone();
        let runtime = routing_runtime()?;
        runtime.block_on(async {
            let previous = db
                .get_proxy_config_for_app(&config.app_type)
                .await
                .map_err(|e| e.to_string())?;
            let app_type = config.app_type.clone();
            let desired_enabled = config.enabled;
            let enabled_changed = previous.enabled != config.enabled;

            if desired_enabled {
                let preflight = state.proxy_service.preflight_takeover_for_app(&app_type)?;
                if !preflight.can_enable {
                    return Err(preflight
                        .reason
                        .unwrap_or_else(|| "当前应用不满足远程路由启用条件".to_string()));
                }
            }

            if !desired_enabled {
                if let Err(error) = state
                    .proxy_service
                    .set_takeover_for_app(&app_type, false)
                    .await
                {
                    let _ = db.update_proxy_config_for_app(previous).await;
                    return Err(error);
                }

                db.update_proxy_config_for_app(config)
                    .await
                    .map_err(|e| e.to_string())?;
                return Ok(());
            }

            db.update_proxy_config_for_app(config.clone())
                .await
                .map_err(|e| e.to_string())?;

            if enabled_changed || desired_enabled {
                let runtime_status = if desired_enabled {
                    Some(effective_routing_runtime_status(state).await?)
                } else {
                    None
                };
                let external_runtime_running = runtime_status
                    .as_ref()
                    .map(|status| status.running)
                    .unwrap_or(false)
                    && !state.proxy_service.is_running().await;

                if let Err(error) = state
                    .proxy_service
                    .set_takeover_for_app_with_external_runtime(
                        &app_type,
                        desired_enabled,
                        external_runtime_running,
                    )
                    .await
                {
                    let _ = db.update_proxy_config_for_app(previous).await;
                    return Err(error);
                }
            }

            Ok(())
        })
    }

    #[cfg(not(feature = "proxy-runtime"))]
    {
        if config.enabled {
            return Err(
                "This helper build does not include remote routing runtime support".to_string(),
            );
        }

        let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
        let runtime = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
        return runtime
            .block_on(db.update_proxy_config_for_app(config))
            .map_err(|e| e.to_string());
    }
}

pub fn get_routing_provider_health(
    app_type: &str,
    provider_id: &str,
) -> Result<crate::proxy::types::ProviderHealth, String> {
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    let runtime = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
    runtime
        .block_on(db.get_provider_health(provider_id, app_type))
        .map_err(|e| e.to_string())
}

pub fn reset_routing_circuit_breaker(app_type: &str, provider_id: &str) -> Result<(), String> {
    #[cfg(feature = "proxy-runtime")]
    let state = routing_state()?;
    #[cfg(feature = "proxy-runtime")]
    let db = state.db.clone();
    #[cfg(feature = "proxy-runtime")]
    let runtime = routing_runtime()?;

    #[cfg(not(feature = "proxy-runtime"))]
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    #[cfg(not(feature = "proxy-runtime"))]
    let runtime = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;

    runtime.block_on(async {
        db.update_provider_health(provider_id, app_type, true, None)
            .await
            .map_err(|e| e.to_string())?;

        #[cfg(feature = "proxy-runtime")]
        {
            state
                .proxy_service
                .reset_provider_circuit_breaker(provider_id, app_type)
                .await?;

            let config = db
                .get_proxy_config_for_app(app_type)
                .await
                .map_err(|e| e.to_string())?;

            if config.enabled
                && config.auto_failover_enabled
                && state.proxy_service.is_running().await
            {
                let current_id = db
                    .get_current_provider(app_type)
                    .map_err(|e| e.to_string())?;
                if let Some(current_id) = current_id {
                    let queue = db.get_failover_queue(app_type).map_err(|e| e.to_string())?;
                    let restored_order = queue
                        .iter()
                        .find(|item| item.provider_id == provider_id)
                        .and_then(|item| item.sort_index);
                    let current_order = queue
                        .iter()
                        .find(|item| item.provider_id == current_id)
                        .and_then(|item| item.sort_index);

                    if let (Some(restored), Some(current)) = (restored_order, current_order) {
                        if restored < current {
                            let provider_name = db
                                .get_all_providers(app_type)
                                .ok()
                                .and_then(|providers| {
                                    providers.get(provider_id).map(|p| p.name.clone())
                                })
                                .unwrap_or_else(|| provider_id.to_string());
                            let switch_manager =
                                crate::proxy::failover_switch::FailoverSwitchManager::new(
                                    db.clone(),
                                );
                            if let Err(error) = switch_manager
                                .try_switch(None, app_type, provider_id, &provider_name)
                                .await
                            {
                                log::error!("[Recovery] 远程熔断器重置后自动切换失败: {error}");
                            }
                        }
                    }
                }
            }
        }

        Ok(())
    })
}

pub fn get_routing_circuit_breaker_config() -> Result<crate::proxy::CircuitBreakerConfig, String> {
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    let runtime = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
    runtime
        .block_on(db.get_circuit_breaker_config())
        .map_err(|e| e.to_string())
}

pub fn update_routing_circuit_breaker_config(config_json: &str) -> Result<(), String> {
    let config: crate::proxy::CircuitBreakerConfig =
        serde_json::from_str(config_json).map_err(|e| e.to_string())?;

    #[cfg(feature = "proxy-runtime")]
    let state = routing_state()?;
    #[cfg(feature = "proxy-runtime")]
    let db = state.db.clone();
    #[cfg(feature = "proxy-runtime")]
    let runtime = routing_runtime()?;

    #[cfg(not(feature = "proxy-runtime"))]
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    #[cfg(not(feature = "proxy-runtime"))]
    let runtime = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;

    runtime.block_on(async {
        db.update_circuit_breaker_config(&config)
            .await
            .map_err(|e| e.to_string())?;
        #[cfg(feature = "proxy-runtime")]
        state
            .proxy_service
            .update_circuit_breaker_configs(config)
            .await?;
        Ok(())
    })
}

pub fn get_routing_circuit_breaker_stats(
    app_type: &str,
    provider_id: &str,
) -> Result<Option<crate::proxy::CircuitBreakerStats>, String> {
    #[cfg(feature = "proxy-runtime")]
    {
        let state = routing_state()?;
        let runtime = routing_runtime()?;
        runtime.block_on(
            state
                .proxy_service
                .get_circuit_breaker_stats(provider_id, app_type),
        )
    }

    #[cfg(not(feature = "proxy-runtime"))]
    {
        let _ = (app_type, provider_id);
        Ok(None)
    }
}

pub fn get_routing_rectifier_config() -> Result<crate::proxy::types::RectifierConfig, String> {
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    db.get_rectifier_config().map_err(|e| e.to_string())
}

pub fn set_routing_rectifier_config(config_json: &str) -> Result<bool, String> {
    let config: crate::proxy::types::RectifierConfig =
        serde_json::from_str(config_json).map_err(|e| e.to_string())?;
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    db.set_rectifier_config(&config)
        .map_err(|e| e.to_string())?;
    Ok(true)
}

pub fn get_routing_optimizer_config() -> Result<crate::proxy::types::OptimizerConfig, String> {
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    db.get_optimizer_config().map_err(|e| e.to_string())
}

pub fn set_routing_optimizer_config(config_json: &str) -> Result<bool, String> {
    let config: crate::proxy::types::OptimizerConfig =
        serde_json::from_str(config_json).map_err(|e| e.to_string())?;
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    db.set_optimizer_config(&config)
        .map_err(|e| e.to_string())?;
    Ok(true)
}

pub fn get_routing_global_outbound_proxy() -> Result<Option<String>, String> {
    let db = Database::init().map_err(|e| e.to_string())?;
    db.get_global_proxy_url().map_err(|e| e.to_string())
}

pub fn set_routing_global_outbound_proxy(url: &str) -> Result<(), String> {
    let db = Database::init().map_err(|e| e.to_string())?;
    let url = if url.trim().is_empty() || url == "-" {
        None
    } else {
        Some(url.trim())
    };
    db.set_global_proxy_url(url).map_err(|e| e.to_string())
}

pub fn export_database_sql() -> Result<String, String> {
    let db = Database::init().map_err(|e| e.to_string())?;
    db.export_sql_string().map_err(|e| e.to_string())
}

pub fn import_database_sql_b64(encoded_sql: &str) -> Result<Value, String> {
    let sql_bytes = {
        use base64::{engine::general_purpose::STANDARD, Engine as _};
        STANDARD.decode(encoded_sql).map_err(|e| e.to_string())?
    };
    let sql = String::from_utf8(sql_bytes).map_err(|e| e.to_string())?;
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    let backup_id = db.import_sql_string(&sql).map_err(|e| e.to_string())?;
    let sync_warning = {
        let state = AppState::new(db);
        ProviderService::sync_current_to_live(&state)
            .and_then(|_| crate::settings::reload_settings())
            .err()
            .map(|e| e.to_string())
    };

    let mut payload = json!({
        "success": true,
        "message": "SQL imported successfully",
        "backupId": backup_id
    });
    if let Some(warning) = sync_warning {
        payload["warning"] = Value::String(warning);
    }
    Ok(payload)
}

pub fn preflight_database_sql_b64(
    encoded_sql: &str,
    source: crate::remote_restore_preflight::SourceKind,
) -> Result<crate::remote_restore_preflight::RestorePreflightReport, String> {
    let sql_bytes = {
        use base64::{engine::general_purpose::STANDARD, Engine as _};
        STANDARD.decode(encoded_sql).map_err(|e| e.to_string())?
    };
    let sql = String::from_utf8(sql_bytes).map_err(|e| e.to_string())?;
    crate::remote_restore_preflight::preflight_sql(&sql, source).map_err(|e| e.to_string())
}

pub fn import_database_sql_b64_with_mode(
    encoded_sql: &str,
    mode: crate::remote_restore_preflight::RestoreMode,
) -> Result<Value, String> {
    let sql_bytes = {
        use base64::{engine::general_purpose::STANDARD, Engine as _};
        STANDARD.decode(encoded_sql).map_err(|e| e.to_string())?
    };
    let sql = String::from_utf8(sql_bytes).map_err(|e| e.to_string())?;
    let sql = match mode {
        crate::remote_restore_preflight::RestoreMode::Exact => sql,
        crate::remote_restore_preflight::RestoreMode::PortableProvider => {
            crate::remote_restore_preflight::transform_sql_for_portable_restore(&sql)
                .map_err(|e| e.to_string())?
        }
    };
    let encoded = {
        use base64::{engine::general_purpose::STANDARD, Engine as _};
        STANDARD.encode(sql)
    };
    import_database_sql_b64(&encoded)
}

pub fn create_database_backup() -> Result<String, String> {
    let db = Database::init().map_err(|e| e.to_string())?;
    let path = db
        .backup_database_file()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Database file not found, backup skipped".to_string())?;
    Ok(path
        .file_name()
        .map(|filename| filename.to_string_lossy().into_owned())
        .unwrap_or_default())
}

pub fn list_database_backups() -> Result<Vec<crate::database::backup::BackupEntry>, String> {
    Database::list_backups().map_err(|e| e.to_string())
}

pub fn restore_database_backup(filename: &str) -> Result<String, String> {
    let db = Database::init().map_err(|e| e.to_string())?;
    db.restore_from_backup(filename).map_err(|e| e.to_string())
}

pub fn rename_database_backup(old_filename: &str, new_name: &str) -> Result<String, String> {
    Database::rename_backup(old_filename, new_name).map_err(|e| e.to_string())
}

pub fn delete_database_backup(filename: &str) -> Result<bool, String> {
    Database::delete_backup(filename).map_err(|e| e.to_string())?;
    Ok(true)
}

fn live_config_missing_as_false(error: AppError) -> Result<bool, String> {
    match &error {
        AppError::Localized { key, .. }
            if matches!(
                *key,
                "claude.live.missing"
                    | "codex.live.missing"
                    | "gemini.live.missing"
                    | "opencode.config.missing"
                    | "openclaw.config.missing"
                    | "hermes.config.missing"
            ) =>
        {
            Ok(false)
        }
        _ => Err(error.to_string()),
    }
}

fn import_default_config_internal(state: &AppState, app_type: AppType) -> Result<bool, AppError> {
    let imported = ProviderService::import_default_config(state, app_type.clone())?;

    if imported {
        if state
            .db
            .should_auto_extract_config_snippet(app_type.as_str())?
        {
            match ProviderService::extract_common_config_snippet(state, app_type.clone()) {
                Ok(snippet) if !snippet.is_empty() && snippet != "{}" => {
                    let _ = state
                        .db
                        .set_config_snippet(app_type.as_str(), Some(snippet));
                    let _ = state
                        .db
                        .set_config_snippet_cleared(app_type.as_str(), false);
                }
                _ => {}
            }
        }

        ProviderService::migrate_legacy_common_config_usage_if_needed(state, app_type)?;
    }

    Ok(imported)
}

pub fn get_openclaw_default_model(
) -> Result<Option<crate::openclaw_config::OpenClawDefaultModel>, String> {
    crate::openclaw_config::get_default_model().map_err(|e| e.to_string())
}

pub fn set_openclaw_default_model(
    model_json: &str,
) -> Result<crate::openclaw_config::OpenClawWriteOutcome, String> {
    let model: crate::openclaw_config::OpenClawDefaultModel =
        serde_json::from_str(model_json).map_err(|e| e.to_string())?;
    crate::openclaw_config::set_default_model(&model).map_err(|e| e.to_string())
}

pub fn get_openclaw_env() -> Result<crate::openclaw_config::OpenClawEnvConfig, String> {
    crate::openclaw_config::get_env_config().map_err(|e| e.to_string())
}

pub fn set_openclaw_env(
    env_json: &str,
) -> Result<crate::openclaw_config::OpenClawWriteOutcome, String> {
    let env: crate::openclaw_config::OpenClawEnvConfig =
        serde_json::from_str(env_json).map_err(|e| e.to_string())?;
    crate::openclaw_config::set_env_config(&env).map_err(|e| e.to_string())
}

pub fn get_openclaw_tools() -> Result<crate::openclaw_config::OpenClawToolsConfig, String> {
    crate::openclaw_config::get_tools_config().map_err(|e| e.to_string())
}

pub fn set_openclaw_tools(
    tools_json: &str,
) -> Result<crate::openclaw_config::OpenClawWriteOutcome, String> {
    let tools: crate::openclaw_config::OpenClawToolsConfig =
        serde_json::from_str(tools_json).map_err(|e| e.to_string())?;
    crate::openclaw_config::set_tools_config(&tools).map_err(|e| e.to_string())
}

pub fn get_openclaw_agents_defaults(
) -> Result<Option<crate::openclaw_config::OpenClawAgentsDefaults>, String> {
    crate::openclaw_config::get_agents_defaults().map_err(|e| e.to_string())
}

pub fn set_openclaw_agents_defaults(
    defaults_json: &str,
) -> Result<crate::openclaw_config::OpenClawWriteOutcome, String> {
    let defaults: crate::openclaw_config::OpenClawAgentsDefaults =
        serde_json::from_str(defaults_json).map_err(|e| e.to_string())?;
    crate::openclaw_config::set_agents_defaults(&defaults).map_err(|e| e.to_string())
}

pub fn scan_openclaw_health() -> Result<Vec<crate::openclaw_config::OpenClawHealthWarning>, String>
{
    crate::openclaw_config::scan_openclaw_config_health().map_err(|e| e.to_string())
}

pub fn list_mcp_servers() -> Result<IndexMap<String, McpServer>, String> {
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    let state = AppState::new(db);
    McpService::get_all_servers(&state).map_err(|e| e.to_string())
}

pub fn upsert_mcp_server(server_json: &str) -> Result<(), String> {
    let server: McpServer = serde_json::from_str(server_json).map_err(|e| e.to_string())?;
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    let state = AppState::new(db);
    McpService::upsert_server(&state, server).map_err(|e| e.to_string())
}

pub fn delete_mcp_server(id: &str) -> Result<bool, String> {
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    let state = AppState::new(db);
    McpService::delete_server(&state, id).map_err(|e| e.to_string())
}

pub fn toggle_mcp_app(server_id: &str, app: AppType, enabled: bool) -> Result<(), String> {
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    let state = AppState::new(db);
    McpService::toggle_app(&state, server_id, app, enabled).map_err(|e| e.to_string())
}

pub fn import_mcp_from_apps() -> Result<usize, String> {
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    let state = AppState::new(db);
    McpService::import_from_supported_apps(&state).map_err(|e| e.to_string())
}

pub fn list_prompts(app: AppType) -> Result<IndexMap<String, Prompt>, String> {
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    let state = AppState::new(db);
    PromptService::get_prompts(&state, app).map_err(|e| e.to_string())
}

pub fn upsert_prompt(app: AppType, id: &str, prompt_json: &str) -> Result<(), String> {
    let prompt: Prompt = serde_json::from_str(prompt_json).map_err(|e| e.to_string())?;
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    let state = AppState::new(db);
    PromptService::upsert_prompt(&state, app, id, prompt).map_err(|e| e.to_string())
}

pub fn delete_prompt(app: AppType, id: &str) -> Result<(), String> {
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    let state = AppState::new(db);
    PromptService::delete_prompt(&state, app, id).map_err(|e| e.to_string())
}

pub fn enable_prompt(app: AppType, id: &str) -> Result<(), String> {
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    let state = AppState::new(db);
    PromptService::enable_prompt(&state, app, id).map_err(|e| e.to_string())
}

pub fn import_prompt_from_file(app: AppType) -> Result<String, String> {
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    let state = AppState::new(db);
    PromptService::import_from_file(&state, app).map_err(|e| e.to_string())
}

pub fn current_prompt_file_content(app: AppType) -> Result<Option<String>, String> {
    PromptService::get_current_file_content(app).map_err(|e| e.to_string())
}

pub fn list_installed_skills() -> Result<Vec<InstalledSkill>, String> {
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    SkillService::get_all_installed(&db).map_err(|e| e.to_string())
}

pub fn list_skill_backups() -> Result<Vec<SkillBackupEntry>, String> {
    SkillService::list_backups().map_err(|e| e.to_string())
}

pub fn delete_skill_backup(backup_id: &str) -> Result<bool, String> {
    SkillService::delete_backup(backup_id).map_err(|e| e.to_string())?;
    Ok(true)
}

pub fn install_skill_unified(
    skill_json: &str,
    current_app: AppType,
) -> Result<InstalledSkill, String> {
    let skill: DiscoverableSkill = serde_json::from_str(skill_json).map_err(|e| e.to_string())?;
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    let service = SkillService::new();
    let runtime = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
    runtime
        .block_on(service.install(&db, &skill, &current_app))
        .map_err(|e| e.to_string())
}

pub fn uninstall_skill_unified(id: &str) -> Result<SkillUninstallResult, String> {
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    SkillService::uninstall(&db, id).map_err(|e| e.to_string())
}

pub fn restore_skill_backup(
    backup_id: &str,
    current_app: AppType,
) -> Result<InstalledSkill, String> {
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    SkillService::restore_from_backup(&db, backup_id, &current_app).map_err(|e| e.to_string())
}

pub fn toggle_skill_app(id: &str, app: AppType, enabled: bool) -> Result<bool, String> {
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    SkillService::toggle_app(&db, id, &app, enabled).map_err(|e| e.to_string())?;
    Ok(true)
}

pub fn scan_unmanaged_skills() -> Result<Vec<UnmanagedSkill>, String> {
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    SkillService::scan_unmanaged(&db).map_err(|e| e.to_string())
}

pub fn import_skills_from_apps(imports_json: &str) -> Result<Vec<InstalledSkill>, String> {
    let imports: Vec<ImportSkillSelection> =
        serde_json::from_str(imports_json).map_err(|e| e.to_string())?;
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    SkillService::import_from_apps(&db, imports).map_err(|e| e.to_string())
}

pub fn discover_available_skills() -> Result<Vec<DiscoverableSkill>, String> {
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    let repos = db.get_skill_repos().map_err(|e| e.to_string())?;
    let service = SkillService::new();
    let runtime = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
    runtime
        .block_on(service.discover_available(repos))
        .map_err(|e| e.to_string())
}

pub fn check_skill_updates() -> Result<Vec<SkillUpdateInfo>, String> {
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    let service = SkillService::new();
    let runtime = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
    runtime
        .block_on(service.check_updates(&db))
        .map_err(|e| e.to_string())
}

pub fn update_skill(id: &str) -> Result<InstalledSkill, String> {
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    let service = SkillService::new();
    let runtime = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
    runtime
        .block_on(service.update_skill(&db, id))
        .map_err(|e| e.to_string())
}

pub fn list_skill_repos() -> Result<Vec<SkillRepo>, String> {
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    db.get_skill_repos().map_err(|e| e.to_string())
}

pub fn add_skill_repo(repo_json: &str) -> Result<bool, String> {
    let repo: SkillRepo = serde_json::from_str(repo_json).map_err(|e| e.to_string())?;
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    db.save_skill_repo(&repo).map_err(|e| e.to_string())?;
    Ok(true)
}

pub fn remove_skill_repo(owner: &str, name: &str) -> Result<bool, String> {
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    db.delete_skill_repo(owner, name)
        .map_err(|e| e.to_string())?;
    Ok(true)
}

#[cfg(all(test, feature = "proxy-runtime"))]
mod tests {
    use super::*;

    #[test]
    fn routing_daemon_service_unit_runs_current_helper_binary() {
        let unit = routing_daemon_service_unit("/root/.local/bin/cc-switch-remote-helper");

        assert!(unit.contains("ExecStart=\"/root/.local/bin/cc-switch-remote-helper\" --json routing-runtime daemon-run"));
        assert!(unit.contains("Restart=on-failure"));
        assert!(!unit.contains("npm"));
        assert!(!unit.contains("cargo"));
    }

    #[test]
    fn routing_status_probe_url_uses_connectable_loopback_host() {
        assert_eq!(
            routing_status_probe_url("0.0.0.0", 15721),
            "http://127.0.0.1:15721/status"
        );
        assert_eq!(
            routing_status_probe_url("::", 15721),
            "http://[::1]:15721/status"
        );
        assert_eq!(
            routing_status_probe_url("192.168.1.10", 15721),
            "http://192.168.1.10:15721/status"
        );
    }
}
