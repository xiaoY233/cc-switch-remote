use crate::error::AppError;
use crate::remote::types::{
    RemoteAuthMethod, RemoteCommandError, RemoteCommandResponse, RemoteConnectionSecret,
    RemoteHostProfile,
};
use crate::remote_capabilities::REMOTE_HELPER_REQUIRED_CAPABILITIES;
use serde::de::DeserializeOwned;
use std::io::Write;
use std::process::Command;
use std::process::Stdio;

const HELPER_RELEASE_REPO: &str = "xiaoY233/cc-switch-remote";
const HELPER_RELEASE_TAG: &str = "remote-helper-latest";
const HELPER_RELEASE_REPO_ENV: &str = "CC_SWITCH_REMOTE_HELPER_RELEASE_REPO";
const HELPER_RELEASE_TAG_ENV: &str = "CC_SWITCH_REMOTE_HELPER_RELEASE_TAG";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteHelperInstallSource {
    pub release_repo: String,
    pub release_tag: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteHelperAssetTarget {
    pub asset_os: String,
    pub asset_arch: String,
}

impl Default for RemoteHelperInstallSource {
    fn default() -> Self {
        Self {
            release_repo: HELPER_RELEASE_REPO.to_string(),
            release_tag: HELPER_RELEASE_TAG.to_string(),
        }
    }
}

impl RemoteHelperInstallSource {
    pub fn from_env() -> Self {
        let default = Self::default();
        Self {
            release_repo: env_string(HELPER_RELEASE_REPO_ENV).unwrap_or(default.release_repo),
            release_tag: env_string(HELPER_RELEASE_TAG_ENV).unwrap_or(default.release_tag),
        }
    }
}

fn build_ssh_base_args(profile: &RemoteHostProfile) -> Vec<String> {
    let mut args = vec![
        "-p".to_string(),
        profile.port.to_string(),
        "-o".to_string(),
        "ConnectTimeout=10".to_string(),
        "-o".to_string(),
        "StrictHostKeyChecking=accept-new".to_string(),
        "-o".to_string(),
        "NumberOfPasswordPrompts=1".to_string(),
        "-o".to_string(),
        "ControlMaster=no".to_string(),
        "-o".to_string(),
        "ControlPersist=no".to_string(),
        "-o".to_string(),
        match &profile.auth_method {
            RemoteAuthMethod::Password => "BatchMode=no".to_string(),
            _ => "BatchMode=yes".to_string(),
        },
    ];

    match &profile.auth_method {
        RemoteAuthMethod::KeyFile { path } => {
            args.push("-i".to_string());
            args.push(path.clone());
        }
        RemoteAuthMethod::Password => {
            args.push("-o".to_string());
            args.push("PreferredAuthentications=password,keyboard-interactive".to_string());
            args.push("-o".to_string());
            args.push("PubkeyAuthentication=no".to_string());
        }
        RemoteAuthMethod::SshAgent => {}
    }

    args.push("--".to_string());
    args.push(format!("{}@{}", profile.username, profile.host));
    args
}

pub fn build_ssh_args(profile: &RemoteHostProfile, helper_args: &[String]) -> Vec<String> {
    let mut args = build_ssh_base_args(profile);

    let mut command = vec![
        shell_quote_helper_path(&profile.helper_path),
        "--json".to_string(),
    ];
    command.extend(helper_args.iter().map(|arg| shell_quote(arg)));
    args.push(command.join(" "));
    args
}

pub fn build_ssh_serve_args(profile: &RemoteHostProfile) -> Vec<String> {
    let mut args = build_ssh_base_args(profile);
    args.push(format!(
        "{} --json serve",
        shell_quote_helper_path(&profile.helper_path)
    ));
    args
}

pub fn build_helper_install_args(profile: &RemoteHostProfile) -> Vec<String> {
    build_helper_install_args_with_source(profile, &RemoteHelperInstallSource::from_env())
}

pub fn build_helper_install_args_with_source(
    profile: &RemoteHostProfile,
    source: &RemoteHelperInstallSource,
) -> Vec<String> {
    let mut args = build_ssh_base_args(profile);
    let helper_path = shell_quote_helper_path(&profile.helper_path);
    let release_repo = shell_quote(&source.release_repo);
    let release_tag = shell_quote(&source.release_tag);
    let required_capability_checks = REMOTE_HELPER_REQUIRED_CAPABILITIES
        .iter()
        .map(|capability| format!("printf '%s\\n' \"$status_json\" | grep -q '\"{capability}\"'"))
        .collect::<Vec<_>>()
        .join(" && ");
    let required_capabilities = REMOTE_HELPER_REQUIRED_CAPABILITIES.join(", ");
    let command = format!(
        concat!(
            "set -e; ",
            "helper_path={helper_path}; ",
            "helper_dir=$(dirname \"$helper_path\"); ",
            "mkdir -p \"$helper_dir\" ~/.local/bin; ",
            "fetch_url_to_stdout() {{ ",
            "if command -v curl >/dev/null 2>&1 && curl -fsSL \"$1\" 2>/dev/null; then return 0; fi; ",
            "if command -v wget >/dev/null 2>&1 && wget -qO- \"$1\" 2>/dev/null; then return 0; fi; ",
            "return 1; ",
            "}}; ",
            "fetch_url_to_file() {{ ",
            "if command -v curl >/dev/null 2>&1 && curl -fsSL \"$1\" -o \"$2\" 2>/dev/null; then return 0; fi; ",
            "if command -v wget >/dev/null 2>&1 && wget -qO \"$2\" \"$1\" 2>/dev/null; then return 0; fi; ",
            "return 1; ",
            "}}; ",
            "verify_helper_status() {{ ",
            "status_output=$(\"$helper_path\" --json status 2>&1) || {{ ",
            "case \"$status_output\" in ",
            "*libgdk-3.so.0*|*libgtk-3.so.0*|*libwebkit2gtk*|*libayatana-appindicator*) ",
            "echo 'Downloaded remote helper is not compatible with this server: it depends on desktop GTK/WebKit libraries. Reinstall after the latest helper release is published.' >&2 ;; ",
            "*) echo \"Remote helper downloaded but failed to start: $status_output\" >&2 ;; ",
            "esac; ",
            "return 65; ",
            "}}; ",
            "status_json=$status_output; ",
            "printf '%s\\n' \"$status_json\"; ",
            "{required_capability_checks} && return 0; ",
            "echo 'cc-switch-remote helper is missing required capabilities; install a helper build that includes {required_capabilities}' >&2; ",
            "return 64; ",
            "}}; ",
            "try_release_asset_install() {{ ",
            "if ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1; then ",
            "echo 'Remote server cannot download helper: curl or wget is required for remote-side download.' >&2; ",
            "return 1; ",
            "fi; ",
            "asset_os=$(uname -s); ",
            "case \"$asset_os\" in Linux) asset_os=Linux ;; Darwin) asset_os=macOS ;; *) asset_os= ;; esac; ",
            "asset_arch=$(uname -m); ",
            "case \"$asset_arch\" in x86_64|amd64) asset_arch=x86_64 ;; arm64|aarch64) asset_arch=arm64 ;; *) asset_arch= ;; esac; ",
            "if [ -z \"$asset_os\" ] || [ -z \"$asset_arch\" ]; then ",
            "echo \"Remote helper is not available for this server platform: $(uname -s)/$(uname -m).\" >&2; ",
            "return 1; ",
            "fi; ",
            "download_base=https://github.com/{release_repo}/releases/download/{release_tag}; ",
            "for asset_name in cc-switch-remote-helper-latest-${{asset_os}}-${{asset_arch}} cc-switch-remote-helper-{release_tag}-${{asset_os}}-${{asset_arch}} cc-switch-remote-helper-latest-${{asset_os}}-universal cc-switch-remote-helper-{release_tag}-${{asset_os}}-universal cc-switch-cli-latest-${{asset_os}}-${{asset_arch}} cc-switch-cli-{release_tag}-${{asset_os}}-${{asset_arch}} cc-switch-cli-latest-${{asset_os}}-universal cc-switch-cli-{release_tag}-${{asset_os}}-universal; do ",
            "helper_tmp=$(mktemp); ",
            "if fetch_url_to_file \"$download_base/$asset_name\" \"$helper_tmp\" 1>&2; then ",
            "chmod +x \"$helper_tmp\"; ",
            "mv \"$helper_tmp\" \"$helper_path\"; ",
            "return 0; ",
            "fi; ",
            "rm -f \"$helper_tmp\"; ",
            "done; ",
            "api_url=https://api.github.com/repos/{release_repo}/releases/tags/{release_tag}; ",
            "asset_pattern=\"(cc-switch-remote-helper|cc-switch-cli)-.*-${{asset_os}}-${{asset_arch}}$\"; ",
            "release_json=$(fetch_url_to_stdout \"$api_url\") || {{ ",
            "echo 'Remote server failed to query GitHub helper release. The desktop app will try local download fallback when available.' >&2; ",
            "return 1; ",
            "}}; ",
            "download_url=$(printf '%s\\n' \"$release_json\" | grep -E '\"browser_download_url\":' | sed -E 's/.*\"browser_download_url\": \"([^\"]+)\".*/\\1/' | grep -E \"$asset_pattern\" | tail -1 || true); ",
            "if [ -z \"$download_url\" ]; then ",
            "echo 'No compatible cc-switch-remote helper release asset found on GitHub release {release_tag}' >&2; ",
            "return 1; ",
            "fi; ",
            "helper_tmp=$(mktemp); ",
            "fetch_url_to_file \"$download_url\" \"$helper_tmp\" 1>&2 || {{ ",
            "rm -f \"$helper_tmp\"; ",
            "echo 'Remote server failed to download the compatible helper asset from GitHub. The desktop app will try local download fallback when available.' >&2; ",
            "return 1; ",
            "}}; ",
            "chmod +x \"$helper_tmp\"; ",
            "mv \"$helper_tmp\" \"$helper_path\"; ",
            "return 0; ",
            "}}; ",
            "if try_release_asset_install; then ",
            "verify_helper_status; ",
            "exit 0; ",
            "fi; ",
            "echo 'Remote-side helper install failed before verification.' >&2; ",
            "exit 1"
        ),
        helper_path = helper_path,
        release_repo = release_repo,
        release_tag = release_tag,
        required_capability_checks = required_capability_checks,
        required_capabilities = required_capabilities,
    );
    args.push(command);
    args
}

pub fn detect_helper_asset_target(
    profile: &RemoteHostProfile,
    secret: Option<&RemoteConnectionSecret>,
) -> Result<RemoteHelperAssetTarget, AppError> {
    let mut args = build_ssh_base_args(profile);
    args.push("printf '%s %s\\n' \"$(uname -s)\" \"$(uname -m)\"".to_string());

    let stdout = run_ssh_command(profile, args, secret)?;
    let mut parts = stdout.split_whitespace();
    let os = parts.next().unwrap_or_default();
    let arch = parts.next().unwrap_or_default();
    helper_asset_target_from_uname(os, arch).ok_or_else(|| {
        AppError::Message(format!(
            "Remote helper is not available for this server platform: {os}/{arch}."
        ))
    })
}

pub fn upload_helper_bytes_and_verify_json<T: DeserializeOwned>(
    profile: &RemoteHostProfile,
    secret: Option<&RemoteConnectionSecret>,
    helper_bytes: &[u8],
) -> Result<T, AppError> {
    let mut args = build_ssh_base_args(profile);
    let helper_path = shell_quote_helper_path(&profile.helper_path);
    args.push(format!(
        concat!(
            "set -e; ",
            "helper_path={helper_path}; ",
            "helper_dir=$(dirname \"$helper_path\"); ",
            "mkdir -p \"$helper_dir\" ~/.local/bin; ",
            "helper_tmp=$(mktemp); ",
            "cat > \"$helper_tmp\"; ",
            "chmod +x \"$helper_tmp\"; ",
            "mv \"$helper_tmp\" \"$helper_path\"; ",
            "\"$helper_path\" --json status"
        ),
        helper_path = helper_path
    ));

    let stdout = run_ssh_command_with_stdin(profile, args, secret, helper_bytes)?;
    parse_helper_json(&stdout)
}

fn helper_asset_target_from_uname(os: &str, arch: &str) -> Option<RemoteHelperAssetTarget> {
    let asset_os = match os {
        "Linux" => "Linux",
        "Darwin" => "macOS",
        _ => return None,
    };
    let asset_arch = if asset_os == "macOS" {
        "universal"
    } else {
        match arch {
            "x86_64" | "amd64" => "x86_64",
            "aarch64" | "arm64" => "arm64",
            _ => return None,
        }
    };

    Some(RemoteHelperAssetTarget {
        asset_os: asset_os.to_string(),
        asset_arch: asset_arch.to_string(),
    })
}

pub fn run_helper_json<T: DeserializeOwned>(
    profile: &RemoteHostProfile,
    helper_args: &[String],
    secret: Option<&RemoteConnectionSecret>,
) -> Result<T, AppError> {
    let stdout = run_ssh_command(profile, build_ssh_args(profile, helper_args), secret)?;
    parse_helper_json(&stdout)
}

pub fn install_helper_json<T: DeserializeOwned>(
    profile: &RemoteHostProfile,
    secret: Option<&RemoteConnectionSecret>,
) -> Result<T, AppError> {
    let stdout = run_ssh_command(
        profile,
        build_helper_install_args_with_source(profile, &RemoteHelperInstallSource::from_env()),
        secret,
    )?;
    parse_helper_json(&stdout)
}

fn run_ssh_command(
    profile: &RemoteHostProfile,
    args: Vec<String>,
    secret: Option<&RemoteConnectionSecret>,
) -> Result<String, AppError> {
    let mut command = Command::new("ssh");
    command.args(args);

    let _askpass = configure_password_auth(profile, secret, &mut command)?;
    let output = command
        .output()
        .map_err(|e| AppError::Message(format!("Failed to execute ssh: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppError::Message(if stderr.is_empty() {
            format!("Remote ssh command failed with status {}", output.status)
        } else {
            normalize_remote_stderr(profile, &stderr)
        }));
    }

    String::from_utf8(output.stdout)
        .map_err(|e| AppError::Message(format!("Remote helper returned invalid UTF-8: {e}")))
}

fn run_ssh_command_with_stdin(
    profile: &RemoteHostProfile,
    args: Vec<String>,
    secret: Option<&RemoteConnectionSecret>,
    stdin_bytes: &[u8],
) -> Result<String, AppError> {
    let mut command = Command::new("ssh");
    command.args(args);
    command.stdin(Stdio::piped());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());

    let _askpass = configure_password_auth(profile, secret, &mut command)?;
    let mut child = command
        .spawn()
        .map_err(|e| AppError::Message(format!("Failed to execute ssh: {e}")))?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| AppError::Message("Failed to open ssh stdin".to_string()))?;
    stdin
        .write_all(stdin_bytes)
        .map_err(|e| AppError::Message(format!("Failed to write helper to ssh stdin: {e}")))?;
    drop(stdin);

    let output = child
        .wait_with_output()
        .map_err(|e| AppError::Message(format!("Failed to wait for ssh: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppError::Message(if stderr.is_empty() {
            format!("Remote ssh command failed with status {}", output.status)
        } else {
            normalize_remote_stderr(profile, &stderr)
        }));
    }

    String::from_utf8(output.stdout)
        .map_err(|e| AppError::Message(format!("Remote helper returned invalid UTF-8: {e}")))
}

pub(crate) fn normalize_remote_stderr(profile: &RemoteHostProfile, stderr: &str) -> String {
    if stderr.contains("libgdk-3.so.0")
        || stderr.contains("libgtk-3.so.0")
        || stderr.contains("libwebkit2gtk")
        || stderr.contains("libayatana-appindicator")
    {
        "远程 Helper 不是纯 CLI 构建，依赖服务器上不存在的桌面 GTK/WebKit 库。请重新安装最新的远程 Helper。".to_string()
    } else if is_changed_host_key_error(stderr) {
        let host = extract_changed_host_key_host(stderr).unwrap_or(profile.host.as_str());
        let location = extract_offending_known_hosts_entry(stderr)
            .map(|entry| format!("冲突记录：{entry}。"))
            .unwrap_or_default();
        format!(
            "远程主机密钥已变更，SSH 已拒绝连接以防止中间人攻击。若你确认这台服务器刚重装、重置或更换过系统，请在本机终端执行：ssh-keygen -R {host}，然后重新连接并确认新的主机指纹。{location}"
        )
    } else if is_ssh_auth_error(stderr) {
        format!(
            "SSH 认证失败：当前密钥或密码无法登录 {}@{}:{}。请检查远程账号、密钥文件、密码或服务器 authorized_keys。",
            profile.username, profile.host, profile.port
        )
    } else if is_ssh_connection_refused(stderr) {
        let endpoint = extract_ssh_connect_endpoint(stderr)
            .unwrap_or_else(|| format!("{}:{}", profile.host, profile.port));
        format!(
            "SSH 连接被拒绝：{endpoint} 没有 SSH 服务监听，或连接被防火墙拒绝。请检查服务器 IP、端口和 sshd 状态。"
        )
    } else if is_ssh_timeout(stderr) {
        let endpoint = extract_ssh_connect_endpoint(stderr)
            .unwrap_or_else(|| format!("{}:{}", profile.host, profile.port));
        format!(
            "SSH 连接超时：无法连接到 {endpoint}。请检查网络、VPN、服务器状态、防火墙和 SSH 端口。"
        )
    } else if let Some(host) = extract_unresolved_ssh_host(stderr) {
        format!(
            "SSH 主机名无法解析：{host}。请检查远程服务器地址是否填写正确，或检查本机 DNS/网络。"
        )
    } else if is_ssh_control_socket_error(stderr) {
        "SSH 连接复用控制 socket 异常，连接尚未到达远程 Helper。当前版本已默认禁用 SSH ControlMaster；请升级客户端后重试。若仍然出现，请检查本机 ~/.ssh/config 中该主机的 ControlMaster/ControlPath 配置。".to_string()
    } else if is_helper_missing_error(profile, stderr) {
        format!(
            "远程 Helper 未安装或路径不正确。请点击“安装 Helper”，或在远程服务器配置中修正 Helper 路径（当前：{}）。",
            profile.helper_path
        )
    } else {
        stderr.to_string()
    }
}

fn is_changed_host_key_error(stderr: &str) -> bool {
    stderr.contains("REMOTE HOST IDENTIFICATION HAS CHANGED")
        || (stderr.contains("Host key for ")
            && stderr.contains(" has changed")
            && stderr.contains("Host key verification failed"))
}

fn extract_changed_host_key_host(stderr: &str) -> Option<&str> {
    for line in stderr.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("Host key for ") {
            if let Some((host, _)) = rest.split_once(" has changed") {
                return Some(host.trim());
            }
        }
    }
    None
}

fn extract_offending_known_hosts_entry(stderr: &str) -> Option<String> {
    for line in stderr.lines() {
        let line = line.trim();
        if let Some((_, location)) = line.split_once(" in ") {
            if line.starts_with("Offending ") && line.contains(" key in ") {
                return Some(location.trim_end_matches('.').to_string());
            }
        }
    }
    None
}

fn is_ssh_auth_error(stderr: &str) -> bool {
    stderr.contains("Permission denied")
        || stderr.contains("Authentication failed")
        || stderr.contains("Too many authentication failures")
}

fn is_ssh_connection_refused(stderr: &str) -> bool {
    stderr.contains("Connection refused")
}

fn is_ssh_timeout(stderr: &str) -> bool {
    stderr.contains("Operation timed out")
        || stderr.contains("Connection timed out")
        || stderr.contains("Connection timeout")
}

fn extract_ssh_connect_endpoint(stderr: &str) -> Option<String> {
    for line in stderr.lines() {
        let Some(rest) = line.split("connect to host ").nth(1) else {
            continue;
        };
        let Some((host, rest)) = rest.split_once(" port ") else {
            continue;
        };
        let port = rest
            .split(|ch: char| ch == ':' || ch.is_whitespace())
            .next()
            .unwrap_or("")
            .trim();
        if !host.trim().is_empty() && !port.is_empty() {
            return Some(format!("{}:{}", host.trim(), port));
        }
    }
    None
}

fn extract_unresolved_ssh_host(stderr: &str) -> Option<&str> {
    for line in stderr.lines() {
        let line = line.trim();
        let Some(rest) = line.strip_prefix("ssh: Could not resolve hostname ") else {
            continue;
        };
        let host = rest
            .split(|ch: char| ch == ':' || ch.is_whitespace())
            .next()
            .unwrap_or("")
            .trim();
        if !host.is_empty() {
            return Some(host);
        }
    }
    None
}

fn is_ssh_control_socket_error(stderr: &str) -> bool {
    stderr.contains("getsockname failed: Not a socket")
        || stderr.contains("Control socket connect")
        || stderr.contains("mux_client_hello_exchange")
}

fn is_helper_missing_error(profile: &RemoteHostProfile, stderr: &str) -> bool {
    let mentions_helper = stderr.contains("cc-switch-remote-helper")
        || stderr.contains("cc-switch-cli")
        || stderr.contains(profile.helper_path.as_str());
    let stderr_lower = stderr.to_lowercase();
    mentions_helper
        && (stderr_lower.contains("no such file or directory")
            || stderr_lower.contains("not found")
            || stderr.contains("没有那个文件或目录"))
}

fn parse_helper_json<T: DeserializeOwned>(stdout: &str) -> Result<T, AppError> {
    let json_line = stdout
        .lines()
        .rev()
        .find(|line| !line.trim().is_empty())
        .unwrap_or(stdout)
        .trim();
    let envelope: RemoteCommandResponse<T> = serde_json::from_str(json_line)
        .map_err(|e| AppError::Message(format!("Remote helper returned invalid JSON: {e}")))?;

    if envelope.ok {
        if let Some(data) = envelope.data {
            Ok(data)
        } else {
            serde_json::from_value(serde_json::Value::Null).map_err(|_| {
                AppError::Message("Remote helper returned ok without data".to_string())
            })
        }
    } else {
        let RemoteCommandError { code, message } = envelope.error.unwrap_or(RemoteCommandError {
            code: "remote_error".to_string(),
            message: "Remote helper command failed".to_string(),
        });
        Err(AppError::Message(format!("{code}: {message}")))
    }
}

fn env_string(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

#[cfg(unix)]
fn create_askpass_script() -> Result<tempfile::TempPath, AppError> {
    use std::io::Write;
    use std::os::unix::fs::PermissionsExt;

    let mut askpass = tempfile::Builder::new()
        .prefix("cc-switch-ssh-askpass-")
        .tempfile()
        .map_err(|e| AppError::Message(format!("Failed to create ssh askpass helper: {e}")))?;
    askpass
        .write_all(b"#!/bin/sh\nprintf '%s' \"$CC_SWITCH_REMOTE_SSH_PASSWORD\"\n")
        .map_err(|e| AppError::Message(format!("Failed to write ssh askpass helper: {e}")))?;
    let mut perms = askpass
        .as_file()
        .metadata()
        .map_err(|e| AppError::Message(format!("Failed to inspect ssh askpass helper: {e}")))?
        .permissions();
    perms.set_mode(0o700);
    askpass
        .as_file()
        .set_permissions(perms)
        .map_err(|e| AppError::Message(format!("Failed to secure ssh askpass helper: {e}")))?;
    Ok(askpass.into_temp_path())
}

#[cfg(unix)]
fn password_for_profile(
    profile: &RemoteHostProfile,
    secret: Option<&RemoteConnectionSecret>,
) -> Result<Option<String>, AppError> {
    if !matches!(profile.auth_method, RemoteAuthMethod::Password) {
        return Ok(None);
    }

    let stored_secret = if secret
        .and_then(|secret| secret.password.as_deref())
        .filter(|password| !password.is_empty())
        .is_none()
    {
        crate::remote::store::load_profile_secret(&profile.id).ok()
    } else {
        None
    };
    let password = secret
        .and_then(|secret| secret.password.as_deref())
        .or_else(|| {
            stored_secret
                .as_ref()
                .and_then(|secret| secret.password.as_deref())
        })
        .filter(|password| !password.is_empty())
        .ok_or_else(|| AppError::Message("Remote SSH password is required".to_string()))?;

    Ok(Some(password.to_string()))
}

#[cfg(unix)]
fn configure_password_auth(
    profile: &RemoteHostProfile,
    secret: Option<&RemoteConnectionSecret>,
    command: &mut Command,
) -> Result<Option<tempfile::TempPath>, AppError> {
    let Some(password) = password_for_profile(profile, secret)? else {
        return Ok(None);
    };
    let askpass_path = create_askpass_script()?;
    command.env("SSH_ASKPASS", &askpass_path);
    command.env("SSH_ASKPASS_REQUIRE", "force");
    command.env("DISPLAY", "cc-switch");
    command.env("CC_SWITCH_REMOTE_SSH_PASSWORD", password);
    Ok(Some(askpass_path))
}

#[cfg(unix)]
pub fn configure_password_auth_for_tokio(
    profile: &RemoteHostProfile,
    secret: Option<&RemoteConnectionSecret>,
    command: &mut tokio::process::Command,
) -> Result<Option<tempfile::TempPath>, AppError> {
    let Some(password) = password_for_profile(profile, secret)? else {
        return Ok(None);
    };
    let askpass_path = create_askpass_script()?;
    command.env("SSH_ASKPASS", &askpass_path);
    command.env("SSH_ASKPASS_REQUIRE", "force");
    command.env("DISPLAY", "cc-switch");
    command.env("CC_SWITCH_REMOTE_SSH_PASSWORD", password);
    Ok(Some(askpass_path))
}

#[cfg(not(unix))]
fn configure_password_auth(
    profile: &RemoteHostProfile,
    _secret: Option<&RemoteConnectionSecret>,
    _command: &mut Command,
) -> Result<Option<()>, AppError> {
    if matches!(profile.auth_method, RemoteAuthMethod::Password) {
        return Err(AppError::Message(
            "Remote SSH password auth is only supported on Unix desktops".to_string(),
        ));
    }
    Ok(None)
}

#[cfg(not(unix))]
pub fn configure_password_auth_for_tokio(
    profile: &RemoteHostProfile,
    _secret: Option<&RemoteConnectionSecret>,
    _command: &mut tokio::process::Command,
) -> Result<Option<()>, AppError> {
    if matches!(profile.auth_method, RemoteAuthMethod::Password) {
        return Err(AppError::Message(
            "Remote SSH password auth is only supported on Unix desktops".to_string(),
        ));
    }
    Ok(None)
}

fn shell_quote_helper_path(value: &str) -> String {
    if is_safe_unquoted_helper_path(value) {
        return value.to_string();
    }
    shell_quote(value)
}

fn is_safe_unquoted_helper_path(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_./:~".contains(c))
}

fn shell_quote(value: &str) -> String {
    if !value.is_empty()
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_./:".contains(c))
    {
        return value.to_string();
    }
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_profile() -> RemoteHostProfile {
        RemoteHostProfile {
            id: "prod".to_string(),
            name: "Production".to_string(),
            host: "example.com".to_string(),
            port: 22,
            username: "ccswitch".to_string(),
            auth_method: RemoteAuthMethod::SshAgent,
            helper_path: "/usr/local/bin/cc-switch-helper".to_string(),
            created_at: 1,
            updated_at: 1,
        }
    }

    #[test]
    fn disables_ssh_control_master_by_default() {
        let args = build_ssh_args(&valid_profile(), &["status".to_string()]);

        assert!(args
            .windows(2)
            .any(|pair| pair == ["-o", "ControlMaster=no"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["-o", "ControlPersist=no"]));
        assert!(!args
            .windows(2)
            .any(|pair| pair == ["-o", "ControlMaster=auto"]));
        assert!(!args.iter().any(|arg| arg == "-S"));
    }

    #[test]
    fn normalizes_ssh_control_socket_error() {
        let message = normalize_remote_stderr(
            &valid_profile(),
            "getsockname failed: Not a socket\r\nRead from remote host 10.81.2.202: Unknown error",
        );

        assert!(message.contains("SSH 连接复用控制 socket 异常"));
        assert!(message.contains("ControlMaster"));
    }

    #[test]
    fn normalizes_changed_host_key_error() {
        let message = normalize_remote_stderr(
            &valid_profile(),
            r#"@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
IT IS POSSIBLE THAT SOMEONE IS DOING SOMETHING NASTY!
Offending ED25519 key in /Users/wangyu19/.ssh/known_hosts:33
Host key for 192.168.123.111 has changed and you have requested strict checking.
Host key verification failed."#,
        );

        assert!(message.contains("远程主机密钥已变更"));
        assert!(message.contains("ssh-keygen -R 192.168.123.111"));
        assert!(message.contains("/Users/wangyu19/.ssh/known_hosts:33"));
        assert!(!message.contains("SOMETHING NASTY"));
    }

    #[test]
    fn normalizes_common_ssh_transport_errors() {
        let denied = normalize_remote_stderr(&valid_profile(), "Permission denied (publickey).");
        assert!(denied.contains("SSH 认证失败"));

        let refused = normalize_remote_stderr(
            &valid_profile(),
            "ssh: connect to host 192.168.123.111 port 22: Connection refused",
        );
        assert!(refused.contains("SSH 连接被拒绝"));

        let timeout = normalize_remote_stderr(
            &valid_profile(),
            "ssh: connect to host 192.168.123.111 port 22: Operation timed out",
        );
        assert!(timeout.contains("SSH 连接超时"));
    }
}
