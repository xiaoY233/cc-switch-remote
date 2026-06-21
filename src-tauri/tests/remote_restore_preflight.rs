use cc_switch_lib::remote_restore_preflight::{
    preflight_sql, transform_sql_for_portable_restore, RestoreMode, RiskKind, SourceKind,
};

fn sql_with_provider(config: &str) -> String {
    let settings = serde_json::json!({
        "auth": { "OPENAI_API_KEY": "sk-test" },
        "config": config
    });
    let escaped = settings.to_string().replace('\'', "''");
    format!(
        "-- CC Switch SQLite export\n\
         PRAGMA user_version=11;\n\
         BEGIN TRANSACTION;\n\
         CREATE TABLE providers (id TEXT, app_type TEXT, name TEXT, settings_config TEXT, meta TEXT, is_current INTEGER, category TEXT);\n\
         INSERT INTO \"providers\" (\"id\",\"app_type\",\"name\",\"settings_config\",\"meta\",\"is_current\",\"category\") VALUES ('newapi','codex','NewAPI','{escaped}','{{}}',1,'third_party');\n\
         COMMIT;\n"
    )
}

#[test]
fn detects_macos_codex_runtime_paths() {
    let sql = sql_with_provider(
        r#"
model_provider = "newapi"
model = "Groq/gpt-oss-120b"
notify = [ "/Users/wangyu19/.codex/computer-use/Codex Computer Use.app/Contents/MacOS/SkyComputerUseClient", "turn-ended" ]

[model_providers.newapi]
name = "OpenAI"
base_url = "http://192.168.123.216:3000/v1"
wire_api = "responses"

[mcp_servers.node_repl]
command = "/Applications/Codex.app/Contents/Resources/cua_node/bin/node_repl"

[mcp_servers.node_repl.env]
CODEX_HOME = "/Users/wangyu19/.codex"
"#,
    );

    let report = preflight_sql(&sql, SourceKind::SqlFile).expect("preflight");
    assert!(report.has_blocking_risks);
    assert!(report
        .risks
        .iter()
        .any(|risk| { risk.kind == RiskKind::MacosPath && risk.toml_path == "notify[0]" }));
    assert!(report.risks.iter().any(|risk| {
        risk.kind == RiskKind::CodexDesktopRuntime
            && risk.toml_path == "mcp_servers.node_repl.command"
    }));
}

#[test]
fn portable_transform_keeps_provider_route_and_removes_runtime_sections() {
    let sql = sql_with_provider(
        r#"
model_provider = "newapi"
model = "Groq/gpt-oss-120b"
notify = [ "/Users/wangyu19/.codex/computer-use/Codex Computer Use.app/Contents/MacOS/SkyComputerUseClient", "turn-ended" ]

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
"#,
    );

    let transformed = transform_sql_for_portable_restore(&sql).expect("transform");
    assert!(transformed.contains("model_provider = \\\"newapi\\\""));
    assert!(transformed.contains("base_url = \\\"http://192.168.123.216:3000/v1\\\""));
    assert!(transformed.contains("mcp_servers.DeepWiki"));
    assert!(!transformed.contains("/Users/wangyu19"));
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

#[test]
fn detects_local_proxy_urls_in_provider_config() {
    let sql = sql_with_provider(
        r#"
[model_providers.local]
name = "Local"
base_url = "http://127.0.0.1:15721/v1"
"#,
    );

    let report = preflight_sql(&sql, SourceKind::WebDavPull).expect("preflight");
    assert!(report.risks.iter().any(|risk| {
        risk.kind == RiskKind::LocalProxyUrl
            && risk.source == SourceKind::WebDavPull
            && risk.toml_path == "model_providers.local.base_url"
    }));
}
