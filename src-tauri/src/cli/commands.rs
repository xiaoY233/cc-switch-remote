use crate::app_config::{InstalledSkill, UnmanagedSkill};
use crate::prompt::Prompt;
use crate::provider::UniversalProvider;
use crate::services::provider_secrets::{
    redact_provider_map_secret_values, restore_redacted_secret_values,
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
#[cfg(feature = "proxy-runtime")]
use once_cell::sync::Lazy;
use serde::Serialize;
use serde_json::{json, Value};
use std::str::FromStr;
use std::sync::Arc;

#[cfg(feature = "proxy-runtime")]
static ROUTING_RUNTIME: Lazy<Result<tokio::runtime::Runtime, String>> =
    Lazy::new(|| tokio::runtime::Runtime::new().map_err(|e| e.to_string()));
#[cfg(feature = "proxy-runtime")]
static ROUTING_STATE: Lazy<Result<AppState, String>> = Lazy::new(|| {
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    Ok(AppState::new(db))
});

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusPayload {
    pub version: String,
    pub build: Option<String>,
    pub platform: String,
    pub arch: String,
    pub capabilities: Vec<String>,
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

#[cfg(feature = "proxy-runtime")]
fn routing_runtime() -> Result<&'static tokio::runtime::Runtime, String> {
    ROUTING_RUNTIME.as_ref().map_err(Clone::clone)
}

#[cfg(feature = "proxy-runtime")]
fn routing_state() -> Result<&'static AppState, String> {
    ROUTING_STATE.as_ref().map_err(Clone::clone)
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
pub fn routing_runtime_status() -> Result<crate::proxy::types::ProxyStatus, String> {
    let state = routing_state()?;
    routing_runtime()?.block_on(state.proxy_service.get_status())
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
        if !state.proxy_service.is_running().await {
            return Ok(true);
        }
        state.proxy_service.stop().await?;
        Ok(true)
    })
}

#[cfg(not(feature = "proxy-runtime"))]
pub fn routing_runtime_stop() -> Result<bool, String> {
    Err("This helper build does not include remote routing runtime support".to_string())
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
        tools,
        action.to_string(),
        None,
    ))
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
    Ok(providers.into_iter().collect())
}

pub fn get_universal_provider(id: &str) -> Result<Option<UniversalProvider>, String> {
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    let state = AppState::new(db);
    ProviderService::get_universal(&state, id).map_err(|e| e.to_string())
}

pub fn upsert_universal_provider(provider_json: &str) -> Result<bool, String> {
    let provider: UniversalProvider =
        serde_json::from_str(provider_json).map_err(|e| e.to_string())?;
    let db = Arc::new(Database::init().map_err(|e| e.to_string())?);
    let state = AppState::new(db);
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

            db.update_proxy_config_for_app(config.clone())
                .await
                .map_err(|e| e.to_string())?;

            if enabled_changed || desired_enabled {
                if let Err(error) = state
                    .proxy_service
                    .set_takeover_for_app(&app_type, desired_enabled)
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
