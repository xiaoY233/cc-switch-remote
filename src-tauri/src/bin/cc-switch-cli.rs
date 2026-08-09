#![cfg_attr(not(feature = "desktop"), allow(unused))]

#[path = "../app_config.rs"]
#[cfg(not(feature = "desktop"))]
mod app_config;
#[path = "../claude_desktop_config.rs"]
#[cfg(not(feature = "desktop"))]
mod claude_desktop_config;
#[path = "../claude_mcp.rs"]
#[cfg(not(feature = "desktop"))]
mod claude_mcp;
#[path = "../claude_plugin.rs"]
#[cfg(not(feature = "desktop"))]
mod claude_plugin;
#[path = "../cli/mod.rs"]
#[cfg(not(feature = "desktop"))]
mod cli;
#[path = "../codex_config.rs"]
#[cfg(not(feature = "desktop"))]
mod codex_config;
#[path = "../codex_history_migration.rs"]
#[cfg(not(feature = "desktop"))]
mod codex_history_migration;
#[path = "../codex_state_db.rs"]
#[cfg(not(feature = "desktop"))]
mod codex_state_db;
#[path = "../config.rs"]
#[cfg(not(feature = "desktop"))]
mod config;
#[path = "../database/mod.rs"]
#[cfg(not(feature = "desktop"))]
mod database;
#[path = "../error.rs"]
#[cfg(not(feature = "desktop"))]
mod error;
#[path = "../gemini_config.rs"]
#[cfg(not(feature = "desktop"))]
mod gemini_config;
#[path = "../gemini_mcp.rs"]
#[cfg(not(feature = "desktop"))]
mod gemini_mcp;
#[path = "../grok_config.rs"]
#[cfg(not(feature = "desktop"))]
mod grok_config;
#[path = "../hermes_config.rs"]
#[cfg(not(feature = "desktop"))]
pub mod hermes_config;
#[path = "../mcp/mod.rs"]
#[cfg(not(feature = "desktop"))]
mod mcp;
#[path = "../model_capabilities.rs"]
#[cfg(not(feature = "desktop"))]
mod model_capabilities;
#[path = "../openclaw_config.rs"]
#[cfg(not(feature = "desktop"))]
mod openclaw_config;
#[path = "../opencode_config.rs"]
#[cfg(not(feature = "desktop"))]
mod opencode_config;
#[path = "../prompt.rs"]
#[cfg(not(feature = "desktop"))]
mod prompt;
#[path = "../prompt_files.rs"]
#[cfg(not(feature = "desktop"))]
mod prompt_files;
#[path = "../provider.rs"]
#[cfg(not(feature = "desktop"))]
mod provider;
#[path = "../proxy/mod.rs"]
#[cfg(not(feature = "desktop"))]
mod proxy;
#[path = "../remote_capabilities.rs"]
#[cfg(not(feature = "desktop"))]
mod remote_capabilities;
#[path = "../remote_restore_preflight.rs"]
#[cfg(not(feature = "desktop"))]
mod remote_restore_preflight;
#[path = "../services/mod.rs"]
#[cfg(not(feature = "desktop"))]
mod services;
#[path = "../session_manager/mod.rs"]
#[cfg(not(feature = "desktop"))]
mod session_manager;
#[path = "../settings.rs"]
#[cfg(not(feature = "desktop"))]
mod settings;
#[path = "../store.rs"]
#[cfg(not(feature = "desktop"))]
mod store;
#[path = "../tool_environment.rs"]
#[cfg(not(feature = "desktop"))]
mod tool_environment;
#[path = "../usage_script.rs"]
#[cfg(not(feature = "desktop"))]
mod usage_script;

#[cfg(not(feature = "desktop"))]
pub(crate) struct RedactedUrl<'a> {
    url: &'a str,
    known_secrets: &'a [String],
}

#[cfg(not(feature = "desktop"))]
impl std::fmt::Display for RedactedUrl<'_> {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&redact_url_for_log_with_secrets(
            self.url,
            self.known_secrets,
        ))
    }
}

#[cfg(not(feature = "desktop"))]
pub(crate) fn url_for_log_with_secrets<'a>(
    url: &'a str,
    known_secrets: &'a [String],
) -> RedactedUrl<'a> {
    RedactedUrl { url, known_secrets }
}

#[cfg(not(feature = "desktop"))]
const MIN_KNOWN_SECRET_LEN: usize = 8;

#[cfg(not(feature = "desktop"))]
fn redact_known_secrets(text: &str, known_secrets: &[String]) -> String {
    let mut output = text.to_string();
    for secret in known_secrets {
        if secret.chars().count() >= MIN_KNOWN_SECRET_LEN {
            output = output.replace(secret.as_str(), "[REDACTED]");
        }
    }
    output
}

#[cfg(not(feature = "desktop"))]
fn strip_bare_userinfo(input: &str) -> &str {
    let authority_end = input.find('/').unwrap_or(input.len());
    match input[..authority_end].rfind('@') {
        Some(at) => &input[at + 1..],
        None => input,
    }
}

#[cfg(not(feature = "desktop"))]
pub(crate) fn redact_url_for_log(url_str: &str) -> String {
    redact_url_for_log_with_secrets(url_str, &[])
}

#[cfg(not(feature = "desktop"))]
pub(crate) fn redact_url_for_log_with_secrets(url_str: &str, known_secrets: &[String]) -> String {
    let scheme_relative = url_str.starts_with("//");
    let parsed = if scheme_relative {
        url::Url::parse(&format!("https:{url_str}"))
    } else {
        url::Url::parse(url_str)
    };

    let sanitized = match parsed {
        Ok(mut url) if url.has_host() => {
            let _ = url.set_username("");
            let _ = url.set_password(None);
            url.set_query(None);
            url.set_fragment(None);
            let rendered = url.as_str();
            if scheme_relative {
                rendered
                    .strip_prefix("https:")
                    .unwrap_or(rendered)
                    .to_string()
            } else {
                rendered.to_string()
            }
        }
        _ => {
            let without_tail = url_str.split(['?', '#']).next().unwrap_or(url_str);
            strip_bare_userinfo(without_tail).to_string()
        }
    };

    redact_known_secrets(&sanitized, known_secrets)
}

#[cfg(not(feature = "desktop"))]
pub(crate) fn redact_url_origin_for_log(url_str: &str) -> String {
    let scheme_relative = url_str.starts_with("//");
    let parsed = if scheme_relative {
        url::Url::parse(&format!("https:{url_str}"))
    } else {
        url::Url::parse(url_str)
    };

    match parsed {
        Ok(url) if url.has_host() => {
            let authority = &url[url::Position::BeforeHost..url::Position::AfterPort];
            if scheme_relative {
                format!("//{authority}")
            } else {
                format!("{}://{authority}", url.scheme())
            }
        }
        _ => "[invalid target]".to_string(),
    }
}

#[cfg(not(feature = "desktop"))]
mod app_store {
    use serde_json::Value;
    use std::path::PathBuf;
    use std::sync::{OnceLock, RwLock};

    const STORE_KEY_APP_CONFIG_DIR: &str = "app_config_dir_override";
    static APP_CONFIG_DIR_OVERRIDE: OnceLock<RwLock<Option<PathBuf>>> = OnceLock::new();

    fn override_cache() -> &'static RwLock<Option<PathBuf>> {
        APP_CONFIG_DIR_OVERRIDE.get_or_init(|| RwLock::new(read_override_from_file()))
    }

    pub fn get_app_config_dir_override() -> Option<std::path::PathBuf> {
        override_cache().read().ok()?.clone()
    }

    pub fn set_app_config_dir_override_for_cli(path: Option<&str>) -> Result<(), crate::AppError> {
        let value = match path.map(str::trim) {
            Some(trimmed) if !trimmed.is_empty() && trimmed != "-" => {
                let resolved =
                    crate::config::validate_app_config_dir_override(&resolve_path(trimmed))?;
                std::fs::create_dir_all(&resolved)
                    .map_err(|e| crate::AppError::io(&resolved, e))?;
                Some(resolved.to_string_lossy().to_string())
            }
            _ => None,
        };
        write_override_to_file(value.as_deref())?;
        if let Ok(mut guard) = override_cache().write() {
            *guard = read_override_from_file();
        }
        Ok(())
    }

    fn read_override_from_file() -> Option<PathBuf> {
        let path = helper_store_path();
        let content = std::fs::read_to_string(path).ok()?;
        let value: Value = serde_json::from_str(&content).ok()?;
        let raw = value.get(STORE_KEY_APP_CONFIG_DIR)?.as_str()?.trim();
        if raw.is_empty() {
            return None;
        }
        let path = resolve_path(raw);
        let path = crate::config::validate_app_config_dir_override(&path).ok()?;
        path.exists().then_some(path)
    }

    fn write_override_to_file(path: Option<&str>) -> Result<(), crate::AppError> {
        let store_path = helper_store_path();
        if let Some(parent) = store_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| crate::AppError::io(parent, e))?;
        }

        let mut value = if store_path.exists() {
            std::fs::read_to_string(&store_path)
                .ok()
                .and_then(|content| serde_json::from_str::<Value>(&content).ok())
                .unwrap_or_else(|| Value::Object(Default::default()))
        } else {
            Value::Object(Default::default())
        };

        let object = value
            .as_object_mut()
            .ok_or_else(|| crate::AppError::Message("Invalid app_paths.json".to_string()))?;
        match path {
            Some(raw) => {
                object.insert(
                    STORE_KEY_APP_CONFIG_DIR.to_string(),
                    Value::String(raw.trim().to_string()),
                );
            }
            None => {
                object.remove(STORE_KEY_APP_CONFIG_DIR);
            }
        }

        crate::config::atomic_write(&store_path, value.to_string().as_bytes())
    }

    fn helper_store_path() -> PathBuf {
        default_app_config_dir().join("app_paths.json")
    }

    fn default_app_config_dir() -> PathBuf {
        helper_home_dir().join(".cc-switch-remote")
    }

    fn helper_home_dir() -> PathBuf {
        if let Ok(home) = std::env::var("CC_SWITCH_TEST_HOME") {
            let trimmed = home.trim();
            if !trimmed.is_empty() {
                return PathBuf::from(trimmed);
            }
        }
        dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
    }

    fn resolve_path(raw: &str) -> PathBuf {
        if raw == "~" {
            return helper_home_dir();
        }
        if let Some(stripped) = raw.strip_prefix("~/") {
            return helper_home_dir().join(stripped);
        }
        if let Some(stripped) = raw.strip_prefix("~\\") {
            return helper_home_dir().join(stripped);
        }
        PathBuf::from(raw)
    }
}

#[cfg(not(feature = "desktop"))]
mod usage_events {
    pub fn notify_log_recorded() {}
}

#[cfg(not(feature = "desktop"))]
pub use app_config::{AppType, InstalledSkill, McpApps, McpServer, MultiAppConfig, SkillApps};
#[cfg(not(feature = "desktop"))]
pub use codex_config::{get_codex_auth_path, get_codex_config_path, write_codex_live_atomic};
#[cfg(not(feature = "desktop"))]
pub use config::{get_claude_mcp_path, get_claude_settings_path, read_json_file};
#[cfg(not(feature = "desktop"))]
pub use database::Database;
#[cfg(not(feature = "desktop"))]
pub use error::AppError;
#[cfg(not(feature = "desktop"))]
pub use mcp::{
    import_from_claude, import_from_codex, import_from_gemini, remove_server_from_claude,
    remove_server_from_codex, remove_server_from_gemini, sync_enabled_to_claude,
    sync_enabled_to_codex, sync_enabled_to_gemini, sync_single_server_to_claude,
    sync_single_server_to_codex, sync_single_server_to_gemini,
};
#[cfg(not(feature = "desktop"))]
pub use provider::{Provider, ProviderMeta};
#[cfg(not(feature = "desktop"))]
pub use services::{
    skill::{migrate_skills_to_ssot, ImportSkillSelection},
    ConfigService, EndpointLatency, McpService, PromptService, ProviderService, ProxyService,
    SkillService, SpeedtestService,
};
#[cfg(not(feature = "desktop"))]
pub use settings::{update_settings, AppSettings};
#[cfg(not(feature = "desktop"))]
pub use store::AppState;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    #[cfg(feature = "desktop")]
    let response = cc_switch_lib::cli::run_entry(&args);
    #[cfg(not(feature = "desktop"))]
    let response = cli::run_entry(&args);

    match response {
        #[cfg(feature = "desktop")]
        cc_switch_lib::cli::CliRunResult::Json(value) => {
            println!(
                "{}",
                serde_json::to_string(&value).expect("serialize CLI response")
            );
        }
        #[cfg(feature = "desktop")]
        cc_switch_lib::cli::CliRunResult::Served => {}
        #[cfg(not(feature = "desktop"))]
        cli::CliRunResult::Json(value) => {
            println!(
                "{}",
                serde_json::to_string(&value).expect("serialize CLI response")
            );
        }
        #[cfg(not(feature = "desktop"))]
        cli::CliRunResult::Served => {}
    }
}
