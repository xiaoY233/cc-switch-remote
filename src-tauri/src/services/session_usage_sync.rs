use crate::error::AppError;
use crate::services::session_usage::SessionSyncResult;
use crate::Database;

pub fn sync_all_session_usage(db: &Database) -> Result<SessionSyncResult, AppError> {
    #[cfg(test)]
    if std::env::var_os("CC_SWITCH_DISABLE_SESSION_SYNC_FOR_TESTS").is_some() {
        return Ok(SessionSyncResult {
            imported: 0,
            skipped: 0,
            files_scanned: 0,
            suspected_duplicates: 0,
            deferred_files: 0,
            errors: vec![],
        });
    }

    let mut result = crate::services::session_usage::sync_claude_session_logs(db)?;

    match crate::services::session_usage_codex::sync_codex_usage(db) {
        Ok(codex_result) => merge_sync_result(&mut result, codex_result),
        Err(e) => result.errors.push(format!("Codex 同步失败: {e}")),
    }

    match crate::services::session_usage_gemini::sync_gemini_usage(db) {
        Ok(gemini_result) => merge_sync_result(&mut result, gemini_result),
        Err(e) => result.errors.push(format!("Gemini 同步失败: {e}")),
    }

    match crate::services::session_usage_opencode::sync_opencode_usage(db) {
        Ok(opencode_result) => merge_sync_result(&mut result, opencode_result),
        Err(e) => result.errors.push(format!("OpenCode 同步失败: {e}")),
    }

    Ok(result)
}

fn merge_sync_result(target: &mut SessionSyncResult, source: SessionSyncResult) {
    target.imported += source.imported;
    target.skipped += source.skipped;
    target.files_scanned += source.files_scanned;
    target.suspected_duplicates += source.suspected_duplicates;
    target.deferred_files += source.deferred_files;
    target.errors.extend(source.errors);
}
