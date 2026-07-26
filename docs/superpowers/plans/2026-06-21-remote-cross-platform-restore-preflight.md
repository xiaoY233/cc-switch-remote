# Remote Cross-Platform Restore Preflight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a remote-only preflight and portable restore path that prevents source-machine Codex live-config fragments, including macOS/Windows/Linux absolute paths, from being blindly restored onto remote hosts.

**Architecture:** Keep upstream-local SQL import/export, provider storage, and local WebDAV/S3 sync unchanged. Add a focused Rust scanner for SQL provider payloads, expose it through remote commands and helper-only cloud-sync preview/import commands, then update the remote UI to show risks and let users choose exact or portable restore.

**Tech Stack:** Rust/Tauri commands, `rusqlite`, `serde_json`, `toml_edit`, existing remote helper JSON protocol, React/TypeScript settings/import UI, Vitest, Cargo tests.

---

## File Structure

- Create `src-tauri/src/remote_restore_preflight.rs`
  - Pure functions for scanning CC Switch SQL dumps.
  - Extracts Codex provider `settings_config.config`.
  - Classifies local-only TOML entries.
  - Builds a portable SQL string by updating provider JSON payloads only.
- Modify `src-tauri/src/lib.rs`
  - Register the new Rust module.
  - Register new Tauri commands if command registration is central there.
- Modify `src-tauri/src/commands/remote.rs`
  - Add `remote_preflight_config_file`.
  - Add optional restore mode to remote SQL import.
  - Add preflight/portable variants for remote WebDAV/S3 download.
- Modify `src-tauri/src/cli/commands.rs`
  - Add helper commands for preflighting SQL/base64 SQL.
  - Add helper commands for remote WebDAV/S3 download preflight and portable download.
- Modify `src-tauri/src/cli/mod.rs`
  - Route new helper JSON commands.
- Modify `src-tauri/src/remote_capabilities.rs`
  - Add a capability such as `restore-preflight` only after helper commands are implemented.
- Modify `src/lib/api/remote.ts`
  - Add typed remote APIs for preflight and restore modes.
- Modify `src/lib/api/settings.ts`
  - Thread restore mode through remote WebDAV/S3 download without changing local APIs.
- Modify `src/hooks/useImportExport.ts`
  - Show preflight before remote SQL import.
- Modify `src/components/settings/WebdavSyncSection.tsx`
  - Show preflight before remote WebDAV/S3 download confirmation.
- Modify `src/i18n/locales/{en,zh,ja,zh-TW}.json`
  - Add localized labels for exact restore, portable restore, risks, and skipped fields.
- Test `src-tauri/tests/remote_restore_preflight.rs`
  - Rust scanner and transformation coverage.
- Test `src/lib/api/settings-cloud-sync.test.ts`
  - Remote WebDAV/S3 APIs pass restore mode only for remote targets.

## Task 1: Add Rust Preflight Types and Scanner

**Files:**
- Create: `src-tauri/src/remote_restore_preflight.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/tests/remote_restore_preflight.rs`

- [ ] **Step 1: Write failing scanner tests**

Create `src-tauri/tests/remote_restore_preflight.rs`:

```rust
use cc_switch_lib::remote_restore_preflight::{
    preflight_sql, RestoreMode, RiskKind, SourceKind, transform_sql_for_portable_restore,
};

fn sql_with_provider(config: &str) -> String {
    let settings = serde_json::json!({
        "auth": { "OPENAI_API_KEY": "sk-test" },
        "config": config
    });
    let escaped = settings.to_string().replace('\'', "''");
    format!(
        "-- CC Switch SQLite 导出\n\
         PRAGMA user_version=11;\n\
         BEGIN TRANSACTION;\n\
         CREATE TABLE providers (id TEXT, app_type TEXT, name TEXT, settings_config TEXT, meta TEXT, is_current INTEGER, category TEXT);\n\
         INSERT INTO \"providers\" (\"id\",\"app_type\",\"name\",\"settings_config\",\"meta\",\"is_current\",\"category\") VALUES ('newapi','codex','NewAPI','{escaped}','{{}}',1,'third_party');\n\
         COMMIT;\n"
    )
}

#[test]
fn detects_macos_codex_runtime_paths() {
    let sql = sql_with_provider(r#"
model_provider = "newapi"
model = "Groq/gpt-oss-120b"
notify = [ "/Users/example/.codex/computer-use/Codex Computer Use.app/Contents/MacOS/SkyComputerUseClient", "turn-ended" ]

[model_providers.newapi]
name = "OpenAI"
base_url = "http://192.168.123.216:3000/v1"
wire_api = "responses"

[mcp_servers.node_repl]
command = "/Applications/Codex.app/Contents/Resources/cua_node/bin/node_repl"

[mcp_servers.node_repl.env]
CODEX_HOME = "/Users/example/.codex"
"#);

    let report = preflight_sql(&sql, SourceKind::SqlFile).expect("preflight");
    assert!(report.has_blocking_risks);
    assert!(report
        .risks
        .iter()
        .any(|risk| risk.kind == RiskKind::MacosPath && risk.toml_path == "notify"));
    assert!(report
        .risks
        .iter()
        .any(|risk| risk.kind == RiskKind::CodexDesktopRuntime
            && risk.toml_path == "mcp_servers.node_repl.command"));
}

#[test]
fn portable_transform_keeps_provider_route_and_removes_runtime_sections() {
    let sql = sql_with_provider(r#"
model_provider = "newapi"
model = "Groq/gpt-oss-120b"
notify = [ "/Users/example/.codex/computer-use/Codex Computer Use.app/Contents/MacOS/SkyComputerUseClient", "turn-ended" ]

[model_providers.newapi]
name = "OpenAI"
base_url = "http://192.168.123.216:3000/v1"
wire_api = "responses"

[mcp_servers.DeepWiki]
type = "http"
url = "https://mcp.deepwiki.com/mcp"

[mcp_servers.node_repl]
command = "/Applications/Codex.app/Contents/Resources/cua_node/bin/node_repl"

[desktop]
appearanceTheme = "dark"
"#);

    let transformed = transform_sql_for_portable_restore(&sql).expect("transform");
    assert!(transformed.contains("model_provider = \\\"newapi\\\""));
    assert!(transformed.contains("base_url = \\\"http://192.168.123.216:3000/v1\\\""));
    assert!(transformed.contains("mcp_servers.DeepWiki"));
    assert!(!transformed.contains("/Users/example"));
    assert!(!transformed.contains("/Applications/Codex.app"));
    assert!(!transformed.contains("appearanceTheme"));
}

#[test]
fn exact_mode_does_not_transform_sql() {
    let sql = sql_with_provider("model_provider = \"newapi\"\n");
    let transformed = match RestoreMode::Exact {
        RestoreMode::Exact => sql.clone(),
        RestoreMode::PortableProvider => transform_sql_for_portable_restore(&sql).unwrap(),
    };
    assert_eq!(transformed, sql);
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test remote_restore_preflight -- --nocapture
```

Expected: FAIL because `remote_restore_preflight` module does not exist.

- [ ] **Step 3: Implement the scanner module**

Create `src-tauri/src/remote_restore_preflight.rs`:

```rust
use crate::error::AppError;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use toml_edit::{DocumentMut, Item};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SourceKind {
    SqlFile,
    WebDavPull,
    S3Pull,
    RemoteBackup,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RestoreMode {
    Exact,
    PortableProvider,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RiskKind {
    MacosPath,
    WindowsPath,
    CodexDesktopRuntime,
    LocalProxyUrl,
    DesktopOnlyConfig,
    MalformedToml,
    UnsupportedSqlShape,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RestoreRisk {
    pub source: SourceKind,
    pub app_type: String,
    pub provider_id: String,
    pub toml_path: String,
    pub kind: RiskKind,
    pub value_preview: String,
    pub suggested_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RestorePreflightReport {
    pub source: SourceKind,
    pub has_blocking_risks: bool,
    pub risks: Vec<RestoreRisk>,
}

#[derive(Debug, Clone)]
struct ProviderSqlRow {
    id: String,
    app_type: String,
    settings_config: Value,
    raw_settings_config: String,
}

pub fn preflight_sql(sql: &str, source: SourceKind) -> Result<RestorePreflightReport, AppError> {
    let mut risks = Vec::new();
    for provider in extract_provider_rows(sql)? {
        if provider.app_type != "codex" {
            continue;
        }
        let Some(config) = provider.settings_config.get("config").and_then(Value::as_str) else {
            continue;
        };
        scan_codex_config(source, &provider.id, config, &mut risks);
    }
    Ok(RestorePreflightReport {
        source,
        has_blocking_risks: !risks.is_empty(),
        risks,
    })
}

pub fn transform_sql_for_portable_restore(sql: &str) -> Result<String, AppError> {
    let providers = extract_provider_rows(sql)?;
    let mut transformed = sql.to_string();
    for provider in providers {
        if provider.app_type != "codex" {
            continue;
        }
        let Some(config) = provider.settings_config.get("config").and_then(Value::as_str) else {
            continue;
        };
        let cleaned = clean_codex_config(config)?;
        if cleaned == config {
            continue;
        }
        let mut settings = provider.settings_config.clone();
        if let Some(obj) = settings.as_object_mut() {
            obj.insert("config".to_string(), Value::String(cleaned));
        }
        let next_raw = serde_json::to_string(&settings)
            .map_err(|e| AppError::Message(format!("serialize provider settings failed: {e}")))?;
        let old_sql = sql_quote(&provider.raw_settings_config);
        let new_sql = sql_quote(&next_raw);
        transformed = transformed.replacen(&old_sql, &new_sql, 1);
    }
    Ok(transformed)
}

fn extract_provider_rows(sql: &str) -> Result<Vec<ProviderSqlRow>, AppError> {
    let mut rows = Vec::new();
    for statement in sql.split(";\n") {
        if !statement.contains("INSERT INTO \"providers\"") {
            continue;
        }
        let values_start = statement.find("VALUES (").ok_or_else(|| {
            AppError::Message("Unsupported providers INSERT shape".to_string())
        })? + "VALUES (".len();
        let values = statement[values_start..].trim_end_matches(')');
        let fields = split_sql_values(values);
        if fields.len() < 4 {
            continue;
        }
        let id = sql_unquote(&fields[0]);
        let app_type = sql_unquote(&fields[1]);
        let settings_raw = sql_unquote(&fields[3]);
        let settings_config = serde_json::from_str::<Value>(&settings_raw)
            .map_err(|e| AppError::Message(format!("Invalid provider settings JSON: {e}")))?;
        rows.push(ProviderSqlRow {
            id,
            app_type,
            settings_config,
            raw_settings_config: settings_raw,
        });
    }
    Ok(rows)
}

fn split_sql_values(input: &str) -> Vec<String> {
    let mut values = Vec::new();
    let mut current = String::new();
    let mut chars = input.chars().peekable();
    let mut in_string = false;
    while let Some(ch) = chars.next() {
        match ch {
            '\'' => {
                current.push(ch);
                if in_string && chars.peek() == Some(&'\'') {
                    current.push(chars.next().unwrap());
                } else {
                    in_string = !in_string;
                }
            }
            ',' if !in_string => {
                values.push(current.trim().to_string());
                current.clear();
            }
            _ => current.push(ch),
        }
    }
    if !current.trim().is_empty() {
        values.push(current.trim().to_string());
    }
    values
}

fn sql_unquote(value: &str) -> String {
    value
        .trim()
        .trim_start_matches('\'')
        .trim_end_matches('\'')
        .replace("''", "'")
}

fn sql_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn scan_codex_config(
    source: SourceKind,
    provider_id: &str,
    config: &str,
    risks: &mut Vec<RestoreRisk>,
) {
    let Ok(doc) = config.parse::<DocumentMut>() else {
        risks.push(risk(source, provider_id, "<config>", RiskKind::MalformedToml, "invalid TOML"));
        return;
    };
    scan_item(source, provider_id, "", doc.as_item(), risks);
}

fn scan_item(
    source: SourceKind,
    provider_id: &str,
    prefix: &str,
    item: &Item,
    risks: &mut Vec<RestoreRisk>,
) {
    if let Some(value) = item.as_str() {
        classify_value(source, provider_id, prefix, value, risks);
    }
    if let Some(array) = item.as_array() {
        for (idx, value) in array.iter().enumerate() {
            if let Some(text) = value.as_str() {
                classify_value(source, provider_id, &format!("{prefix}[{idx}]"), text, risks);
            }
        }
    }
    if let Some(table) = item.as_table_like() {
        for (key, child) in table.iter() {
            let path = if prefix.is_empty() {
                key.to_string()
            } else {
                format!("{prefix}.{key}")
            };
            if matches!(path.as_str(), "desktop" | "plugins" | "features" | "notify")
                || path.starts_with("mcp_servers.node_repl")
            {
                risks.push(risk(
                    source,
                    provider_id,
                    &path,
                    RiskKind::CodexDesktopRuntime,
                    &child.to_string(),
                ));
            }
            scan_item(source, provider_id, &path, child, risks);
        }
    }
}

fn classify_value(
    source: SourceKind,
    provider_id: &str,
    path: &str,
    value: &str,
    risks: &mut Vec<RestoreRisk>,
) {
    if value.contains("/Users/") || value.contains("/Applications/") || value.contains(".app/Contents/") {
        risks.push(risk(source, provider_id, path, RiskKind::MacosPath, value));
    } else if value.contains("C:\\Users\\") || value.contains("\\\\wsl.localhost\\") {
        risks.push(risk(source, provider_id, path, RiskKind::WindowsPath, value));
    } else if value.contains("127.0.0.1:") || value.contains("localhost:") {
        risks.push(risk(source, provider_id, path, RiskKind::LocalProxyUrl, value));
    }
}

fn risk(
    source: SourceKind,
    provider_id: &str,
    toml_path: &str,
    kind: RiskKind,
    value: &str,
) -> RestoreRisk {
    RestoreRisk {
        source,
        app_type: "codex".to_string(),
        provider_id: provider_id.to_string(),
        toml_path: toml_path.to_string(),
        kind,
        value_preview: value.chars().take(160).collect(),
        suggested_action: "skip-in-portable-restore".to_string(),
    }
}

fn clean_codex_config(config: &str) -> Result<String, AppError> {
    let mut doc = config
        .parse::<DocumentMut>()
        .map_err(|e| AppError::Message(format!("Invalid Codex config.toml: {e}")))?;
    doc.as_table_mut().remove("notify");
    doc.as_table_mut().remove("desktop");
    doc.as_table_mut().remove("plugins");
    doc.as_table_mut().remove("features");
    if let Some(mcp) = doc
        .get_mut("mcp_servers")
        .and_then(|item| item.as_table_like_mut())
    {
        let removable = mcp
            .iter()
            .filter_map(|(name, item)| {
                let text = item.to_string();
                if name == "node_repl"
                    || text.contains("/Users/")
                    || text.contains("/Applications/")
                    || text.contains("C:\\Users\\")
                    || text.contains("\\\\wsl.localhost\\")
                {
                    Some(name.to_string())
                } else {
                    None
                }
            })
            .collect::<Vec<_>>();
        for key in removable {
            mcp.remove(&key);
        }
    }
    Ok(doc.to_string())
}
```

- [ ] **Step 4: Register the module**

Modify `src-tauri/src/lib.rs` near the other `mod` declarations:

```rust
pub mod remote_restore_preflight;
```

- [ ] **Step 5: Run scanner tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test remote_restore_preflight -- --nocapture
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add src-tauri/src/remote_restore_preflight.rs src-tauri/src/lib.rs src-tauri/tests/remote_restore_preflight.rs
git commit -m "feat: add remote restore preflight scanner"
```

## Task 2: Add Helper Commands for SQL Preflight and Portable Import

**Files:**
- Modify: `src-tauri/src/cli/commands.rs`
- Modify: `src-tauri/src/cli/mod.rs`
- Modify: `src-tauri/src/remote_capabilities.rs`

- [ ] **Step 1: Add helper command functions**

Append near `import_database_sql_b64` in `src-tauri/src/cli/commands.rs`:

```rust
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
```

- [ ] **Step 2: Route helper commands**

Modify `src-tauri/src/cli/mod.rs` near existing `import-export` routes:

```rust
[group, cmd, encoded_sql, source]
    if group == "import-export" && cmd == "preflight-sql-b64" =>
{
    let source = serde_json::from_str::<crate::remote_restore_preflight::SourceKind>(
        &format!("\"{source}\""),
    )
    .unwrap_or(crate::remote_restore_preflight::SourceKind::SqlFile);
    match commands::preflight_database_sql_b64(encoded_sql, source) {
        Ok(value) => serde_json::to_value(types::ok(value)).expect("serialize import preflight"),
        Err(message) => serde_json::to_value(types::err::<()>("import_export_preflight_failed", message))
            .expect("serialize import preflight error"),
    }
}
[group, cmd, encoded_sql, mode]
    if group == "import-export" && cmd == "import-sql-b64-mode" =>
{
    let mode = serde_json::from_str::<crate::remote_restore_preflight::RestoreMode>(
        &format!("\"{mode}\""),
    )
    .unwrap_or(crate::remote_restore_preflight::RestoreMode::Exact);
    match commands::import_database_sql_b64_with_mode(encoded_sql, mode) {
        Ok(value) => serde_json::to_value(types::ok(value)).expect("serialize import with mode"),
        Err(message) => serde_json::to_value(types::err::<()>("import_export_import_failed", message))
            .expect("serialize import with mode error"),
    }
}
```

- [ ] **Step 3: Add capability**

Modify `src-tauri/src/remote_capabilities.rs`:

```rust
"restore-preflight",
```

Add it after `"import-export"` so old helpers without the capability can be gated in UI.

- [ ] **Step 4: Run helper command checks**

Run:

```bash
cargo check --manifest-path src-tauri/Cargo.toml --bin cc-switch-remote-helper --no-default-features
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add src-tauri/src/cli/commands.rs src-tauri/src/cli/mod.rs src-tauri/src/remote_capabilities.rs
git commit -m "feat: expose remote restore preflight helper commands"
```

## Task 3: Add Remote Tauri Commands for File Import Preflight and Restore Mode

**Files:**
- Modify: `src-tauri/src/commands/remote.rs`
- Modify: `src-tauri/src/lib.rs` if command list registration is required

- [ ] **Step 1: Add request/response types**

In `src-tauri/src/commands/remote.rs`, add near existing remote import/export commands:

```rust
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteImportOptions {
    pub restore_mode: Option<crate::remote_restore_preflight::RestoreMode>,
}
```

- [ ] **Step 2: Add preflight command**

Add:

```rust
#[tauri::command]
pub async fn remote_preflight_config_file(
    profile: RemoteHostProfile,
    #[allow(non_snake_case)] filePath: String,
    secret: Option<RemoteConnectionSecret>,
) -> Result<crate::remote_restore_preflight::RestorePreflightReport, String> {
    ensure_remote_capabilities(
        &profile,
        &[RemoteCapability::ImportExport],
        &[String::from("restore-preflight")],
        "Remote config preflight",
    )?;
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
            "preflight-sql-b64".to_string(),
            encoded,
            "sql-file".to_string(),
        ],
        secret,
        "Remote config preflight",
    )
    .await
}
```

- [ ] **Step 3: Add restore mode to remote import**

Change `remote_import_config_from_file` signature:

```rust
pub async fn remote_import_config_from_file(
    profile: RemoteHostProfile,
    #[allow(non_snake_case)] filePath: String,
    options: Option<RemoteImportOptions>,
    secret: Option<RemoteConnectionSecret>,
) -> Result<Value, String> {
```

Change command vector:

```rust
let mode = options
    .and_then(|options| options.restore_mode)
    .unwrap_or(crate::remote_restore_preflight::RestoreMode::Exact);
let mode_arg = match mode {
    crate::remote_restore_preflight::RestoreMode::Exact => "exact",
    crate::remote_restore_preflight::RestoreMode::PortableProvider => "portable-provider",
};

run_remote_helper_json(
    profile,
    vec![
        "import-export".to_string(),
        "import-sql-b64-mode".to_string(),
        encoded,
        mode_arg.to_string(),
    ],
    secret,
    "Remote config import",
)
.await
```

- [ ] **Step 4: Register command in lib**

If `remote_preflight_config_file` is not automatically picked up, add it to the Tauri command list in `src-tauri/src/lib.rs` near other remote commands:

```rust
commands::remote_preflight_config_file,
```

- [ ] **Step 5: Compile**

Run:

```bash
cargo check --manifest-path src-tauri/Cargo.toml --bin cc-switch-remote
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add src-tauri/src/commands/remote.rs src-tauri/src/lib.rs
git commit -m "feat: add remote config import preflight command"
```

## Task 4: Add Remote WebDAV/S3 Download Preflight Commands

**Files:**
- Modify: `src-tauri/src/cli/commands.rs`
- Modify: `src-tauri/src/cli/mod.rs`
- Modify: `src-tauri/src/commands/remote.rs`

- [ ] **Step 1: Add helper cloud-sync preview functions**

Add functions in `src-tauri/src/cli/commands.rs` next to `webdav_download` and `s3_download` wrappers. Reuse the existing sync service internals if public; if not public, expose a minimal helper in the sync service that fetches the remote SQL artifact without applying it.

Expected wrapper signatures:

```rust
pub fn webdav_download_preflight() -> Result<crate::remote_restore_preflight::RestorePreflightReport, String> {
    let sql = crate::services::webdav_sync::download_remote_db_sql_for_preflight()
        .map_err(|e| e.to_string())?;
    crate::remote_restore_preflight::preflight_sql(
        &sql,
        crate::remote_restore_preflight::SourceKind::WebDavPull,
    )
    .map_err(|e| e.to_string())
}

pub fn s3_download_preflight() -> Result<crate::remote_restore_preflight::RestorePreflightReport, String> {
    let sql = crate::services::s3_sync::download_remote_db_sql_for_preflight()
        .map_err(|e| e.to_string())?;
    crate::remote_restore_preflight::preflight_sql(
        &sql,
        crate::remote_restore_preflight::SourceKind::S3Pull,
    )
    .map_err(|e| e.to_string())
}
```

If the existing services cannot expose SQL without broad refactors, implement the helper in the service module that already knows the v2 artifact path. Do not change local download behavior.

- [ ] **Step 2: Add portable download wrappers**

Add:

```rust
pub fn webdav_download_with_mode(
    mode: crate::remote_restore_preflight::RestoreMode,
) -> Result<Value, String> {
    match mode {
        crate::remote_restore_preflight::RestoreMode::Exact => webdav_download(),
        crate::remote_restore_preflight::RestoreMode::PortableProvider => {
            crate::services::webdav_sync::download_with_sql_transform(|sql| {
                crate::remote_restore_preflight::transform_sql_for_portable_restore(sql)
            })
            .map_err(|e| e.to_string())
        }
    }
}

pub fn s3_download_with_mode(
    mode: crate::remote_restore_preflight::RestoreMode,
) -> Result<Value, String> {
    match mode {
        crate::remote_restore_preflight::RestoreMode::Exact => s3_download(),
        crate::remote_restore_preflight::RestoreMode::PortableProvider => {
            crate::services::s3_sync::download_with_sql_transform(|sql| {
                crate::remote_restore_preflight::transform_sql_for_portable_restore(sql)
            })
            .map_err(|e| e.to_string())
        }
    }
}
```

These service functions must be remote-helper-only additions and must not alter existing local `download()` behavior.

- [ ] **Step 3: Route helper commands**

Modify `src-tauri/src/cli/mod.rs`:

```rust
[group, cmd] if group == "cloud-sync" && cmd == "webdav-download-preflight" => {
    match commands::webdav_download_preflight() {
        Ok(value) => serde_json::to_value(types::ok(value)).expect("serialize webdav download preflight"),
        Err(message) => serde_json::to_value(types::err::<()>("webdav_download_preflight_failed", message))
            .expect("serialize webdav download preflight error"),
    }
}
[group, cmd, mode] if group == "cloud-sync" && cmd == "webdav-download-mode" => {
    let mode = serde_json::from_str::<crate::remote_restore_preflight::RestoreMode>(&format!("\"{mode}\""))
        .unwrap_or(crate::remote_restore_preflight::RestoreMode::Exact);
    match commands::webdav_download_with_mode(mode) {
        Ok(value) => serde_json::to_value(types::ok(value)).expect("serialize webdav download with mode"),
        Err(message) => serde_json::to_value(types::err::<()>("webdav_download_failed", message))
            .expect("serialize webdav download with mode error"),
    }
}
```

Repeat the same shape for `s3-download-preflight` and `s3-download-mode`.

- [ ] **Step 4: Add remote Tauri commands**

Modify `src-tauri/src/commands/remote.rs`:

```rust
#[tauri::command]
pub async fn remote_webdav_sync_download_preflight(
    profile: RemoteHostProfile,
    secret: Option<RemoteConnectionSecret>,
) -> Result<crate::remote_restore_preflight::RestorePreflightReport, String> {
    run_remote_helper_json(
        profile,
        vec!["cloud-sync".to_string(), "webdav-download-preflight".to_string()],
        secret,
        "Remote WebDAV download preflight",
    )
    .await
}
```

Change `remote_webdav_sync_download` to accept `options: Option<RemoteImportOptions>` and route to `"webdav-download-mode"` with `exact` or `portable-provider`.

Repeat for S3.

- [ ] **Step 5: Compile**

Run:

```bash
cargo check --manifest-path src-tauri/Cargo.toml --bin cc-switch-remote-helper --no-default-features
cargo check --manifest-path src-tauri/Cargo.toml --bin cc-switch-remote
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add src-tauri/src/cli/commands.rs src-tauri/src/cli/mod.rs src-tauri/src/commands/remote.rs src-tauri/src/services/webdav_sync.rs src-tauri/src/services/s3_sync.rs
git commit -m "feat: add remote cloud sync restore preflight"
```

## Task 5: Add Frontend Remote API and UI Flow

**Files:**
- Modify: `src/lib/api/remote.ts`
- Modify: `src/lib/api/settings.ts`
- Modify: `src/hooks/useImportExport.ts`
- Modify: `src/components/settings/WebdavSyncSection.tsx`
- Modify: `src/i18n/locales/en.json`
- Modify: `src/i18n/locales/zh.json`
- Modify: `src/i18n/locales/ja.json`
- Modify: `src/i18n/locales/zh-TW.json`

- [ ] **Step 1: Add TypeScript types**

Add in `src/lib/api/remote.ts`:

```ts
export type RestoreMode = "exact" | "portable-provider";

export interface RestoreRisk {
  source: "sql-file" | "web-dav-pull" | "s3-pull" | "remote-backup";
  appType: string;
  providerId: string;
  tomlPath: string;
  kind:
    | "macos-path"
    | "windows-path"
    | "codex-desktop-runtime"
    | "local-proxy-url"
    | "desktop-only-config"
    | "malformed-toml"
    | "unsupported-sql-shape";
  valuePreview: string;
  suggestedAction: string;
}

export interface RestorePreflightReport {
  source: RestoreRisk["source"];
  hasBlockingRisks: boolean;
  risks: RestoreRisk[];
}
```

- [ ] **Step 2: Add remote API methods**

Add in `src/lib/api/remote.ts`:

```ts
preflightConfigFile(profile: RemoteHostProfile, filePath: string, secret?: RemoteConnectionSecret) {
  return invoke<RestorePreflightReport>("remote_preflight_config_file", {
    profile,
    filePath,
    secret,
  });
},
importConfigFromFile(
  profile: RemoteHostProfile,
  filePath: string,
  secret?: RemoteConnectionSecret,
  options?: { restoreMode?: RestoreMode },
) {
  return invoke<ConfigTransferResult>("remote_import_config_from_file", {
    profile,
    filePath,
    options,
    secret,
  });
},
webdavSyncDownloadPreflight(profile: RemoteHostProfile, secret?: RemoteConnectionSecret) {
  return invoke<RestorePreflightReport>("remote_webdav_sync_download_preflight", { profile, secret });
},
webdavSyncDownload(
  profile: RemoteHostProfile,
  secret?: RemoteConnectionSecret,
  options?: { restoreMode?: RestoreMode },
) {
  return invoke<WebDavSyncResult>("remote_webdav_sync_download", { profile, secret, options });
},
```

Repeat for S3.

- [ ] **Step 3: Thread settings API without changing local calls**

Modify `src/lib/api/settings.ts` remote branches only:

```ts
async webdavSyncDownload(target?: ManagementTarget, options?: { restoreMode?: RestoreMode }): Promise<WebDavSyncResult> {
  if (target?.type === "remote") {
    return await remoteApi.webdavSyncDownload(target.profile, target.secret, options);
  }
  return await invoke<WebDavSyncResult>("webdav_sync_download");
}
```

Repeat for S3.

- [ ] **Step 4: Add UI confirmation state**

In `src/components/settings/WebdavSyncSection.tsx`, extend dialog state:

```ts
const [restorePreflight, setRestorePreflight] = useState<RestorePreflightReport | null>(null);
const [restoreMode, setRestoreMode] = useState<RestoreMode>("exact");
```

Before remote download confirmation, call preflight:

```ts
if (target?.type === "remote") {
  const report = await settingsApi.webdavSyncDownloadPreflight(target);
  setRestorePreflight(report);
  setRestoreMode(report.hasBlockingRisks ? "portable-provider" : "exact");
}
```

On confirm:

```ts
await settingsApi.webdavSyncDownload(target, { restoreMode });
```

Repeat for S3.

- [ ] **Step 5: Render risk preview**

Inside download dialogs, add:

```tsx
{restorePreflight?.risks.length ? (
  <div className="rounded-md border border-border bg-muted/40 p-3 space-y-2">
    <p className="text-sm font-medium">
      {t("settings.remoteRestorePreflight.title")}
    </p>
    <div className="space-y-1 max-h-40 overflow-auto">
      {restorePreflight.risks.slice(0, 8).map((risk, index) => (
        <div key={`${risk.providerId}-${risk.tomlPath}-${index}`} className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{risk.providerId}</span>
          {" · "}
          <code>{risk.tomlPath}</code>
          {" · "}
          {t(`settings.remoteRestorePreflight.kind.${risk.kind}`)}
        </div>
      ))}
    </div>
    <div className="flex gap-2">
      <Button
        type="button"
        variant={restoreMode === "portable-provider" ? "default" : "outline"}
        size="sm"
        onClick={() => setRestoreMode("portable-provider")}
      >
        {t("settings.remoteRestorePreflight.portable")}
      </Button>
      <Button
        type="button"
        variant={restoreMode === "exact" ? "default" : "outline"}
        size="sm"
        onClick={() => setRestoreMode("exact")}
      >
        {t("settings.remoteRestorePreflight.exact")}
      </Button>
    </div>
  </div>
) : null}
```

- [ ] **Step 6: Add i18n keys**

Add equivalent keys in all locale JSON files:

```json
"remoteRestorePreflight": {
  "title": "Remote restore found local-only configuration",
  "portable": "Portable restore",
  "exact": "Exact restore",
  "kind": {
    "macos-path": "macOS path",
    "windows-path": "Windows path",
    "codex-desktop-runtime": "Codex Desktop runtime",
    "local-proxy-url": "Local proxy URL",
    "desktop-only-config": "Desktop-only config",
    "malformed-toml": "Invalid TOML",
    "unsupported-sql-shape": "Unsupported SQL shape"
  }
}
```

- [ ] **Step 7: Run frontend tests**

Run:

```bash
pnpm vitest run src/lib/api/settings-cloud-sync.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit Task 5**

```bash
git add src/lib/api/remote.ts src/lib/api/settings.ts src/hooks/useImportExport.ts src/components/settings/WebdavSyncSection.tsx src/i18n/locales/en.json src/i18n/locales/zh.json src/i18n/locales/ja.json src/i18n/locales/zh-TW.json
git commit -m "feat: add remote restore preflight UI"
```

## Task 6: Final Verification

**Files:**
- No new files unless fixes are needed.

- [ ] **Step 1: Run Rust checks**

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test remote_restore_preflight -- --nocapture
cargo check --manifest-path src-tauri/Cargo.toml --bin cc-switch-remote-helper --no-default-features
cargo check --manifest-path src-tauri/Cargo.toml --bin cc-switch-remote
```

Expected: all PASS.

- [ ] **Step 2: Run frontend checks**

```bash
pnpm vitest run src/lib/api/settings-cloud-sync.test.ts
pnpm typecheck
```

Expected: all PASS.

- [ ] **Step 3: Verify no local API behavior was changed**

Run:

```bash
git diff main -- src-tauri/src/database/backup.rs src-tauri/src/commands/import_export.rs src-tauri/src/services/provider/live.rs
```

Expected: no hunks unless a previous task explicitly required a local-neutral import or type-only change. If hunks exist, review and remove them unless they are necessary for remote-only wiring.

- [ ] **Step 4: Run whitespace check**

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 5: Commit final fixes if needed**

```bash
git add <fixed-files>
git commit -m "fix: polish remote restore preflight"
```

Skip this step if there are no fixes.
