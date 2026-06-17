use crate::app_config::{InstalledSkill, McpServer, UnmanagedSkill};
use crate::database::FailoverQueueItem;
use crate::prompt::Prompt;
use crate::provider::{Provider, UniversalProvider};
use crate::proxy::types::{
    AppProxyConfig, GlobalProxyConfig, OptimizerConfig, ProviderHealth, ProxyServerInfo,
    ProxyStatus, RectifierConfig,
};
use crate::proxy::{CircuitBreakerConfig, CircuitBreakerStats};
use crate::remote::{
    build_helper_install_args, build_ssh_args, delete_profile, delete_profile_secret,
    install_helper_json, load_profiles, remote_session_manager, run_helper_json,
    save_profile_secret, upsert_profile, validate_profile, RemoteAuthMethod, RemoteCapability,
    RemoteConnectionSecret, RemoteHealth, RemoteHelperInstallSource, RemoteHostProfile,
    RemotePlatform, RemoteSessionStatus,
};
use crate::services::skill::{
    DiscoverableSkill, ImportSkillSelection, MigrationResult, SkillBackupEntry, SkillRepo,
    SkillStorageLocation, SkillUninstallResult, SkillUpdateInfo,
};
use crate::services::{ProviderSortUpdate, SwitchResult};
use crate::session_manager;
use crate::settings::AppSettings;
use indexmap::IndexMap;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;

const GITHUB_API_USER_AGENT: &str = "cc-switch-remote";

#[derive(Debug, Clone, PartialEq, Eq)]
struct RemoteHelperLatest {
    version: String,
    build: Option<String>,
    asset_name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GitHubRelease {
    assets: Vec<GitHubReleaseAsset>,
}

#[derive(Debug, Deserialize)]
struct GitHubReleaseAsset {
    name: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteProviderState {
    pub providers: IndexMap<String, Provider>,
    pub current_provider_id: String,
}

#[tauri::command]
pub fn remote_list_profiles() -> Result<Vec<RemoteHostProfile>, String> {
    load_profiles().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remote_save_profile(
    profile: RemoteHostProfile,
    secret: Option<RemoteConnectionSecret>,
) -> Result<RemoteHostProfile, String> {
    let saved = upsert_profile(profile).map_err(|e| e.to_string())?;
    match (&saved.auth_method, secret.as_ref()) {
        (RemoteAuthMethod::Password, Some(secret)) => {
            save_profile_secret(&saved.id, secret).map_err(|e| e.to_string())?;
        }
        (RemoteAuthMethod::Password, None) => {}
        _ => {
            delete_profile_secret(&saved.id).map_err(|e| e.to_string())?;
        }
    }
    Ok(saved)
}

#[tauri::command]
pub fn remote_delete_profile(id: String) -> Result<bool, String> {
    delete_profile(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remote_validate_profile(profile: RemoteHostProfile) -> Result<bool, String> {
    validate_profile(&profile).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub fn remote_build_status_command(profile: RemoteHostProfile) -> Result<Vec<String>, String> {
    validate_profile(&profile).map_err(|e| e.to_string())?;
    Ok(build_ssh_args(&profile, &["status".to_string()]))
}

#[tauri::command]
pub fn remote_build_helper_install_command(
    profile: RemoteHostProfile,
) -> Result<Vec<String>, String> {
    validate_profile(&profile).map_err(|e| e.to_string())?;
    Ok(build_helper_install_args(&profile))
}

#[tauri::command]
pub fn remote_parse_helper_response(raw: String) -> Result<serde_json::Value, String> {
    serde_json::from_str(&raw).map_err(|e| format!("Invalid helper JSON: {e}"))
}

#[tauri::command]
pub async fn remote_get_session_status(profile_id: String) -> Result<RemoteSessionStatus, String> {
    Ok(remote_session_manager().status(&profile_id).await)
}

#[tauri::command]
pub async fn remote_close_session(profile_id: String) -> Result<bool, String> {
    Ok(remote_session_manager().close(&profile_id).await)
}

#[tauri::command]
pub async fn remote_check_health(
    profile: RemoteHostProfile,
    secret: Option<RemoteConnectionSecret>,
) -> Result<RemoteHealth, String> {
    validate_profile(&profile).map_err(|e| e.to_string())?;
    let status: serde_json::Value = tokio::task::spawn_blocking(move || {
        run_helper_json(&profile, &["status".to_string()], secret.as_ref())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("Remote health task failed: {e}"))??;

    let latest = fetch_remote_helper_latest(&status).await;
    Ok(remote_health_from_status_with_latest_result(status, latest))
}

#[tauri::command]
pub async fn remote_install_helper(
    profile: RemoteHostProfile,
    secret: Option<RemoteConnectionSecret>,
) -> Result<RemoteHealth, String> {
    validate_profile(&profile).map_err(|e| e.to_string())?;
    let status: serde_json::Value = tokio::task::spawn_blocking(move || {
        install_helper_json(&profile, secret.as_ref()).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("Remote helper install task failed: {e}"))??;

    let latest = fetch_remote_helper_latest(&status).await;
    Ok(remote_health_from_status_with_latest_result(status, latest))
}

#[tauri::command]
pub async fn remote_get_settings(
    profile: RemoteHostProfile,
    secret: Option<RemoteConnectionSecret>,
) -> Result<AppSettings, String> {
    run_remote_helper_json(
        profile,
        vec!["settings".to_string(), "get".to_string()],
        secret,
        "Remote settings get",
    )
    .await
}

#[tauri::command]
pub async fn remote_save_settings(
    profile: RemoteHostProfile,
    settings: AppSettings,
    secret: Option<RemoteConnectionSecret>,
) -> Result<bool, String> {
    let settings_json = serde_json::to_string(&settings).map_err(|e| e.to_string())?;
    run_remote_helper_json(
        profile,
        vec!["settings".to_string(), "save".to_string(), settings_json],
        secret,
        "Remote settings save",
    )
    .await
}

#[tauri::command]
pub async fn remote_migrate_skill_storage(
    profile: RemoteHostProfile,
    target: SkillStorageLocation,
    secret: Option<RemoteConnectionSecret>,
) -> Result<MigrationResult, String> {
    let target = serde_json::to_value(target)
        .ok()
        .and_then(|value| value.as_str().map(str::to_string))
        .ok_or_else(|| "Invalid skill storage location".to_string())?;
    run_remote_helper_json(
        profile,
        vec!["skills".to_string(), "migrate-storage".to_string(), target],
        secret,
        "Remote skill storage migration",
    )
    .await
}

#[tauri::command]
pub async fn remote_apply_claude_plugin_config(
    profile: RemoteHostProfile,
    official: bool,
    secret: Option<RemoteConnectionSecret>,
) -> Result<bool, String> {
    run_remote_helper_json(
        profile,
        vec![
            "plugin".to_string(),
            "apply-claude".to_string(),
            official.to_string(),
        ],
        secret,
        "Remote Claude plugin apply",
    )
    .await
}

#[tauri::command]
pub async fn remote_set_claude_onboarding_skip(
    profile: RemoteHostProfile,
    enabled: bool,
    secret: Option<RemoteConnectionSecret>,
) -> Result<bool, String> {
    run_remote_helper_json(
        profile,
        vec![
            "plugin".to_string(),
            "onboarding-skip".to_string(),
            enabled.to_string(),
        ],
        secret,
        "Remote Claude onboarding skip",
    )
    .await
}

#[tauri::command]
pub async fn remote_export_config_to_file(
    profile: RemoteHostProfile,
    #[allow(non_snake_case)] filePath: String,
    secret: Option<RemoteConnectionSecret>,
) -> Result<Value, String> {
    let sql: String = run_remote_helper_json(
        profile,
        vec!["import-export".to_string(), "export-sql".to_string()],
        secret,
        "Remote config export",
    )
    .await?;

    let target_path = PathBuf::from(&filePath);
    if let Some(parent) = target_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    crate::config::atomic_write(&target_path, sql.as_bytes()).map_err(|e| e.to_string())?;

    Ok(json!({
        "success": true,
        "message": "Remote SQL exported successfully",
        "filePath": filePath
    }))
}

#[tauri::command]
pub async fn remote_import_config_from_file(
    profile: RemoteHostProfile,
    #[allow(non_snake_case)] filePath: String,
    secret: Option<RemoteConnectionSecret>,
) -> Result<Value, String> {
    let source_path = PathBuf::from(&filePath);
    let sql = std::fs::read_to_string(&source_path).map_err(|e| e.to_string())?;
    let encoded = {
        use base64::{engine::general_purpose::STANDARD, Engine as _};
        STANDARD.encode(sql)
    };

    run_remote_helper_json(
        profile,
        vec![
            "import-export".to_string(),
            "import-sql-b64".to_string(),
            encoded,
        ],
        secret,
        "Remote config import",
    )
    .await
}

#[tauri::command]
pub async fn remote_get_tool_versions(
    profile: RemoteHostProfile,
    tools: Option<Vec<String>>,
    secret: Option<RemoteConnectionSecret>,
) -> Result<Value, String> {
    validate_profile(&profile).map_err(|e| e.to_string())?;
    let tools_json =
        serde_json::to_string(&tools.unwrap_or_default()).map_err(|e| e.to_string())?;
    let versions = tokio::task::spawn_blocking(move || {
        run_helper_json(
            &profile,
            &["tools".to_string(), "versions".to_string(), tools_json],
            secret.as_ref(),
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("Remote tool version task failed: {e}"))??;

    Ok(normalize_remote_tool_versions(versions))
}

#[tauri::command]
pub async fn remote_run_tool_lifecycle_action(
    profile: RemoteHostProfile,
    tools: Vec<String>,
    action: String,
    secret: Option<RemoteConnectionSecret>,
) -> Result<(), String> {
    validate_profile(&profile).map_err(|e| e.to_string())?;
    let tools_json = serde_json::to_string(&tools).map_err(|e| e.to_string())?;
    tokio::task::spawn_blocking(move || {
        run_helper_json::<Value>(
            &profile,
            &["tools".to_string(), "run".to_string(), action, tools_json],
            secret.as_ref(),
        )
        .map(|_| ())
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("Remote tool action task failed: {e}"))?
}

#[tauri::command]
pub async fn remote_probe_tool_installations(
    profile: RemoteHostProfile,
    tools: Option<Vec<String>>,
    secret: Option<RemoteConnectionSecret>,
) -> Result<Vec<crate::tool_environment::ToolInstallationReport>, String> {
    validate_profile(&profile).map_err(|e| e.to_string())?;
    let tools_json =
        serde_json::to_string(&tools.unwrap_or_default()).map_err(|e| e.to_string())?;
    tokio::task::spawn_blocking(move || {
        run_helper_json(
            &profile,
            &[
                "tools".to_string(),
                "probe-installations".to_string(),
                tools_json,
            ],
            secret.as_ref(),
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("Remote tool probe task failed: {e}"))?
}

fn remote_health_from_status_with_latest_result(
    status: serde_json::Value,
    latest: Result<Option<RemoteHelperLatest>, String>,
) -> RemoteHealth {
    let update_error = latest.as_ref().err().cloned();
    let latest = latest.ok().flatten();
    let mut health = remote_health_from_status_with_latest(status, latest);
    let session_missing = !health.capabilities.contains(&RemoteCapability::Session);
    health.helper_update_error = update_error.or_else(|| {
        session_missing.then(|| "远程 Helper 版本过旧，不支持持久会话；请更新 Helper。".to_string())
    });
    health
}

fn remote_health_from_status_with_latest(
    status: serde_json::Value,
    latest: Option<RemoteHelperLatest>,
) -> RemoteHealth {
    let helper_version = status
        .get("version")
        .and_then(|value| value.as_str())
        .map(str::to_string);
    let helper_build = status
        .get("build")
        .and_then(|value| value.as_str())
        .map(str::to_string);
    let latest_version = latest.as_ref().map(|item| item.version.clone());
    let latest_build = latest.as_ref().and_then(|item| item.build.clone());
    let helper_update_available = is_helper_update_available(
        helper_version.as_deref(),
        helper_build.as_deref(),
        latest.as_ref(),
    );

    RemoteHealth {
        reachable: true,
        helper_installed: true,
        helper_version,
        helper_build,
        helper_arch: status
            .get("arch")
            .and_then(|value| value.as_str())
            .map(str::to_string),
        helper_latest_version: latest_version,
        helper_latest_build: latest_build,
        helper_latest_asset: latest.and_then(|item| item.asset_name),
        helper_update_available,
        helper_update_error: None,
        platform: status
            .get("platform")
            .and_then(|value| value.as_str())
            .map(parse_remote_platform),
        capabilities: status
            .get("capabilities")
            .and_then(|value| value.as_array())
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| item.as_str())
                    .filter_map(parse_remote_capability)
                    .collect()
            })
            .unwrap_or_default(),
        last_error: None,
    }
}

async fn fetch_remote_helper_latest(
    status: &serde_json::Value,
) -> Result<Option<RemoteHelperLatest>, String> {
    let platform = status.get("platform").and_then(|value| value.as_str());
    let arch = status.get("arch").and_then(|value| value.as_str());
    let Some(asset_os) = helper_asset_os(platform) else {
        return Ok(None);
    };
    let Some(asset_arch) = helper_asset_arch(asset_os, arch) else {
        return Ok(None);
    };

    let source = RemoteHelperInstallSource::from_env();
    let url = format!(
        "https://api.github.com/repos/{}/releases/tags/{}",
        source.release_repo, source.release_tag
    );
    let release = reqwest::Client::new()
        .get(&url)
        .header(reqwest::header::USER_AGENT, GITHUB_API_USER_AGENT)
        .send()
        .await
        .map_err(|e| format!("Failed to query helper release: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Failed to query helper release: {e}"))?
        .json::<GitHubRelease>()
        .await
        .map_err(|e| format!("Failed to parse helper release: {e}"))?;

    Ok(select_remote_helper_latest(
        &release.assets,
        asset_os,
        asset_arch,
    ))
}

fn select_remote_helper_latest(
    assets: &[GitHubReleaseAsset],
    asset_os: &str,
    asset_arch: &str,
) -> Option<RemoteHelperLatest> {
    assets
        .iter()
        .find_map(|asset| parse_remote_helper_asset(&asset.name, asset_os, asset_arch))
}

fn parse_remote_helper_asset(
    asset_name: &str,
    asset_os: &str,
    asset_arch: &str,
) -> Option<RemoteHelperLatest> {
    for prefix in ["cc-switch-remote-helper-", "cc-switch-cli-"] {
        let Some(rest) = asset_name.strip_prefix(prefix) else {
            continue;
        };
        let suffix = format!("-{asset_os}-{asset_arch}");
        if let Some(build) = rest.strip_suffix(&suffix) {
            if build != "latest" && !build.trim().is_empty() {
                return Some(RemoteHelperLatest {
                    version: env!("CARGO_PKG_VERSION").to_string(),
                    build: Some(build.to_string()),
                    asset_name: Some(asset_name.to_string()),
                });
            }
        }
    }
    None
}

fn helper_asset_os(platform: Option<&str>) -> Option<&'static str> {
    match platform? {
        "linux" => Some("Linux"),
        "macos" => Some("macOS"),
        _ => None,
    }
}

fn helper_asset_arch(asset_os: &str, arch: Option<&str>) -> Option<&'static str> {
    if asset_os == "macOS" {
        return Some("universal");
    }

    match arch? {
        "x86_64" | "amd64" => Some("x86_64"),
        "aarch64" | "arm64" => Some("arm64"),
        _ => None,
    }
}

fn is_helper_update_available(
    current_version: Option<&str>,
    current_build: Option<&str>,
    latest: Option<&RemoteHelperLatest>,
) -> bool {
    let Some(latest) = latest else {
        return false;
    };

    if let (Some(current_build), Some(latest_build)) = (current_build, latest.build.as_deref()) {
        return !helper_builds_match(current_build, latest_build);
    }

    if current_build.is_none() && latest.build.is_some() {
        return true;
    }

    current_version
        .map(|version| version != latest.version)
        .unwrap_or(false)
}

fn helper_builds_match(current_build: &str, latest_build: &str) -> bool {
    let current = current_build.trim();
    let latest = latest_build.trim();
    if current.is_empty() || latest.is_empty() {
        return false;
    }
    if current == latest {
        return true;
    }

    let shortest = current.len().min(latest.len());
    shortest >= 7 && (current.starts_with(latest) || latest.starts_with(current))
}

fn normalize_remote_tool_versions(mut value: Value) -> Value {
    let Some(items) = value.as_array_mut() else {
        return value;
    };

    for item in items {
        let Some(tool) = item.as_object_mut() else {
            continue;
        };
        let has_version = tool
            .get("version")
            .and_then(|value| value.as_str())
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false);
        if has_version {
            continue;
        }

        let missing_command = tool
            .get("error")
            .and_then(|value| value.as_str())
            .map(is_tool_missing_error)
            .unwrap_or(false);
        if missing_command {
            tool.insert("installed_but_broken".to_string(), Value::Bool(false));
            tool.insert(
                "error".to_string(),
                Value::String("not installed or not executable".to_string()),
            );
        }
    }

    value
}

fn is_tool_missing_error(error: &str) -> bool {
    let normalized = error.trim().to_ascii_lowercase();
    normalized.contains("command not found")
        || normalized.contains("not found")
        || normalized.contains("no such file or directory")
        || normalized.contains("not installed or not executable")
        || error.contains("没有那个文件或目录")
}

fn parse_remote_platform(value: &str) -> RemotePlatform {
    match value {
        "linux" => RemotePlatform::Linux,
        "macos" => RemotePlatform::Macos,
        _ => RemotePlatform::Unknown,
    }
}

fn parse_remote_capability(value: &str) -> Option<RemoteCapability> {
    match value {
        "providers" => Some(RemoteCapability::Providers),
        "universal-providers" => Some(RemoteCapability::UniversalProviders),
        "routing-config" => Some(RemoteCapability::RoutingConfig),
        "routing-runtime" => Some(RemoteCapability::RoutingRuntime),
        "openclaw" => Some(RemoteCapability::Openclaw),
        "mcp" => Some(RemoteCapability::Mcp),
        "prompts" => Some(RemoteCapability::Prompts),
        "skills" => Some(RemoteCapability::Skills),
        "sessions" => Some(RemoteCapability::Sessions),
        "hermes-memory" => Some(RemoteCapability::HermesMemory),
        "import-export" => Some(RemoteCapability::ImportExport),
        "tools" => Some(RemoteCapability::Tools),
        "stream-check" => Some(RemoteCapability::StreamCheck),
        "settings" => Some(RemoteCapability::Settings),
        "plugin" => Some(RemoteCapability::Plugin),
        "session" => Some(RemoteCapability::Session),
        _ => None,
    }
}

#[tauri::command]
pub async fn remote_get_providers(
    profile: RemoteHostProfile,
    app: String,
    secret: Option<RemoteConnectionSecret>,
) -> Result<IndexMap<String, Provider>, String> {
    run_remote_helper_json(
        profile,
        vec!["providers".to_string(), "list".to_string(), app],
        secret,
        "Remote provider list",
    )
    .await
}

#[tauri::command]
pub async fn remote_get_current_provider(
    profile: RemoteHostProfile,
    app: String,
    secret: Option<RemoteConnectionSecret>,
) -> Result<String, String> {
    run_remote_helper_json(
        profile,
        vec!["providers".to_string(), "current".to_string(), app],
        secret,
        "Remote current provider",
    )
    .await
}

#[tauri::command]
pub async fn remote_get_provider_state(
    profile: RemoteHostProfile,
    app: String,
    secret: Option<RemoteConnectionSecret>,
) -> Result<RemoteProviderState, String> {
    validate_profile(&profile).map_err(|e| e.to_string())?;
    tokio::task::spawn_blocking(move || {
        match run_helper_json(
            &profile,
            &["providers".to_string(), "state".to_string(), app.clone()],
            secret.as_ref(),
        ) {
            Ok(state) => Ok(state),
            Err(error) if is_unsupported_remote_command(&error.to_string()) => {
                let providers = run_helper_json(
                    &profile,
                    &["providers".to_string(), "list".to_string(), app.clone()],
                    secret.as_ref(),
                )
                .map_err(|e| e.to_string())?;
                let current_provider_id = run_helper_json(
                    &profile,
                    &["providers".to_string(), "current".to_string(), app],
                    secret.as_ref(),
                )
                .map_err(|e| e.to_string())?;

                Ok(RemoteProviderState {
                    providers,
                    current_provider_id,
                })
            }
            Err(error) => Err(error.to_string()),
        }
    })
    .await
    .map_err(|e| format!("Remote provider state task failed: {e}"))?
}

fn is_unsupported_remote_command(message: &str) -> bool {
    message.contains("unsupported_command")
}

async fn run_remote_helper_json<T>(
    profile: RemoteHostProfile,
    helper_args: Vec<String>,
    secret: Option<RemoteConnectionSecret>,
    task_name: &'static str,
) -> Result<T, String>
where
    T: DeserializeOwned + Send + 'static,
{
    validate_profile(&profile).map_err(|e| e.to_string())?;
    remote_session_manager()
        .execute_json(profile, secret, helper_args)
        .await
        .map_err(|e| format!("{task_name} task failed: {e}"))
}

#[tauri::command]
pub async fn remote_switch_provider(
    profile: RemoteHostProfile,
    app: String,
    id: String,
    secret: Option<RemoteConnectionSecret>,
) -> Result<SwitchResult, String> {
    run_remote_helper_json(
        profile,
        vec!["providers".to_string(), "switch".to_string(), app, id],
        secret,
        "Remote provider switch",
    )
    .await
}

#[tauri::command]
pub async fn remote_add_provider(
    profile: RemoteHostProfile,
    app: String,
    provider: Provider,
    #[allow(non_snake_case)] addToLive: Option<bool>,
    secret: Option<RemoteConnectionSecret>,
) -> Result<bool, String> {
    let provider_json = serde_json::to_string(&provider).map_err(|e| e.to_string())?;
    run_remote_helper_json(
        profile,
        vec![
            "providers".to_string(),
            "add".to_string(),
            app,
            provider_json,
            addToLive.unwrap_or(true).to_string(),
        ],
        secret,
        "Remote provider add",
    )
    .await
}

#[tauri::command]
pub async fn remote_update_provider(
    profile: RemoteHostProfile,
    app: String,
    provider: Provider,
    #[allow(non_snake_case)] originalId: Option<String>,
    secret: Option<RemoteConnectionSecret>,
) -> Result<bool, String> {
    let provider_json = serde_json::to_string(&provider).map_err(|e| e.to_string())?;
    run_remote_helper_json(
        profile,
        vec![
            "providers".to_string(),
            "update".to_string(),
            app,
            provider_json,
            originalId.unwrap_or_else(|| "-".to_string()),
        ],
        secret,
        "Remote provider update",
    )
    .await
}

#[tauri::command]
pub async fn remote_delete_provider(
    profile: RemoteHostProfile,
    app: String,
    id: String,
    secret: Option<RemoteConnectionSecret>,
) -> Result<bool, String> {
    run_remote_helper_json(
        profile,
        vec!["providers".to_string(), "delete".to_string(), app, id],
        secret,
        "Remote provider delete",
    )
    .await
}

#[tauri::command]
pub async fn remote_remove_provider_from_live_config(
    profile: RemoteHostProfile,
    app: String,
    id: String,
    secret: Option<RemoteConnectionSecret>,
) -> Result<bool, String> {
    run_remote_helper_json(
        profile,
        vec!["providers".to_string(), "remove-live".to_string(), app, id],
        secret,
        "Remote provider remove from live config",
    )
    .await
}

#[tauri::command]
pub async fn remote_get_live_provider_ids(
    profile: RemoteHostProfile,
    app: String,
    secret: Option<RemoteConnectionSecret>,
) -> Result<Vec<String>, String> {
    run_remote_helper_json(
        profile,
        vec!["providers".to_string(), "live-ids".to_string(), app],
        secret,
        "Remote provider live IDs",
    )
    .await
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn remote_stream_check_provider(
    profile: RemoteHostProfile,
    app: String,
    providerId: String,
    secret: Option<RemoteConnectionSecret>,
) -> Result<crate::services::stream_check::StreamCheckResult, String> {
    run_remote_helper_json(
        profile,
        vec![
            "stream-check".to_string(),
            "provider".to_string(),
            app,
            providerId,
        ],
        secret,
        "Remote stream check provider",
    )
    .await
}

#[tauri::command]
pub async fn remote_get_stream_check_config(
    profile: RemoteHostProfile,
    secret: Option<RemoteConnectionSecret>,
) -> Result<crate::services::stream_check::StreamCheckConfig, String> {
    run_remote_helper_json(
        profile,
        vec!["stream-check".to_string(), "config".to_string()],
        secret,
        "Remote stream check config",
    )
    .await
}

#[tauri::command]
pub async fn remote_save_stream_check_config(
    profile: RemoteHostProfile,
    config: crate::services::stream_check::StreamCheckConfig,
    secret: Option<RemoteConnectionSecret>,
) -> Result<bool, String> {
    let config_json = serde_json::to_string(&config).map_err(|e| e.to_string())?;
    run_remote_helper_json(
        profile,
        vec![
            "stream-check".to_string(),
            "set-config".to_string(),
            config_json,
        ],
        secret,
        "Remote stream check config save",
    )
    .await
}

#[tauri::command]
pub async fn remote_get_log_config(
    profile: RemoteHostProfile,
    secret: Option<RemoteConnectionSecret>,
) -> Result<crate::proxy::types::LogConfig, String> {
    run_remote_helper_json(
        profile,
        vec!["settings".to_string(), "log-config".to_string()],
        secret,
        "Remote log config",
    )
    .await
}

#[tauri::command]
pub async fn remote_set_log_config(
    profile: RemoteHostProfile,
    config: crate::proxy::types::LogConfig,
    secret: Option<RemoteConnectionSecret>,
) -> Result<bool, String> {
    let config_json = serde_json::to_string(&config).map_err(|e| e.to_string())?;
    run_remote_helper_json(
        profile,
        vec![
            "settings".to_string(),
            "set-log-config".to_string(),
            config_json,
        ],
        secret,
        "Remote log config save",
    )
    .await
}

#[tauri::command]
pub async fn remote_import_providers(
    profile: RemoteHostProfile,
    app: String,
    secret: Option<RemoteConnectionSecret>,
) -> Result<bool, String> {
    run_remote_helper_json(
        profile,
        vec!["providers".to_string(), "import".to_string(), app],
        secret,
        "Remote provider import",
    )
    .await
}

#[tauri::command]
pub async fn remote_update_providers_sort_order(
    profile: RemoteHostProfile,
    app: String,
    updates: Vec<ProviderSortUpdate>,
    secret: Option<RemoteConnectionSecret>,
) -> Result<bool, String> {
    let updates_json = serde_json::to_string(&updates).map_err(|e| e.to_string())?;
    run_remote_helper_json(
        profile,
        vec![
            "providers".to_string(),
            "sort".to_string(),
            app,
            updates_json,
        ],
        secret,
        "Remote provider sort",
    )
    .await
}

#[tauri::command]
pub async fn remote_get_universal_providers(
    profile: RemoteHostProfile,
    secret: Option<RemoteConnectionSecret>,
) -> Result<IndexMap<String, UniversalProvider>, String> {
    run_remote_helper_json(
        profile,
        vec!["universal-providers".to_string(), "list".to_string()],
        secret,
        "Remote universal provider list",
    )
    .await
}

#[tauri::command]
pub async fn remote_get_universal_provider(
    profile: RemoteHostProfile,
    id: String,
    secret: Option<RemoteConnectionSecret>,
) -> Result<Option<UniversalProvider>, String> {
    run_remote_helper_json(
        profile,
        vec!["universal-providers".to_string(), "get".to_string(), id],
        secret,
        "Remote universal provider get",
    )
    .await
}

#[tauri::command]
pub async fn remote_upsert_universal_provider(
    profile: RemoteHostProfile,
    provider: UniversalProvider,
    secret: Option<RemoteConnectionSecret>,
) -> Result<bool, String> {
    let provider_json = serde_json::to_string(&provider).map_err(|e| e.to_string())?;
    run_remote_helper_json(
        profile,
        vec![
            "universal-providers".to_string(),
            "upsert".to_string(),
            provider_json,
        ],
        secret,
        "Remote universal provider upsert",
    )
    .await
}

#[tauri::command]
pub async fn remote_delete_universal_provider(
    profile: RemoteHostProfile,
    id: String,
    secret: Option<RemoteConnectionSecret>,
) -> Result<bool, String> {
    run_remote_helper_json(
        profile,
        vec!["universal-providers".to_string(), "delete".to_string(), id],
        secret,
        "Remote universal provider delete",
    )
    .await
}

#[tauri::command]
pub async fn remote_sync_universal_provider(
    profile: RemoteHostProfile,
    id: String,
    secret: Option<RemoteConnectionSecret>,
) -> Result<bool, String> {
    run_remote_helper_json(
        profile,
        vec!["universal-providers".to_string(), "sync".to_string(), id],
        secret,
        "Remote universal provider sync",
    )
    .await
}

#[tauri::command]
pub async fn remote_get_routing_global_config(
    profile: RemoteHostProfile,
    secret: Option<RemoteConnectionSecret>,
) -> Result<GlobalProxyConfig, String> {
    run_remote_helper_json(
        profile,
        vec!["routing-config".to_string(), "global".to_string()],
        secret,
        "Remote routing global config get",
    )
    .await
}

#[tauri::command]
pub async fn remote_update_routing_global_config(
    profile: RemoteHostProfile,
    config: GlobalProxyConfig,
    secret: Option<RemoteConnectionSecret>,
) -> Result<(), String> {
    let config_json = serde_json::to_string(&config).map_err(|e| e.to_string())?;
    run_remote_helper_json(
        profile,
        vec![
            "routing-config".to_string(),
            "set-global".to_string(),
            config_json,
        ],
        secret,
        "Remote routing global config update",
    )
    .await
}

#[tauri::command]
pub async fn remote_get_routing_app_config(
    profile: RemoteHostProfile,
    #[allow(non_snake_case)] appType: String,
    secret: Option<RemoteConnectionSecret>,
) -> Result<AppProxyConfig, String> {
    run_remote_helper_json(
        profile,
        vec!["routing-config".to_string(), "app".to_string(), appType],
        secret,
        "Remote routing app config get",
    )
    .await
}

#[tauri::command]
pub async fn remote_get_routing_failover_queue(
    profile: RemoteHostProfile,
    #[allow(non_snake_case)] appType: String,
    secret: Option<RemoteConnectionSecret>,
) -> Result<Vec<FailoverQueueItem>, String> {
    run_remote_helper_json(
        profile,
        vec![
            "routing-config".to_string(),
            "failover-queue".to_string(),
            appType,
        ],
        secret,
        "Remote routing failover queue get",
    )
    .await
}

#[tauri::command]
pub async fn remote_get_available_providers_for_failover(
    profile: RemoteHostProfile,
    #[allow(non_snake_case)] appType: String,
    secret: Option<RemoteConnectionSecret>,
) -> Result<Vec<Provider>, String> {
    run_remote_helper_json(
        profile,
        vec![
            "routing-config".to_string(),
            "available-failover-providers".to_string(),
            appType,
        ],
        secret,
        "Remote routing available failover providers",
    )
    .await
}

#[tauri::command]
pub async fn remote_add_to_failover_queue(
    profile: RemoteHostProfile,
    #[allow(non_snake_case)] appType: String,
    #[allow(non_snake_case)] providerId: String,
    secret: Option<RemoteConnectionSecret>,
) -> Result<(), String> {
    run_remote_helper_json(
        profile,
        vec![
            "routing-config".to_string(),
            "add-failover-provider".to_string(),
            appType,
            providerId,
        ],
        secret,
        "Remote routing failover queue add",
    )
    .await
}

#[tauri::command]
pub async fn remote_remove_from_failover_queue(
    profile: RemoteHostProfile,
    #[allow(non_snake_case)] appType: String,
    #[allow(non_snake_case)] providerId: String,
    secret: Option<RemoteConnectionSecret>,
) -> Result<(), String> {
    run_remote_helper_json(
        profile,
        vec![
            "routing-config".to_string(),
            "remove-failover-provider".to_string(),
            appType,
            providerId,
        ],
        secret,
        "Remote routing failover queue remove",
    )
    .await
}

#[tauri::command]
pub async fn remote_get_auto_failover_enabled(
    profile: RemoteHostProfile,
    #[allow(non_snake_case)] appType: String,
    secret: Option<RemoteConnectionSecret>,
) -> Result<bool, String> {
    run_remote_helper_json(
        profile,
        vec![
            "routing-config".to_string(),
            "auto-failover".to_string(),
            appType,
        ],
        secret,
        "Remote routing auto failover get",
    )
    .await
}

#[tauri::command]
pub async fn remote_set_auto_failover_enabled(
    profile: RemoteHostProfile,
    #[allow(non_snake_case)] appType: String,
    enabled: bool,
    secret: Option<RemoteConnectionSecret>,
) -> Result<(), String> {
    run_remote_helper_json(
        profile,
        vec![
            "routing-config".to_string(),
            "set-auto-failover".to_string(),
            appType,
            enabled.to_string(),
        ],
        secret,
        "Remote routing auto failover set",
    )
    .await
}

#[tauri::command]
pub async fn remote_get_routing_provider_health(
    profile: RemoteHostProfile,
    #[allow(non_snake_case)] providerId: String,
    #[allow(non_snake_case)] appType: String,
    secret: Option<RemoteConnectionSecret>,
) -> Result<ProviderHealth, String> {
    run_remote_helper_json(
        profile,
        vec![
            "routing-config".to_string(),
            "provider-health".to_string(),
            appType,
            providerId,
        ],
        secret,
        "Remote routing provider health get",
    )
    .await
}

#[tauri::command]
pub async fn remote_reset_routing_circuit_breaker(
    profile: RemoteHostProfile,
    #[allow(non_snake_case)] providerId: String,
    #[allow(non_snake_case)] appType: String,
    secret: Option<RemoteConnectionSecret>,
) -> Result<(), String> {
    run_remote_helper_json(
        profile,
        vec![
            "routing-config".to_string(),
            "reset-circuit-breaker".to_string(),
            appType,
            providerId,
        ],
        secret,
        "Remote routing circuit breaker reset",
    )
    .await
}

#[tauri::command]
pub async fn remote_get_routing_circuit_breaker_config(
    profile: RemoteHostProfile,
    secret: Option<RemoteConnectionSecret>,
) -> Result<CircuitBreakerConfig, String> {
    run_remote_helper_json(
        profile,
        vec!["routing-config".to_string(), "circuit-breaker".to_string()],
        secret,
        "Remote routing circuit breaker config get",
    )
    .await
}

#[tauri::command]
pub async fn remote_update_routing_circuit_breaker_config(
    profile: RemoteHostProfile,
    config: CircuitBreakerConfig,
    secret: Option<RemoteConnectionSecret>,
) -> Result<(), String> {
    let config_json = serde_json::to_string(&config).map_err(|e| e.to_string())?;
    run_remote_helper_json(
        profile,
        vec![
            "routing-config".to_string(),
            "set-circuit-breaker".to_string(),
            config_json,
        ],
        secret,
        "Remote routing circuit breaker config update",
    )
    .await
}

#[tauri::command]
pub async fn remote_get_routing_circuit_breaker_stats(
    profile: RemoteHostProfile,
    #[allow(non_snake_case)] providerId: String,
    #[allow(non_snake_case)] appType: String,
    secret: Option<RemoteConnectionSecret>,
) -> Result<Option<CircuitBreakerStats>, String> {
    run_remote_helper_json(
        profile,
        vec![
            "routing-config".to_string(),
            "circuit-breaker-stats".to_string(),
            appType,
            providerId,
        ],
        secret,
        "Remote routing circuit breaker stats get",
    )
    .await
}

#[tauri::command]
pub async fn remote_update_routing_app_config(
    profile: RemoteHostProfile,
    config: AppProxyConfig,
    secret: Option<RemoteConnectionSecret>,
) -> Result<(), String> {
    let config_json = serde_json::to_string(&config).map_err(|e| e.to_string())?;
    run_remote_helper_json(
        profile,
        vec![
            "routing-config".to_string(),
            "set-app".to_string(),
            config_json,
        ],
        secret,
        "Remote routing app config update",
    )
    .await
}

#[tauri::command]
pub async fn remote_get_routing_rectifier_config(
    profile: RemoteHostProfile,
    secret: Option<RemoteConnectionSecret>,
) -> Result<RectifierConfig, String> {
    run_remote_helper_json(
        profile,
        vec!["routing-config".to_string(), "rectifier".to_string()],
        secret,
        "Remote routing rectifier config get",
    )
    .await
}

#[tauri::command]
pub async fn remote_set_routing_rectifier_config(
    profile: RemoteHostProfile,
    config: RectifierConfig,
    secret: Option<RemoteConnectionSecret>,
) -> Result<bool, String> {
    let config_json = serde_json::to_string(&config).map_err(|e| e.to_string())?;
    run_remote_helper_json(
        profile,
        vec![
            "routing-config".to_string(),
            "set-rectifier".to_string(),
            config_json,
        ],
        secret,
        "Remote routing rectifier config set",
    )
    .await
}

#[tauri::command]
pub async fn remote_get_routing_optimizer_config(
    profile: RemoteHostProfile,
    secret: Option<RemoteConnectionSecret>,
) -> Result<OptimizerConfig, String> {
    run_remote_helper_json(
        profile,
        vec!["routing-config".to_string(), "optimizer".to_string()],
        secret,
        "Remote routing optimizer config get",
    )
    .await
}

#[tauri::command]
pub async fn remote_set_routing_optimizer_config(
    profile: RemoteHostProfile,
    config: OptimizerConfig,
    secret: Option<RemoteConnectionSecret>,
) -> Result<bool, String> {
    let config_json = serde_json::to_string(&config).map_err(|e| e.to_string())?;
    run_remote_helper_json(
        profile,
        vec![
            "routing-config".to_string(),
            "set-optimizer".to_string(),
            config_json,
        ],
        secret,
        "Remote routing optimizer config set",
    )
    .await
}

#[tauri::command]
pub async fn remote_get_routing_global_outbound_proxy(
    profile: RemoteHostProfile,
    secret: Option<RemoteConnectionSecret>,
) -> Result<Option<String>, String> {
    run_remote_helper_json(
        profile,
        vec!["routing-config".to_string(), "global-outbound".to_string()],
        secret,
        "Remote routing global outbound proxy get",
    )
    .await
}

#[tauri::command]
pub async fn remote_set_routing_global_outbound_proxy(
    profile: RemoteHostProfile,
    url: String,
    secret: Option<RemoteConnectionSecret>,
) -> Result<(), String> {
    run_remote_helper_json(
        profile,
        vec![
            "routing-config".to_string(),
            "set-global-outbound".to_string(),
            if url.trim().is_empty() {
                "-".to_string()
            } else {
                url
            },
        ],
        secret,
        "Remote routing global outbound proxy set",
    )
    .await
}

#[tauri::command]
pub async fn remote_get_routing_runtime_status(
    profile: RemoteHostProfile,
    secret: Option<RemoteConnectionSecret>,
) -> Result<ProxyStatus, String> {
    run_remote_helper_json(
        profile,
        vec!["routing-runtime".to_string(), "status".to_string()],
        secret,
        "Remote routing runtime status",
    )
    .await
}

#[tauri::command]
pub async fn remote_start_routing_runtime(
    profile: RemoteHostProfile,
    secret: Option<RemoteConnectionSecret>,
) -> Result<ProxyServerInfo, String> {
    run_remote_helper_json(
        profile,
        vec!["routing-runtime".to_string(), "start".to_string()],
        secret,
        "Remote routing runtime start",
    )
    .await
}

#[tauri::command]
pub async fn remote_stop_routing_runtime(
    profile: RemoteHostProfile,
    secret: Option<RemoteConnectionSecret>,
) -> Result<bool, String> {
    run_remote_helper_json(
        profile,
        vec!["routing-runtime".to_string(), "stop".to_string()],
        secret,
        "Remote routing runtime stop",
    )
    .await
}

#[tauri::command]
pub async fn remote_list_sessions(
    profile: RemoteHostProfile,
    secret: Option<RemoteConnectionSecret>,
) -> Result<Vec<session_manager::SessionMeta>, String> {
    run_remote_helper_json(
        profile,
        vec!["sessions".to_string(), "list".to_string()],
        secret,
        "Remote session list",
    )
    .await
}

#[tauri::command]
pub async fn remote_get_session_messages(
    profile: RemoteHostProfile,
    #[allow(non_snake_case)] providerId: String,
    #[allow(non_snake_case)] sourcePath: String,
    secret: Option<RemoteConnectionSecret>,
) -> Result<Vec<session_manager::SessionMessage>, String> {
    run_remote_helper_json(
        profile,
        vec![
            "sessions".to_string(),
            "messages".to_string(),
            providerId,
            sourcePath,
        ],
        secret,
        "Remote session messages",
    )
    .await
}

#[tauri::command]
pub async fn remote_delete_session(
    profile: RemoteHostProfile,
    #[allow(non_snake_case)] providerId: String,
    #[allow(non_snake_case)] sessionId: String,
    #[allow(non_snake_case)] sourcePath: String,
    secret: Option<RemoteConnectionSecret>,
) -> Result<bool, String> {
    run_remote_helper_json(
        profile,
        vec![
            "sessions".to_string(),
            "delete".to_string(),
            providerId,
            sessionId,
            sourcePath,
        ],
        secret,
        "Remote session delete",
    )
    .await
}

#[tauri::command]
pub async fn remote_delete_sessions(
    profile: RemoteHostProfile,
    items: Vec<session_manager::DeleteSessionRequest>,
    secret: Option<RemoteConnectionSecret>,
) -> Result<Vec<session_manager::DeleteSessionOutcome>, String> {
    let items_json = serde_json::to_string(&items).map_err(|e| e.to_string())?;
    run_remote_helper_json(
        profile,
        vec![
            "sessions".to_string(),
            "delete-many".to_string(),
            items_json,
        ],
        secret,
        "Remote sessions delete",
    )
    .await
}

#[tauri::command]
pub async fn remote_get_hermes_memory(
    profile: RemoteHostProfile,
    kind: crate::hermes_config::MemoryKind,
    secret: Option<RemoteConnectionSecret>,
) -> Result<String, String> {
    run_remote_helper_json(
        profile,
        vec![
            "hermes".to_string(),
            "memory".to_string(),
            "get".to_string(),
            kind.as_arg().to_string(),
        ],
        secret,
        "Remote Hermes memory get",
    )
    .await
}

#[tauri::command]
pub async fn remote_get_hermes_model_config(
    profile: RemoteHostProfile,
    secret: Option<RemoteConnectionSecret>,
) -> Result<Option<crate::hermes_config::HermesModelConfig>, String> {
    run_remote_helper_json(
        profile,
        vec!["hermes".to_string(), "model".to_string(), "get".to_string()],
        secret,
        "Remote Hermes model get",
    )
    .await
}

#[tauri::command]
pub async fn remote_set_hermes_memory(
    profile: RemoteHostProfile,
    kind: crate::hermes_config::MemoryKind,
    content: String,
    secret: Option<RemoteConnectionSecret>,
) -> Result<(), String> {
    run_remote_helper_json(
        profile,
        vec![
            "hermes".to_string(),
            "memory".to_string(),
            "set".to_string(),
            kind.as_arg().to_string(),
            content,
        ],
        secret,
        "Remote Hermes memory set",
    )
    .await
}

#[tauri::command]
pub async fn remote_get_hermes_memory_limits(
    profile: RemoteHostProfile,
    secret: Option<RemoteConnectionSecret>,
) -> Result<crate::hermes_config::HermesMemoryLimits, String> {
    run_remote_helper_json(
        profile,
        vec![
            "hermes".to_string(),
            "memory".to_string(),
            "limits".to_string(),
        ],
        secret,
        "Remote Hermes memory limits",
    )
    .await
}

#[tauri::command]
pub async fn remote_set_hermes_memory_enabled(
    profile: RemoteHostProfile,
    kind: crate::hermes_config::MemoryKind,
    enabled: bool,
    secret: Option<RemoteConnectionSecret>,
) -> Result<crate::hermes_config::HermesWriteOutcome, String> {
    run_remote_helper_json(
        profile,
        vec![
            "hermes".to_string(),
            "memory".to_string(),
            "enabled".to_string(),
            kind.as_arg().to_string(),
            enabled.to_string(),
        ],
        secret,
        "Remote Hermes memory enabled",
    )
    .await
}

#[tauri::command]
pub async fn remote_get_openclaw_default_model(
    profile: RemoteHostProfile,
    secret: Option<RemoteConnectionSecret>,
) -> Result<Option<crate::openclaw_config::OpenClawDefaultModel>, String> {
    run_remote_helper_json(
        profile,
        vec!["openclaw".to_string(), "get-default-model".to_string()],
        secret,
        "Remote OpenClaw default model get",
    )
    .await
}

#[tauri::command]
pub async fn remote_set_openclaw_default_model(
    profile: RemoteHostProfile,
    model: crate::openclaw_config::OpenClawDefaultModel,
    secret: Option<RemoteConnectionSecret>,
) -> Result<crate::openclaw_config::OpenClawWriteOutcome, String> {
    let model_json = serde_json::to_string(&model).map_err(|e| e.to_string())?;
    run_remote_helper_json(
        profile,
        vec![
            "openclaw".to_string(),
            "set-default-model".to_string(),
            model_json,
        ],
        secret,
        "Remote OpenClaw default model set",
    )
    .await
}

#[tauri::command]
pub async fn remote_get_openclaw_env(
    profile: RemoteHostProfile,
    secret: Option<RemoteConnectionSecret>,
) -> Result<crate::openclaw_config::OpenClawEnvConfig, String> {
    run_remote_helper_json(
        profile,
        vec!["openclaw".to_string(), "get-env".to_string()],
        secret,
        "Remote OpenClaw env get",
    )
    .await
}

#[tauri::command]
pub async fn remote_set_openclaw_env(
    profile: RemoteHostProfile,
    env: crate::openclaw_config::OpenClawEnvConfig,
    secret: Option<RemoteConnectionSecret>,
) -> Result<crate::openclaw_config::OpenClawWriteOutcome, String> {
    let env_json = serde_json::to_string(&env).map_err(|e| e.to_string())?;
    run_remote_helper_json(
        profile,
        vec!["openclaw".to_string(), "set-env".to_string(), env_json],
        secret,
        "Remote OpenClaw env set",
    )
    .await
}

#[tauri::command]
pub async fn remote_get_openclaw_tools(
    profile: RemoteHostProfile,
    secret: Option<RemoteConnectionSecret>,
) -> Result<crate::openclaw_config::OpenClawToolsConfig, String> {
    run_remote_helper_json(
        profile,
        vec!["openclaw".to_string(), "get-tools".to_string()],
        secret,
        "Remote OpenClaw tools get",
    )
    .await
}

#[tauri::command]
pub async fn remote_set_openclaw_tools(
    profile: RemoteHostProfile,
    tools: crate::openclaw_config::OpenClawToolsConfig,
    secret: Option<RemoteConnectionSecret>,
) -> Result<crate::openclaw_config::OpenClawWriteOutcome, String> {
    let tools_json = serde_json::to_string(&tools).map_err(|e| e.to_string())?;
    run_remote_helper_json(
        profile,
        vec!["openclaw".to_string(), "set-tools".to_string(), tools_json],
        secret,
        "Remote OpenClaw tools set",
    )
    .await
}

#[tauri::command]
pub async fn remote_get_openclaw_agents_defaults(
    profile: RemoteHostProfile,
    secret: Option<RemoteConnectionSecret>,
) -> Result<Option<crate::openclaw_config::OpenClawAgentsDefaults>, String> {
    run_remote_helper_json(
        profile,
        vec!["openclaw".to_string(), "get-agents-defaults".to_string()],
        secret,
        "Remote OpenClaw agents defaults get",
    )
    .await
}

#[tauri::command]
pub async fn remote_set_openclaw_agents_defaults(
    profile: RemoteHostProfile,
    defaults: crate::openclaw_config::OpenClawAgentsDefaults,
    secret: Option<RemoteConnectionSecret>,
) -> Result<crate::openclaw_config::OpenClawWriteOutcome, String> {
    let defaults_json = serde_json::to_string(&defaults).map_err(|e| e.to_string())?;
    run_remote_helper_json(
        profile,
        vec![
            "openclaw".to_string(),
            "set-agents-defaults".to_string(),
            defaults_json,
        ],
        secret,
        "Remote OpenClaw agents defaults set",
    )
    .await
}

#[tauri::command]
pub async fn remote_get_mcp_servers(
    profile: RemoteHostProfile,
    secret: Option<RemoteConnectionSecret>,
) -> Result<IndexMap<String, McpServer>, String> {
    run_remote_helper_json(
        profile,
        vec!["mcp".to_string(), "list".to_string()],
        secret,
        "Remote MCP list",
    )
    .await
}

#[tauri::command]
pub async fn remote_upsert_mcp_server(
    profile: RemoteHostProfile,
    server: McpServer,
    secret: Option<RemoteConnectionSecret>,
) -> Result<(), String> {
    let server_json = serde_json::to_string(&server).map_err(|e| e.to_string())?;
    run_remote_helper_json(
        profile,
        vec!["mcp".to_string(), "upsert".to_string(), server_json],
        secret,
        "Remote MCP upsert",
    )
    .await
}

#[tauri::command]
pub async fn remote_delete_mcp_server(
    profile: RemoteHostProfile,
    id: String,
    secret: Option<RemoteConnectionSecret>,
) -> Result<bool, String> {
    run_remote_helper_json(
        profile,
        vec!["mcp".to_string(), "delete".to_string(), id],
        secret,
        "Remote MCP delete",
    )
    .await
}

#[tauri::command]
pub async fn remote_toggle_mcp_app(
    profile: RemoteHostProfile,
    #[allow(non_snake_case)] serverId: String,
    app: String,
    enabled: bool,
    secret: Option<RemoteConnectionSecret>,
) -> Result<(), String> {
    run_remote_helper_json(
        profile,
        vec![
            "mcp".to_string(),
            "toggle".to_string(),
            serverId,
            app,
            enabled.to_string(),
        ],
        secret,
        "Remote MCP toggle",
    )
    .await
}

#[tauri::command]
pub async fn remote_import_mcp_from_apps(
    profile: RemoteHostProfile,
    secret: Option<RemoteConnectionSecret>,
) -> Result<usize, String> {
    run_remote_helper_json(
        profile,
        vec!["mcp".to_string(), "import".to_string()],
        secret,
        "Remote MCP import",
    )
    .await
}

#[tauri::command]
pub async fn remote_get_prompts(
    profile: RemoteHostProfile,
    app: String,
    secret: Option<RemoteConnectionSecret>,
) -> Result<IndexMap<String, Prompt>, String> {
    run_remote_helper_json(
        profile,
        vec!["prompts".to_string(), "list".to_string(), app],
        secret,
        "Remote prompts list",
    )
    .await
}

#[tauri::command]
pub async fn remote_upsert_prompt(
    profile: RemoteHostProfile,
    app: String,
    id: String,
    prompt: Prompt,
    secret: Option<RemoteConnectionSecret>,
) -> Result<(), String> {
    let prompt_json = serde_json::to_string(&prompt).map_err(|e| e.to_string())?;
    run_remote_helper_json(
        profile,
        vec![
            "prompts".to_string(),
            "upsert".to_string(),
            app,
            id,
            prompt_json,
        ],
        secret,
        "Remote prompt upsert",
    )
    .await
}

#[tauri::command]
pub async fn remote_delete_prompt(
    profile: RemoteHostProfile,
    app: String,
    id: String,
    secret: Option<RemoteConnectionSecret>,
) -> Result<(), String> {
    run_remote_helper_json(
        profile,
        vec!["prompts".to_string(), "delete".to_string(), app, id],
        secret,
        "Remote prompt delete",
    )
    .await
}

#[tauri::command]
pub async fn remote_enable_prompt(
    profile: RemoteHostProfile,
    app: String,
    id: String,
    secret: Option<RemoteConnectionSecret>,
) -> Result<(), String> {
    run_remote_helper_json(
        profile,
        vec!["prompts".to_string(), "enable".to_string(), app, id],
        secret,
        "Remote prompt enable",
    )
    .await
}

#[tauri::command]
pub async fn remote_import_prompt_from_file(
    profile: RemoteHostProfile,
    app: String,
    secret: Option<RemoteConnectionSecret>,
) -> Result<String, String> {
    run_remote_helper_json(
        profile,
        vec!["prompts".to_string(), "import".to_string(), app],
        secret,
        "Remote prompt import",
    )
    .await
}

#[tauri::command]
pub async fn remote_get_current_prompt_file_content(
    profile: RemoteHostProfile,
    app: String,
    secret: Option<RemoteConnectionSecret>,
) -> Result<Option<String>, String> {
    run_remote_helper_json(
        profile,
        vec!["prompts".to_string(), "current".to_string(), app],
        secret,
        "Remote prompt current",
    )
    .await
}

#[tauri::command]
pub async fn remote_get_installed_skills(
    profile: RemoteHostProfile,
    secret: Option<RemoteConnectionSecret>,
) -> Result<Vec<InstalledSkill>, String> {
    run_remote_helper_json(
        profile,
        vec!["skills".to_string(), "installed".to_string()],
        secret,
        "Remote skills installed",
    )
    .await
}

#[tauri::command]
pub async fn remote_get_skill_backups(
    profile: RemoteHostProfile,
    secret: Option<RemoteConnectionSecret>,
) -> Result<Vec<SkillBackupEntry>, String> {
    run_remote_helper_json(
        profile,
        vec!["skills".to_string(), "backups".to_string()],
        secret,
        "Remote skill backups",
    )
    .await
}

#[tauri::command]
pub async fn remote_delete_skill_backup(
    profile: RemoteHostProfile,
    #[allow(non_snake_case)] backupId: String,
    secret: Option<RemoteConnectionSecret>,
) -> Result<bool, String> {
    run_remote_helper_json(
        profile,
        vec!["skills".to_string(), "delete-backup".to_string(), backupId],
        secret,
        "Remote skill backup delete",
    )
    .await
}

#[tauri::command]
pub async fn remote_install_skill_unified(
    profile: RemoteHostProfile,
    skill: DiscoverableSkill,
    #[allow(non_snake_case)] currentApp: String,
    secret: Option<RemoteConnectionSecret>,
) -> Result<InstalledSkill, String> {
    let skill_json = serde_json::to_string(&skill).map_err(|e| e.to_string())?;
    run_remote_helper_json(
        profile,
        vec![
            "skills".to_string(),
            "install".to_string(),
            skill_json,
            currentApp,
        ],
        secret,
        "Remote skill install",
    )
    .await
}

#[tauri::command]
pub async fn remote_uninstall_skill_unified(
    profile: RemoteHostProfile,
    id: String,
    secret: Option<RemoteConnectionSecret>,
) -> Result<SkillUninstallResult, String> {
    run_remote_helper_json(
        profile,
        vec!["skills".to_string(), "uninstall".to_string(), id],
        secret,
        "Remote skill uninstall",
    )
    .await
}

#[tauri::command]
pub async fn remote_restore_skill_backup(
    profile: RemoteHostProfile,
    #[allow(non_snake_case)] backupId: String,
    #[allow(non_snake_case)] currentApp: String,
    secret: Option<RemoteConnectionSecret>,
) -> Result<InstalledSkill, String> {
    run_remote_helper_json(
        profile,
        vec![
            "skills".to_string(),
            "restore".to_string(),
            backupId,
            currentApp,
        ],
        secret,
        "Remote skill restore",
    )
    .await
}

#[tauri::command]
pub async fn remote_toggle_skill_app(
    profile: RemoteHostProfile,
    id: String,
    app: String,
    enabled: bool,
    secret: Option<RemoteConnectionSecret>,
) -> Result<bool, String> {
    run_remote_helper_json(
        profile,
        vec![
            "skills".to_string(),
            "toggle".to_string(),
            id,
            app,
            enabled.to_string(),
        ],
        secret,
        "Remote skill toggle",
    )
    .await
}

#[tauri::command]
pub async fn remote_scan_unmanaged_skills(
    profile: RemoteHostProfile,
    secret: Option<RemoteConnectionSecret>,
) -> Result<Vec<UnmanagedSkill>, String> {
    run_remote_helper_json(
        profile,
        vec!["skills".to_string(), "scan-unmanaged".to_string()],
        secret,
        "Remote unmanaged skills scan",
    )
    .await
}

#[tauri::command]
pub async fn remote_import_skills_from_apps(
    profile: RemoteHostProfile,
    imports: Vec<ImportSkillSelection>,
    secret: Option<RemoteConnectionSecret>,
) -> Result<Vec<InstalledSkill>, String> {
    let imports_json = serde_json::to_string(&imports).map_err(|e| e.to_string())?;
    run_remote_helper_json(
        profile,
        vec!["skills".to_string(), "import".to_string(), imports_json],
        secret,
        "Remote skills import",
    )
    .await
}

#[tauri::command]
pub async fn remote_discover_available_skills(
    profile: RemoteHostProfile,
    secret: Option<RemoteConnectionSecret>,
) -> Result<Vec<DiscoverableSkill>, String> {
    run_remote_helper_json(
        profile,
        vec!["skills".to_string(), "discover".to_string()],
        secret,
        "Remote skills discover",
    )
    .await
}

#[tauri::command]
pub async fn remote_check_skill_updates(
    profile: RemoteHostProfile,
    secret: Option<RemoteConnectionSecret>,
) -> Result<Vec<SkillUpdateInfo>, String> {
    run_remote_helper_json(
        profile,
        vec!["skills".to_string(), "check-updates".to_string()],
        secret,
        "Remote skill updates check",
    )
    .await
}

#[tauri::command]
pub async fn remote_update_skill(
    profile: RemoteHostProfile,
    id: String,
    secret: Option<RemoteConnectionSecret>,
) -> Result<InstalledSkill, String> {
    run_remote_helper_json(
        profile,
        vec!["skills".to_string(), "update".to_string(), id],
        secret,
        "Remote skill update",
    )
    .await
}

#[tauri::command]
pub async fn remote_get_skill_repos(
    profile: RemoteHostProfile,
    secret: Option<RemoteConnectionSecret>,
) -> Result<Vec<SkillRepo>, String> {
    run_remote_helper_json(
        profile,
        vec!["skills".to_string(), "repos".to_string()],
        secret,
        "Remote skill repos",
    )
    .await
}

#[tauri::command]
pub async fn remote_add_skill_repo(
    profile: RemoteHostProfile,
    repo: SkillRepo,
    secret: Option<RemoteConnectionSecret>,
) -> Result<bool, String> {
    let repo_json = serde_json::to_string(&repo).map_err(|e| e.to_string())?;
    run_remote_helper_json(
        profile,
        vec!["skills".to_string(), "add-repo".to_string(), repo_json],
        secret,
        "Remote skill repo add",
    )
    .await
}

#[tauri::command]
pub async fn remote_remove_skill_repo(
    profile: RemoteHostProfile,
    owner: String,
    name: String,
    secret: Option<RemoteConnectionSecret>,
) -> Result<bool, String> {
    run_remote_helper_json(
        profile,
        vec!["skills".to_string(), "remove-repo".to_string(), owner, name],
        secret,
        "Remote skill repo remove",
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::remote::{RemoteAuthMethod, RemoteHostProfile};
    use crate::remote_capabilities::REMOTE_HELPER_REQUIRED_CAPABILITIES;

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
    fn validates_remote_profile() {
        assert!(remote_validate_profile(valid_profile()).unwrap());
    }

    #[test]
    fn builds_status_command_after_validation() {
        let args = remote_build_status_command(valid_profile()).unwrap();

        assert!(args.windows(2).any(|pair| pair == ["-p", "22"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["-o", "ConnectTimeout=10"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["-o", "StrictHostKeyChecking=accept-new"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["-o", "NumberOfPasswordPrompts=1"]));
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
        assert!(args.windows(2).any(|pair| pair == ["-o", "BatchMode=yes"]));
        assert_eq!(args[args.len() - 2], "ccswitch@example.com");
        assert_eq!(
            args.last().expect("remote command"),
            "/usr/local/bin/cc-switch-helper --json status"
        );
    }

    #[test]
    fn builds_helper_install_command_after_validation() {
        let args = remote_build_helper_install_command(valid_profile()).unwrap();
        let command = args.last().expect("remote command");

        assert!(command.contains(
            "https://api.github.com/repos/xiaoY233/cc-switch-remote/releases/tags/remote-helper-latest"
        ));
        assert!(command.contains("cc-switch-remote-helper"));
        assert!(command.contains("cc-switch-cli"));
        assert!(command.contains("Downloaded remote helper is not compatible with this server"));
        assert!(command.contains("No compatible cc-switch-remote helper release asset found"));
        assert!(command.contains("\"$helper_path\" --json status"));
        assert!(command.contains("'\"settings\"'"));
        assert!(command.contains("'\"plugin\"'"));
        assert!(command.contains("'\"session\"'"));
        assert!(command.contains(&REMOTE_HELPER_REQUIRED_CAPABILITIES.join(", ")));
        assert!(!command.contains("rustup.rs"));
        assert!(!command.contains("cargo install --git"));
    }

    #[tokio::test]
    async fn remote_session_status_defaults_to_idle() {
        let status = remote_get_session_status("missing".to_string())
            .await
            .unwrap();

        assert_eq!(status.profile_id, "missing");
        assert_eq!(status.state, crate::remote::RemoteSessionState::Idle);
    }

    #[test]
    fn rejects_invalid_helper_json_with_context() {
        let err = remote_parse_helper_response("{".to_string()).unwrap_err();

        assert!(err.starts_with("Invalid helper JSON: "));
    }

    #[test]
    fn normalizes_old_helper_command_not_found_tool_versions() {
        let value = json!([
            {
                "name": "gemini",
                "version": null,
                "latest_version": "0.45.0",
                "error": "bash: line 1: gemini: command not found",
                "installed_but_broken": true,
                "env_type": "linux",
                "wsl_distro": null
            },
            {
                "name": "opencode",
                "version": null,
                "latest_version": "1.15.13",
                "error": "bash: line 1: opencode: command not found",
                "installed_but_broken": true,
                "env_type": "linux",
                "wsl_distro": null
            }
        ]);

        let normalized = normalize_remote_tool_versions(value);

        assert_eq!(normalized[0]["installed_but_broken"], false);
        assert_eq!(normalized[0]["error"], "not installed or not executable");
        assert_eq!(normalized[1]["installed_but_broken"], false);
        assert_eq!(normalized[1]["error"], "not installed or not executable");
    }

    #[test]
    fn marks_helper_update_available_when_current_build_is_unknown() {
        let status = json!({
            "version": "3.16.2",
            "platform": "linux",
            "capabilities": ["providers", "tools"]
        });

        let health = remote_health_from_status_with_latest(
            status,
            Some(RemoteHelperLatest {
                version: "3.16.2".to_string(),
                build: Some("abcdef12".to_string()),
                asset_name: Some("cc-switch-remote-helper-abcdef12-Linux-x86_64".to_string()),
            }),
        );

        assert_eq!(health.helper_latest_version.as_deref(), Some("3.16.2"));
        assert_eq!(health.helper_latest_build.as_deref(), Some("abcdef12"));
        assert_eq!(
            health.helper_latest_asset.as_deref(),
            Some("cc-switch-remote-helper-abcdef12-Linux-x86_64")
        );
        assert!(health.helper_update_available);
    }

    #[test]
    fn detects_missing_session_capability() {
        let status = json!({
            "version": "3.16.3",
            "build": "abc123",
            "platform": "linux",
            "arch": "x86_64",
            "capabilities": ["providers", "settings"]
        });

        let health = remote_health_from_status_with_latest_result(status, Ok(None));

        assert!(!health.capabilities.contains(&RemoteCapability::Session));
        assert_eq!(
            health.helper_update_error.as_deref(),
            Some("远程 Helper 版本过旧，不支持持久会话；请更新 Helper。")
        );
    }

    #[test]
    fn parses_new_remote_management_capabilities() {
        assert_eq!(
            parse_remote_capability("universal-providers"),
            Some(RemoteCapability::UniversalProviders)
        );
        assert_eq!(
            parse_remote_capability("routing-config"),
            Some(RemoteCapability::RoutingConfig)
        );
        assert_eq!(
            parse_remote_capability("routing-runtime"),
            Some(RemoteCapability::RoutingRuntime)
        );
        assert_eq!(
            parse_remote_capability("stream-check"),
            Some(RemoteCapability::StreamCheck)
        );
    }

    #[test]
    fn treats_full_and_short_helper_build_hashes_as_same_build() {
        let status = json!({
            "version": "3.16.2",
            "build": "27e7b3176306fd83479e9ea143c0d418df626a80",
            "platform": "linux",
            "arch": "x86_64",
            "capabilities": ["providers", "tools"]
        });

        let health = remote_health_from_status_with_latest(
            status,
            Some(RemoteHelperLatest {
                version: "3.16.2".to_string(),
                build: Some("27e7b317".to_string()),
                asset_name: Some("cc-switch-remote-helper-27e7b317-Linux-x86_64".to_string()),
            }),
        );

        assert!(!health.helper_update_available);
    }

    #[test]
    fn marks_helper_update_available_when_build_hash_prefix_differs() {
        let status = json!({
            "version": "3.16.2",
            "build": "27e7b3176306fd83479e9ea143c0d418df626a80",
            "platform": "linux",
            "arch": "x86_64",
            "capabilities": ["providers", "tools"]
        });

        let health = remote_health_from_status_with_latest(
            status,
            Some(RemoteHelperLatest {
                version: "3.16.2".to_string(),
                build: Some("abcdef12".to_string()),
                asset_name: Some("cc-switch-remote-helper-abcdef12-Linux-x86_64".to_string()),
            }),
        );

        assert!(health.helper_update_available);
    }

    #[test]
    fn keeps_real_tool_runtime_failures_marked_broken() {
        let value = json!([
            {
                "name": "gemini",
                "version": null,
                "latest_version": "0.45.0",
                "error": "node: version too old",
                "installed_but_broken": true,
                "env_type": "linux",
                "wsl_distro": null
            }
        ]);

        let normalized = normalize_remote_tool_versions(value);

        assert_eq!(normalized[0]["installed_but_broken"], true);
        assert_eq!(normalized[0]["error"], "node: version too old");
    }
}
