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

        let Some(config) = provider
            .settings_config
            .get("config")
            .and_then(Value::as_str)
        else {
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

        let Some(config) = provider
            .settings_config
            .get("config")
            .and_then(Value::as_str)
        else {
            continue;
        };

        let cleaned = clean_codex_config(config)?;
        if cleaned == config {
            continue;
        }

        let mut settings = provider.settings_config.clone();
        if let Some(object) = settings.as_object_mut() {
            object.insert("config".to_string(), Value::String(cleaned));
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

    for statement in split_sql_statements(sql) {
        if !statement.contains("INSERT INTO \"providers\"")
            && !statement.contains("INSERT INTO providers")
        {
            continue;
        }

        let values_marker = "VALUES";
        let Some(values_start) = statement.find(values_marker) else {
            return Err(AppError::Message(
                "Unsupported providers INSERT shape".to_string(),
            ));
        };
        let values = statement[values_start + values_marker.len()..].trim();
        let Some(values) = values.strip_prefix('(').and_then(|v| v.strip_suffix(')')) else {
            return Err(AppError::Message(
                "Unsupported providers INSERT values shape".to_string(),
            ));
        };

        let fields = split_sql_values(values);
        if fields.len() < 4 {
            continue;
        }

        let settings_raw = sql_unquote(&fields[3]);
        let settings_config = serde_json::from_str::<Value>(&settings_raw)
            .map_err(|e| AppError::Message(format!("Invalid provider settings JSON: {e}")))?;

        rows.push(ProviderSqlRow {
            id: sql_unquote(&fields[0]),
            app_type: sql_unquote(&fields[1]),
            settings_config,
            raw_settings_config: settings_raw,
        });
    }

    Ok(rows)
}

fn split_sql_statements(sql: &str) -> Vec<String> {
    let mut statements = Vec::new();
    let mut current = String::new();
    let mut chars = sql.chars().peekable();
    let mut in_string = false;

    while let Some(ch) = chars.next() {
        match ch {
            '\'' => {
                current.push(ch);
                if in_string && chars.peek() == Some(&'\'') {
                    current.push(chars.next().expect("peeked escaped SQL quote"));
                } else {
                    in_string = !in_string;
                }
            }
            ';' if !in_string => {
                let trimmed = current.trim();
                if !trimmed.is_empty() {
                    statements.push(trimmed.to_string());
                }
                current.clear();
            }
            _ => current.push(ch),
        }
    }

    let trimmed = current.trim();
    if !trimmed.is_empty() {
        statements.push(trimmed.to_string());
    }

    statements
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
                    current.push(chars.next().expect("peeked escaped SQL quote"));
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
        risks.push(risk_for_path(
            source,
            provider_id,
            "<config>",
            RiskKind::MalformedToml,
            "invalid TOML",
        ));
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
        for (index, value) in array.iter().enumerate() {
            if let Some(text) = value.as_str() {
                classify_value(
                    source,
                    provider_id,
                    &format!("{prefix}[{index}]"),
                    text,
                    risks,
                );
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

            if matches!(path.as_str(), "notify" | "desktop" | "plugins" | "features")
                || path.starts_with("mcp_servers.node_repl")
            {
                risks.push(risk_for_path(
                    source,
                    provider_id,
                    &path,
                    risk_kind_for_local_only_path(&path),
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
    if value.contains("/Users/")
        || value.contains("/Applications/")
        || value.contains(".app/Contents/")
    {
        risks.push(risk_for_path(
            source,
            provider_id,
            path,
            RiskKind::MacosPath,
            value,
        ));
    } else if value.contains("C:\\Users\\") || value.contains("\\\\wsl.localhost\\") {
        risks.push(risk_for_path(
            source,
            provider_id,
            path,
            RiskKind::WindowsPath,
            value,
        ));
    } else if value.contains("127.0.0.1:") || value.contains("localhost:") {
        risks.push(risk_for_path(
            source,
            provider_id,
            path,
            RiskKind::LocalProxyUrl,
            value,
        ));
    }
}

fn risk_kind_for_local_only_path(path: &str) -> RiskKind {
    if matches!(path, "desktop" | "plugins" | "features") {
        RiskKind::DesktopOnlyConfig
    } else {
        RiskKind::CodexDesktopRuntime
    }
}

fn risk_for_path(
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

    let root = doc.as_table_mut();
    root.remove("notify");
    root.remove("desktop");
    root.remove("plugins");
    root.remove("features");

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
                    || text.contains(".app/Contents/")
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
