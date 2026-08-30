//! Shared post-restore projection for every database restore entry point.
//!
//! A restored database is the SSOT for provider, prompt, pricing, and settings
//! projections. Keep this work here so desktop imports and the remote Helper
//! cannot drift and accidentally overwrite unmanaged prompt files.

use crate::error::AppError;
use crate::services::{model_pricing, PromptService, ProviderService};
use crate::settings;
use crate::store::AppState;

/// Re-project derived local files after a successful database restore.
///
/// Each projection is attempted independently: restoring the database has
/// already succeeded, so one stale derived file must not prevent the remaining
/// projections from reaching the restored state.
pub fn sync_restored_state(app_state: &AppState) -> Result<(), AppError> {
    let mut failures = Vec::new();

    if let Err(error) = ProviderService::sync_current_to_live(app_state) {
        failures.push(format!("live configuration: {error}"));
    }
    if let Err(error) = PromptService::sync_all_to_live(app_state) {
        failures.push(format!("prompts: {error}"));
    }
    if let Err(error) = model_pricing::sync_local_model_pricing(&app_state.db) {
        failures.push(format!("model pricing: {error}"));
    }
    if let Err(error) = settings::reload_settings() {
        failures.push(format!("settings cache: {error}"));
    }

    match app_state.db.get_log_config() {
        Ok(log_config) => log::set_max_level(log_config.to_level_filter()),
        Err(error) => {
            log::set_max_level(log::LevelFilter::Info);
            failures.push(format!("runtime log level: {error}"));
        }
    }
    app_state.usage_cache.invalidate_all();

    if failures.is_empty() {
        Ok(())
    } else {
        Err(AppError::Message(format!(
            "部分导入后同步失败: {}",
            failures.join("; ")
        )))
    }
}
