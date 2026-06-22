pub mod commands;
pub mod serve;
pub mod types;

use serde_json::Value;

pub enum CliRunResult {
    Json(Value),
    Served,
}

pub fn run(args: &[String]) -> Value {
    match run_entry(args) {
        CliRunResult::Json(value) => value,
        CliRunResult::Served => serde_json::to_value(types::ok(())).expect("serialize serve end"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_bool_arg_accepts_helper_wire_values() {
        assert_eq!(parse_bool_arg("true"), Ok(true));
        assert_eq!(parse_bool_arg("1"), Ok(true));
        assert_eq!(parse_bool_arg("false"), Ok(false));
        assert_eq!(parse_bool_arg("0"), Ok(false));
    }

    #[test]
    fn set_auto_failover_rejects_invalid_bool_before_touching_state() {
        let args = vec![
            "routing-config".to_string(),
            "set-auto-failover".to_string(),
            "claude".to_string(),
            "enabled".to_string(),
        ];

        let response = run_command(&args);

        assert_eq!(response.get("ok").and_then(Value::as_bool), Some(false));
        assert_eq!(
            response
                .get("error")
                .and_then(|error| error.get("code"))
                .and_then(Value::as_str),
            Some("routing_auto_failover_set_failed")
        );
    }

    #[test]
    fn status_advertises_usage_capability() {
        let response = run_command(&["status".to_string()]);
        let capabilities = response
            .get("data")
            .and_then(|data| data.get("capabilities"))
            .and_then(Value::as_array)
            .expect("status capabilities");

        assert!(capabilities.iter().any(|capability| capability == "usage"));
    }

    #[test]
    fn status_advertises_auth_capability() {
        let response = run_command(&["status".to_string()]);
        let capabilities = response
            .get("data")
            .and_then(|data| data.get("capabilities"))
            .and_then(Value::as_array)
            .expect("status capabilities");

        assert!(capabilities.iter().any(|capability| capability == "auth"));
    }

    #[test]
    fn status_advertises_restore_preflight_capability() {
        let response = run_command(&["status".to_string()]);
        let capabilities = response
            .get("data")
            .and_then(|data| data.get("capabilities"))
            .and_then(Value::as_array)
            .expect("status capabilities");

        assert!(capabilities
            .iter()
            .any(|capability| capability == "restore-preflight"));
    }

    #[test]
    fn status_advertises_provider_model_fetch_capability() {
        let response = run_command(&["status".to_string()]);
        let capabilities = response
            .get("data")
            .and_then(|data| data.get("capabilities"))
            .and_then(Value::as_array)
            .expect("status capabilities");

        assert!(capabilities
            .iter()
            .any(|capability| capability == "provider-model-fetch"));
    }

    #[test]
    fn providers_fetch_models_command_is_registered() {
        let response = run_command(&[
            "providers".to_string(),
            "fetch-models".to_string(),
            "not-an-app".to_string(),
            "provider-id".to_string(),
            "{}".to_string(),
        ]);

        assert_eq!(response.get("ok").and_then(Value::as_bool), Some(false));
        assert_eq!(
            response
                .get("error")
                .and_then(|error| error.get("code"))
                .and_then(Value::as_str),
            Some("invalid_app")
        );
    }

    #[test]
    fn openclaw_scan_health_command_is_registered() {
        let dir = tempfile::tempdir().expect("temp test home");
        let previous_home = std::env::var_os("CC_SWITCH_TEST_HOME");
        std::env::set_var("CC_SWITCH_TEST_HOME", dir.path());

        let response = run_command(&["openclaw".to_string(), "scan-health".to_string()]);

        match previous_home {
            Some(value) => std::env::set_var("CC_SWITCH_TEST_HOME", value),
            None => std::env::remove_var("CC_SWITCH_TEST_HOME"),
        }

        assert_eq!(response.get("ok").and_then(Value::as_bool), Some(true));
        assert!(response.get("data").and_then(Value::as_array).is_some());
    }

    #[test]
    fn import_export_preflight_sql_b64_returns_report() {
        let settings = serde_json::json!({
            "auth": {},
            "config": "notify = [\"/Users/test/.codex/hook\", \"turn-ended\"]\n"
        });
        let escaped = settings.to_string().replace('\'', "''");
        let sql = format!(
            "INSERT INTO \"providers\" (\"id\",\"app_type\",\"name\",\"settings_config\",\"meta\",\"is_current\",\"category\") VALUES ('newapi','codex','NewAPI','{escaped}','{{}}',1,'third_party');"
        );
        let encoded = {
            use base64::{engine::general_purpose::STANDARD, Engine as _};
            STANDARD.encode(sql)
        };

        let response = run_command(&[
            "import-export".to_string(),
            "preflight-sql-b64".to_string(),
            encoded,
            "sql-file".to_string(),
        ]);

        assert_eq!(response.get("ok").and_then(Value::as_bool), Some(true));
        assert_eq!(
            response
                .pointer("/data/hasBlockingRisks")
                .and_then(Value::as_bool),
            Some(true)
        );
    }

    #[test]
    fn auth_status_returns_remote_managed_auth_state() {
        let dir = tempfile::tempdir().expect("temp test home");
        let previous_home = std::env::var_os("CC_SWITCH_TEST_HOME");
        std::env::set_var("CC_SWITCH_TEST_HOME", dir.path());

        let response = run_command(&[
            "auth".to_string(),
            "status".to_string(),
            "github_copilot".to_string(),
        ]);

        match previous_home {
            Some(value) => std::env::set_var("CC_SWITCH_TEST_HOME", value),
            None => std::env::remove_var("CC_SWITCH_TEST_HOME"),
        }

        assert_eq!(response.get("ok").and_then(Value::as_bool), Some(true));
        assert_eq!(
            response
                .get("data")
                .and_then(|data| data.get("provider"))
                .and_then(Value::as_str),
            Some("github_copilot")
        );
        assert_eq!(
            response
                .get("data")
                .and_then(|data| data.get("authenticated"))
                .and_then(Value::as_bool),
            Some(false)
        );
    }

    #[test]
    fn usage_request_logs_rejects_invalid_pagination() {
        let args = vec![
            "usage".to_string(),
            "request-logs".to_string(),
            "{}".to_string(),
            "page".to_string(),
            "20".to_string(),
        ];

        let response = run_command(&args);

        assert_eq!(response.get("ok").and_then(Value::as_bool), Some(false));
        assert_eq!(
            response
                .get("error")
                .and_then(|error| error.get("code"))
                .and_then(Value::as_str),
            Some("usage_request_logs_failed")
        );
    }

    #[test]
    fn usage_sync_session_returns_stable_empty_result() {
        let dir = tempfile::tempdir().expect("temp test home");
        let previous_home = std::env::var_os("CC_SWITCH_TEST_HOME");
        let previous_xdg_data_home = std::env::var_os("XDG_DATA_HOME");
        let previous_opencode_db = std::env::var_os("OPENCODE_DB");
        let previous_disable_sync = std::env::var_os("CC_SWITCH_DISABLE_SESSION_SYNC_FOR_TESTS");
        std::env::set_var("CC_SWITCH_TEST_HOME", dir.path());
        std::env::set_var("XDG_DATA_HOME", dir.path().join("xdg-data"));
        std::env::set_var("OPENCODE_DB", dir.path().join("missing-opencode.db"));
        std::env::set_var("CC_SWITCH_DISABLE_SESSION_SYNC_FOR_TESTS", "1");

        let response = run_command(&["usage".to_string(), "sync-session".to_string()]);

        match previous_home {
            Some(value) => std::env::set_var("CC_SWITCH_TEST_HOME", value),
            None => std::env::remove_var("CC_SWITCH_TEST_HOME"),
        }
        match previous_xdg_data_home {
            Some(value) => std::env::set_var("XDG_DATA_HOME", value),
            None => std::env::remove_var("XDG_DATA_HOME"),
        }
        match previous_opencode_db {
            Some(value) => std::env::set_var("OPENCODE_DB", value),
            None => std::env::remove_var("OPENCODE_DB"),
        }
        match previous_disable_sync {
            Some(value) => std::env::set_var("CC_SWITCH_DISABLE_SESSION_SYNC_FOR_TESTS", value),
            None => std::env::remove_var("CC_SWITCH_DISABLE_SESSION_SYNC_FOR_TESTS"),
        }

        assert_eq!(response.get("ok").and_then(Value::as_bool), Some(true));
        assert_eq!(
            response
                .get("data")
                .and_then(|data| data.get("imported"))
                .and_then(Value::as_u64),
            Some(0)
        );
        assert!(response
            .get("data")
            .and_then(|data| data.get("errors"))
            .and_then(Value::as_array)
            .is_some());
    }
}

pub fn run_entry(args: &[String]) -> CliRunResult {
    if let Err(error) = crate::config::ensure_remote_app_config_dir_initialized() {
        return CliRunResult::Json(
            serde_json::to_value(types::err::<()>(
                "app_config_dir_init_failed",
                error.to_string(),
            ))
            .expect("serialize app config dir init error"),
        );
    }

    let args = normalize_args(args);
    if args == ["serve"] {
        return match serve::run_stdio() {
            Ok(()) => CliRunResult::Served,
            Err(error) => CliRunResult::Json(
                serde_json::to_value(types::err::<()>("serve_failed", error.to_string()))
                    .expect("serialize serve error"),
            ),
        };
    }
    CliRunResult::Json(run_command(&args))
}

fn normalize_args(args: &[String]) -> Vec<String> {
    args.iter()
        .filter(|arg| arg.as_str() != "--json")
        .cloned()
        .collect()
}

fn parse_bool_arg(value: &str) -> Result<bool, String> {
    match value.trim().to_ascii_lowercase().as_str() {
        "true" | "1" => Ok(true),
        "false" | "0" => Ok(false),
        _ => Err(format!("Invalid boolean value: {value}")),
    }
}

pub(crate) fn run_command(args: &[String]) -> Value {
    match args {
        [cmd] if cmd == "status" => serde_json::to_value(types::ok(commands::status_payload()))
            .expect("serialize status response"),
        [group, cmd, app] if group == "providers" && cmd == "list" => match app.parse() {
            Ok(app_type) => match commands::list_providers(app_type) {
                Ok(value) => serde_json::to_value(types::ok(value)).expect("serialize providers"),
                Err(message) => {
                    serde_json::to_value(types::err::<()>("providers_list_failed", message))
                        .expect("serialize provider error")
                }
            },
            Err(err) => serde_json::to_value(types::err::<()>("invalid_app", err.to_string()))
                .expect("serialize invalid app error"),
        },
        [group, cmd, app] if group == "providers" && cmd == "current" => match app.parse() {
            Ok(app_type) => match commands::current_provider(app_type) {
                Ok(value) => serde_json::to_value(types::ok(value)).expect("serialize current"),
                Err(message) => {
                    serde_json::to_value(types::err::<()>("providers_current_failed", message))
                        .expect("serialize provider current error")
                }
            },
            Err(err) => serde_json::to_value(types::err::<()>("invalid_app", err.to_string()))
                .expect("serialize invalid app error"),
        },
        [group, cmd, app] if group == "providers" && cmd == "state" => match app.parse() {
            Ok(app_type) => match commands::provider_state(app_type) {
                Ok(value) => serde_json::to_value(types::ok(value)).expect("serialize state"),
                Err(message) => {
                    serde_json::to_value(types::err::<()>("providers_state_failed", message))
                        .expect("serialize provider state error")
                }
            },
            Err(err) => serde_json::to_value(types::err::<()>("invalid_app", err.to_string()))
                .expect("serialize invalid app error"),
        },
        [group, cmd, app, id] if group == "providers" && cmd == "switch" => match app.parse() {
            Ok(app_type) => match commands::switch_provider(app_type, id) {
                Ok(value) => serde_json::to_value(types::ok(value)).expect("serialize switch"),
                Err(message) => {
                    serde_json::to_value(types::err::<()>("providers_switch_failed", message))
                        .expect("serialize provider switch error")
                }
            },
            Err(err) => serde_json::to_value(types::err::<()>("invalid_app", err.to_string()))
                .expect("serialize invalid app error"),
        },
        [group, cmd, app, provider_json, add_to_live] if group == "providers" && cmd == "add" => {
            match app.parse() {
                Ok(app_type) => {
                    let add_to_live = add_to_live != "false";
                    match commands::add_provider(app_type, provider_json, add_to_live) {
                        Ok(value) => serde_json::to_value(types::ok(value)).expect("serialize add"),
                        Err(message) => {
                            serde_json::to_value(types::err::<()>("providers_add_failed", message))
                                .expect("serialize provider add error")
                        }
                    }
                }
                Err(err) => serde_json::to_value(types::err::<()>("invalid_app", err.to_string()))
                    .expect("serialize invalid app error"),
            }
        }
        [group, cmd, app, provider_json, original_id]
            if group == "providers" && cmd == "update" =>
        {
            match app.parse() {
                Ok(app_type) => {
                    let original_id = if original_id == "-" {
                        None
                    } else {
                        Some(original_id.as_str())
                    };
                    match commands::update_provider(app_type, provider_json, original_id) {
                        Ok(value) => {
                            serde_json::to_value(types::ok(value)).expect("serialize update")
                        }
                        Err(message) => serde_json::to_value(types::err::<()>(
                            "providers_update_failed",
                            message,
                        ))
                        .expect("serialize provider update error"),
                    }
                }
                Err(err) => serde_json::to_value(types::err::<()>("invalid_app", err.to_string()))
                    .expect("serialize invalid app error"),
            }
        }
        [group, cmd, app, id] if group == "providers" && cmd == "delete" => match app.parse() {
            Ok(app_type) => match commands::delete_provider(app_type, id) {
                Ok(value) => serde_json::to_value(types::ok(value)).expect("serialize delete"),
                Err(message) => {
                    serde_json::to_value(types::err::<()>("providers_delete_failed", message))
                        .expect("serialize provider delete error")
                }
            },
            Err(err) => serde_json::to_value(types::err::<()>("invalid_app", err.to_string()))
                .expect("serialize invalid app error"),
        },
        [group, cmd, app, id] if group == "providers" && cmd == "remove-live" => match app.parse()
        {
            Ok(app_type) => match commands::remove_provider_from_live_config(app_type, id) {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize remove live")
                }
                Err(message) => serde_json::to_value(types::err::<()>(
                    "providers_remove_live_failed",
                    message,
                ))
                .expect("serialize provider remove live error"),
            },
            Err(err) => serde_json::to_value(types::err::<()>("invalid_app", err.to_string()))
                .expect("serialize invalid app error"),
        },
        [group, cmd, app] if group == "providers" && cmd == "live-ids" => match app.parse() {
            Ok(app_type) => match commands::live_provider_ids(app_type) {
                Ok(value) => serde_json::to_value(types::ok(value)).expect("serialize live ids"),
                Err(message) => {
                    serde_json::to_value(types::err::<()>("providers_live_ids_failed", message))
                        .expect("serialize provider live ids error")
                }
            },
            Err(err) => serde_json::to_value(types::err::<()>("invalid_app", err.to_string()))
                .expect("serialize invalid app error"),
        },
        [group, cmd, app, provider_id, options_json]
            if group == "providers" && cmd == "fetch-models" =>
        {
            match app.parse() {
                Ok(app_type) => {
                    match commands::fetch_models_for_provider(app_type, provider_id, options_json) {
                        Ok(value) => serde_json::to_value(types::ok(value))
                            .expect("serialize fetched models"),
                        Err(message) => serde_json::to_value(types::err::<()>(
                            "providers_fetch_models_failed",
                            message,
                        ))
                        .expect("serialize provider fetch models error"),
                    }
                }
                Err(err) => serde_json::to_value(types::err::<()>("invalid_app", err.to_string()))
                    .expect("serialize invalid app error"),
            }
        }
        [group, cmd, app] if group == "providers" && cmd == "import" => match app.parse() {
            Ok(app_type) => match commands::import_providers(app_type) {
                Ok(value) => serde_json::to_value(types::ok(value)).expect("serialize import"),
                Err(message) => {
                    serde_json::to_value(types::err::<()>("providers_import_failed", message))
                        .expect("serialize provider import error")
                }
            },
            Err(err) => serde_json::to_value(types::err::<()>("invalid_app", err.to_string()))
                .expect("serialize invalid app error"),
        },
        [group, cmd] if group == "import-export" && cmd == "export-sql" => {
            match commands::export_database_sql() {
                Ok(value) => serde_json::to_value(types::ok(value)).expect("serialize sql export"),
                Err(message) => {
                    serde_json::to_value(types::err::<()>("import_export_export_failed", message))
                        .expect("serialize sql export error")
                }
            }
        }
        [group, cmd, encoded_sql] if group == "import-export" && cmd == "import-sql-b64" => {
            match commands::import_database_sql_b64(encoded_sql) {
                Ok(value) => serde_json::to_value(types::ok(value)).expect("serialize sql import"),
                Err(message) => {
                    serde_json::to_value(types::err::<()>("import_export_import_failed", message))
                        .expect("serialize sql import error")
                }
            }
        }
        [group, cmd, encoded_sql, source]
            if group == "import-export" && cmd == "preflight-sql-b64" =>
        {
            let source = serde_json::from_str::<crate::remote_restore_preflight::SourceKind>(
                &format!("\"{source}\""),
            )
            .unwrap_or(crate::remote_restore_preflight::SourceKind::SqlFile);
            match commands::preflight_database_sql_b64(encoded_sql, source) {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize import preflight")
                }
                Err(message) => serde_json::to_value(types::err::<()>(
                    "import_export_preflight_failed",
                    message,
                ))
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
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize import with mode")
                }
                Err(message) => {
                    serde_json::to_value(types::err::<()>("import_export_import_failed", message))
                        .expect("serialize import with mode error")
                }
            }
        }
        [group, cmd] if group == "import-export" && cmd == "create-backup" => {
            match commands::create_database_backup() {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize backup create")
                }
                Err(message) => {
                    serde_json::to_value(types::err::<()>("backup_create_failed", message))
                        .expect("serialize backup create error")
                }
            }
        }
        [group, cmd] if group == "import-export" && cmd == "backups" => {
            match commands::list_database_backups() {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize backup list")
                }
                Err(message) => {
                    serde_json::to_value(types::err::<()>("backup_list_failed", message))
                        .expect("serialize backup list error")
                }
            }
        }
        [group, cmd, filename] if group == "import-export" && cmd == "restore-backup" => {
            match commands::restore_database_backup(filename) {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize backup restore")
                }
                Err(message) => {
                    serde_json::to_value(types::err::<()>("backup_restore_failed", message))
                        .expect("serialize backup restore error")
                }
            }
        }
        [group, cmd, old_filename, new_name]
            if group == "import-export" && cmd == "rename-backup" =>
        {
            match commands::rename_database_backup(old_filename, new_name) {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize backup rename")
                }
                Err(message) => {
                    serde_json::to_value(types::err::<()>("backup_rename_failed", message))
                        .expect("serialize backup rename error")
                }
            }
        }
        [group, cmd, filename] if group == "import-export" && cmd == "delete-backup" => {
            match commands::delete_database_backup(filename) {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize backup delete")
                }
                Err(message) => {
                    serde_json::to_value(types::err::<()>("backup_delete_failed", message))
                        .expect("serialize backup delete error")
                }
            }
        }
        [group, cmd, tools_json] if group == "tools" && cmd == "versions" => {
            match commands::tool_versions(tools_json) {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize tool versions")
                }
                Err(message) => {
                    serde_json::to_value(types::err::<()>("tools_versions_failed", message))
                        .expect("serialize tool versions error")
                }
            }
        }
        [group, cmd, action, tools_json] if group == "tools" && cmd == "run" => {
            match commands::run_tool_lifecycle_action(tools_json, action) {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize tool lifecycle")
                }
                Err(message) => {
                    serde_json::to_value(types::err::<()>("tools_lifecycle_failed", message))
                        .expect("serialize tool lifecycle error")
                }
            }
        }
        [group, cmd, tools_json] if group == "tools" && cmd == "probe-installations" => {
            match commands::probe_tool_installations(tools_json) {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize tool probe")
                }
                Err(message) => {
                    serde_json::to_value(types::err::<()>("tools_probe_failed", message))
                        .expect("serialize tool probe error")
                }
            }
        }
        [group, cmd, app, provider_id] if group == "stream-check" && cmd == "provider" => {
            match app.parse() {
                Ok(app_type) => match commands::stream_check_provider(app_type, provider_id) {
                    Ok(value) => {
                        serde_json::to_value(types::ok(value)).expect("serialize stream check")
                    }
                    Err(message) => {
                        serde_json::to_value(types::err::<()>("stream_check_failed", message))
                            .expect("serialize stream check error")
                    }
                },
                Err(err) => serde_json::to_value(types::err::<()>("invalid_app", err.to_string()))
                    .expect("serialize invalid app error"),
            }
        }
        [group, cmd] if group == "stream-check" && cmd == "config" => {
            match commands::get_stream_check_config() {
                Ok(value) => serde_json::to_value(types::ok(value))
                    .expect("serialize stream check config"),
                Err(message) => {
                    serde_json::to_value(types::err::<()>("stream_check_config_failed", message))
                        .expect("serialize stream check config error")
                }
            }
        }
        [group, cmd, config_json] if group == "stream-check" && cmd == "set-config" => {
            match commands::save_stream_check_config(config_json) {
                Ok(value) => serde_json::to_value(types::ok(value))
                    .expect("serialize stream check config save"),
                Err(message) => {
                    serde_json::to_value(types::err::<()>("stream_check_config_failed", message))
                        .expect("serialize stream check config save error")
                }
            }
        }
        [group, cmd, params_json] if group == "usage" && cmd == "summary" => {
            match commands::usage_summary(params_json) {
                Ok(value) => serde_json::to_value(types::ok(value)).expect("serialize usage summary"),
                Err(message) => serde_json::to_value(types::err::<()>("usage_summary_failed", message))
                    .expect("serialize usage summary error"),
            }
        }
        [group, cmd, params_json] if group == "usage" && cmd == "summary-by-app" => {
            match commands::usage_summary_by_app(params_json) {
                Ok(value) => serde_json::to_value(types::ok(value)).expect("serialize usage summary by app"),
                Err(message) => serde_json::to_value(types::err::<()>("usage_summary_by_app_failed", message))
                    .expect("serialize usage summary by app error"),
            }
        }
        [group, cmd, params_json] if group == "usage" && cmd == "trends" => {
            match commands::usage_trends(params_json) {
                Ok(value) => serde_json::to_value(types::ok(value)).expect("serialize usage trends"),
                Err(message) => serde_json::to_value(types::err::<()>("usage_trends_failed", message))
                    .expect("serialize usage trends error"),
            }
        }
        [group, cmd, params_json] if group == "usage" && cmd == "provider-stats" => {
            match commands::usage_provider_stats(params_json) {
                Ok(value) => serde_json::to_value(types::ok(value)).expect("serialize usage provider stats"),
                Err(message) => serde_json::to_value(types::err::<()>("usage_provider_stats_failed", message))
                    .expect("serialize usage provider stats error"),
            }
        }
        [group, cmd, params_json] if group == "usage" && cmd == "model-stats" => {
            match commands::usage_model_stats(params_json) {
                Ok(value) => serde_json::to_value(types::ok(value)).expect("serialize usage model stats"),
                Err(message) => serde_json::to_value(types::err::<()>("usage_model_stats_failed", message))
                    .expect("serialize usage model stats error"),
            }
        }
        [group, cmd, filters_json, page, page_size] if group == "usage" && cmd == "request-logs" => {
            match (page.parse::<u32>(), page_size.parse::<u32>()) {
                (Ok(page), Ok(page_size)) => match commands::usage_request_logs(filters_json, page, page_size) {
                    Ok(value) => serde_json::to_value(types::ok(value)).expect("serialize usage request logs"),
                    Err(message) => serde_json::to_value(types::err::<()>("usage_request_logs_failed", message))
                        .expect("serialize usage request logs error"),
                },
                _ => serde_json::to_value(types::err::<()>(
                    "usage_request_logs_failed",
                    "Invalid request log pagination arguments",
                ))
                .expect("serialize usage request logs pagination error"),
            }
        }
        [group, cmd, request_id] if group == "usage" && cmd == "request-detail" => {
            match commands::usage_request_detail(request_id) {
                Ok(value) => serde_json::to_value(types::ok(value)).expect("serialize usage request detail"),
                Err(message) => serde_json::to_value(types::err::<()>("usage_request_detail_failed", message))
                    .expect("serialize usage request detail error"),
            }
        }
        [group, cmd] if group == "usage" && cmd == "data-sources" => {
            match commands::usage_data_sources() {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize usage data sources")
                }
                Err(message) => {
                    serde_json::to_value(types::err::<()>("usage_data_sources_failed", message))
                        .expect("serialize usage data sources error")
                }
            }
        }
        [group, cmd] if group == "usage" && cmd == "sync-session" => {
            match commands::usage_sync_session() {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize usage session sync")
                }
                Err(message) => {
                    serde_json::to_value(types::err::<()>("usage_session_sync_failed", message))
                        .expect("serialize usage session sync error")
                }
            }
        }
        [group, cmd] if group == "usage" && cmd == "model-pricing" => {
            match commands::usage_model_pricing() {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize usage model pricing")
                }
                Err(message) => {
                    serde_json::to_value(types::err::<()>("usage_model_pricing_failed", message))
                        .expect("serialize usage model pricing error")
                }
            }
        }
        [group, cmd, model_id, display_name, input_cost, output_cost, cache_read_cost, cache_creation_cost]
            if group == "usage" && cmd == "update-model-pricing" =>
        {
            match commands::usage_update_model_pricing(
                model_id,
                display_name,
                input_cost,
                output_cost,
                cache_read_cost,
                cache_creation_cost,
            ) {
                Ok(value) => serde_json::to_value(types::ok(value))
                    .expect("serialize usage model pricing update"),
                Err(message) => serde_json::to_value(types::err::<()>(
                    "usage_model_pricing_update_failed",
                    message,
                ))
                .expect("serialize usage model pricing update error"),
            }
        }
        [group, cmd, model_id] if group == "usage" && cmd == "delete-model-pricing" => {
            match commands::usage_delete_model_pricing(model_id) {
                Ok(value) => serde_json::to_value(types::ok(value))
                    .expect("serialize usage model pricing delete"),
                Err(message) => serde_json::to_value(types::err::<()>(
                    "usage_model_pricing_delete_failed",
                    message,
                ))
                .expect("serialize usage model pricing delete error"),
            }
        }
        [group, cmd] if group == "settings" && cmd == "get" => {
            serde_json::to_value(types::ok(commands::get_settings())).expect("serialize settings")
        }
        [group, cmd] if group == "settings" && cmd == "app-config-dir" => {
            serde_json::to_value(types::ok(commands::get_app_config_dir()))
                .expect("serialize app config dir")
        }
        [group, cmd, path] if group == "settings" && cmd == "set-app-config-dir" => {
            match commands::set_app_config_dir(path) {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize app config dir save")
                }
                Err(message) => {
                    serde_json::to_value(types::err::<()>("app_config_dir_failed", message))
                        .expect("serialize app config dir error")
                }
            }
        }
        [group, cmd, settings_json] if group == "settings" && cmd == "save" => {
            match commands::save_settings(settings_json) {
                Ok(value) => serde_json::to_value(types::ok(value)).expect("serialize settings"),
                Err(message) => {
                    serde_json::to_value(types::err::<()>("settings_save_failed", message))
                        .expect("serialize settings error")
                }
            }
        }
        [group, cmd, auth_provider, github_domain]
            if group == "auth" && cmd == "start-login" =>
        {
            let github_domain = if github_domain == "-" {
                None
            } else {
                Some(github_domain.as_str())
            };
            match commands::auth_start_login(auth_provider, github_domain) {
                Ok(value) => serde_json::to_value(types::ok(value))
                    .expect("serialize auth start login"),
                Err(message) => serde_json::to_value(types::err::<()>(
                    "auth_start_login_failed",
                    message,
                ))
                .expect("serialize auth start login error"),
            }
        }
        [group, cmd, auth_provider, device_code, github_domain]
            if group == "auth" && cmd == "poll" =>
        {
            let github_domain = if github_domain == "-" {
                None
            } else {
                Some(github_domain.as_str())
            };
            match commands::auth_poll_for_account(auth_provider, device_code, github_domain) {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize auth poll")
                }
                Err(message) => {
                    serde_json::to_value(types::err::<()>("auth_poll_failed", message))
                        .expect("serialize auth poll error")
                }
            }
        }
        [group, cmd, auth_provider] if group == "auth" && cmd == "list" => {
            match commands::auth_list_accounts(auth_provider) {
                Ok(value) => serde_json::to_value(types::ok(value)).expect("serialize auth list"),
                Err(message) => {
                    serde_json::to_value(types::err::<()>("auth_list_failed", message))
                        .expect("serialize auth list error")
                }
            }
        }
        [group, cmd, auth_provider] if group == "auth" && cmd == "status" => {
            match commands::auth_get_status(auth_provider) {
                Ok(value) => serde_json::to_value(types::ok(value)).expect("serialize auth status"),
                Err(message) => {
                    serde_json::to_value(types::err::<()>("auth_status_failed", message))
                        .expect("serialize auth status error")
                }
            }
        }
        [group, cmd, auth_provider, account_id] if group == "auth" && cmd == "remove" => {
            match commands::auth_remove_account(auth_provider, account_id) {
                Ok(value) => serde_json::to_value(types::ok(value)).expect("serialize auth remove"),
                Err(message) => {
                    serde_json::to_value(types::err::<()>("auth_remove_failed", message))
                        .expect("serialize auth remove error")
                }
            }
        }
        [group, cmd, auth_provider, account_id] if group == "auth" && cmd == "set-default" => {
            match commands::auth_set_default_account(auth_provider, account_id) {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize auth default")
                }
                Err(message) => {
                    serde_json::to_value(types::err::<()>("auth_set_default_failed", message))
                        .expect("serialize auth default error")
                }
            }
        }
        [group, cmd, auth_provider] if group == "auth" && cmd == "logout" => {
            match commands::auth_logout(auth_provider) {
                Ok(value) => serde_json::to_value(types::ok(value)).expect("serialize auth logout"),
                Err(message) => {
                    serde_json::to_value(types::err::<()>("auth_logout_failed", message))
                        .expect("serialize auth logout error")
                }
            }
        }
        [group, cmd, settings_json, preserve] if group == "cloud-sync" && cmd == "webdav-test" => {
            match commands::webdav_test_connection(settings_json, preserve) {
                Ok(value) => serde_json::to_value(types::ok(value)).expect("serialize webdav test"),
                Err(message) => serde_json::to_value(types::err::<()>("webdav_test_failed", message))
                    .expect("serialize webdav test error"),
            }
        }
        [group, cmd, settings_json, password_touched]
            if group == "cloud-sync" && cmd == "webdav-save" =>
        {
            match commands::webdav_save_settings(settings_json, password_touched) {
                Ok(value) => serde_json::to_value(types::ok(value)).expect("serialize webdav save"),
                Err(message) => serde_json::to_value(types::err::<()>("webdav_save_failed", message))
                    .expect("serialize webdav save error"),
            }
        }
        [group, cmd] if group == "cloud-sync" && cmd == "webdav-upload" => {
            match commands::webdav_upload() {
                Ok(value) => serde_json::to_value(types::ok(value)).expect("serialize webdav upload"),
                Err(message) => serde_json::to_value(types::err::<()>("webdav_upload_failed", message))
                    .expect("serialize webdav upload error"),
            }
        }
        [group, cmd] if group == "cloud-sync" && cmd == "webdav-download" => {
            match commands::webdav_download() {
                Ok(value) => serde_json::to_value(types::ok(value)).expect("serialize webdav download"),
                Err(message) => serde_json::to_value(types::err::<()>("webdav_download_failed", message))
                    .expect("serialize webdav download error"),
            }
        }
        [group, cmd] if group == "cloud-sync" && cmd == "webdav-download-preflight" => {
            match commands::webdav_download_preflight() {
                Ok(value) => serde_json::to_value(types::ok(value))
                    .expect("serialize webdav download preflight"),
                Err(message) => serde_json::to_value(types::err::<()>(
                    "webdav_download_preflight_failed",
                    message,
                ))
                .expect("serialize webdav download preflight error"),
            }
        }
        [group, cmd, mode] if group == "cloud-sync" && cmd == "webdav-download-mode" => {
            let mode = serde_json::from_str::<crate::remote_restore_preflight::RestoreMode>(
                &format!("\"{mode}\""),
            )
            .unwrap_or(crate::remote_restore_preflight::RestoreMode::Exact);
            match commands::webdav_download_with_mode(mode) {
                Ok(value) => serde_json::to_value(types::ok(value))
                    .expect("serialize webdav download with mode"),
                Err(message) => serde_json::to_value(types::err::<()>(
                    "webdav_download_failed",
                    message,
                ))
                .expect("serialize webdav download with mode error"),
            }
        }
        [group, cmd] if group == "cloud-sync" && cmd == "webdav-remote-info" => {
            match commands::webdav_fetch_remote_info() {
                Ok(value) => serde_json::to_value(types::ok(value)).expect("serialize webdav remote info"),
                Err(message) => serde_json::to_value(types::err::<()>("webdav_remote_info_failed", message))
                    .expect("serialize webdav remote info error"),
            }
        }
        [group, cmd, settings_json, preserve] if group == "cloud-sync" && cmd == "s3-test" => {
            match commands::s3_test_connection(settings_json, preserve) {
                Ok(value) => serde_json::to_value(types::ok(value)).expect("serialize s3 test"),
                Err(message) => serde_json::to_value(types::err::<()>("s3_test_failed", message))
                    .expect("serialize s3 test error"),
            }
        }
        [group, cmd, settings_json, password_touched] if group == "cloud-sync" && cmd == "s3-save" => {
            match commands::s3_save_settings(settings_json, password_touched) {
                Ok(value) => serde_json::to_value(types::ok(value)).expect("serialize s3 save"),
                Err(message) => serde_json::to_value(types::err::<()>("s3_save_failed", message))
                    .expect("serialize s3 save error"),
            }
        }
        [group, cmd] if group == "cloud-sync" && cmd == "s3-upload" => {
            match commands::s3_upload() {
                Ok(value) => serde_json::to_value(types::ok(value)).expect("serialize s3 upload"),
                Err(message) => serde_json::to_value(types::err::<()>("s3_upload_failed", message))
                    .expect("serialize s3 upload error"),
            }
        }
        [group, cmd] if group == "cloud-sync" && cmd == "s3-download" => {
            match commands::s3_download() {
                Ok(value) => serde_json::to_value(types::ok(value)).expect("serialize s3 download"),
                Err(message) => serde_json::to_value(types::err::<()>("s3_download_failed", message))
                    .expect("serialize s3 download error"),
            }
        }
        [group, cmd] if group == "cloud-sync" && cmd == "s3-download-preflight" => {
            match commands::s3_download_preflight() {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize s3 download preflight")
                }
                Err(message) => serde_json::to_value(types::err::<()>(
                    "s3_download_preflight_failed",
                    message,
                ))
                .expect("serialize s3 download preflight error"),
            }
        }
        [group, cmd, mode] if group == "cloud-sync" && cmd == "s3-download-mode" => {
            let mode = serde_json::from_str::<crate::remote_restore_preflight::RestoreMode>(
                &format!("\"{mode}\""),
            )
            .unwrap_or(crate::remote_restore_preflight::RestoreMode::Exact);
            match commands::s3_download_with_mode(mode) {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize s3 download with mode")
                }
                Err(message) => {
                    serde_json::to_value(types::err::<()>("s3_download_failed", message))
                        .expect("serialize s3 download with mode error")
                }
            }
        }
        [group, cmd] if group == "cloud-sync" && cmd == "s3-remote-info" => {
            match commands::s3_fetch_remote_info() {
                Ok(value) => serde_json::to_value(types::ok(value)).expect("serialize s3 remote info"),
                Err(message) => serde_json::to_value(types::err::<()>("s3_remote_info_failed", message))
                    .expect("serialize s3 remote info error"),
            }
        }
        [group, cmd] if group == "settings" && cmd == "log-config" => {
            match commands::get_log_config() {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize log config")
                }
                Err(message) => {
                    serde_json::to_value(types::err::<()>("log_config_failed", message))
                        .expect("serialize log config error")
                }
            }
        }
        [group, cmd, config_json] if group == "settings" && cmd == "set-log-config" => {
            match commands::save_log_config(config_json) {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize log config save")
                }
                Err(message) => {
                    serde_json::to_value(types::err::<()>("log_config_failed", message))
                        .expect("serialize log config save error")
                }
            }
        }
        [group, cmd, target] if group == "skills" && cmd == "migrate-storage" => {
            match commands::migrate_skill_storage(target) {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize skill migration")
                }
                Err(message) => {
                    serde_json::to_value(types::err::<()>("skill_migration_failed", message))
                        .expect("serialize skill migration error")
                }
            }
        }
        [group, cmd, official] if group == "plugin" && cmd == "apply-claude" => {
            match commands::apply_claude_plugin_config(official) {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize plugin apply")
                }
                Err(message) => {
                    serde_json::to_value(types::err::<()>("plugin_apply_failed", message))
                        .expect("serialize plugin apply error")
                }
            }
        }
        [group, cmd, enabled] if group == "plugin" && cmd == "onboarding-skip" => {
            match commands::set_claude_onboarding_skip(enabled) {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize plugin onboarding")
                }
                Err(message) => {
                    serde_json::to_value(types::err::<()>("plugin_onboarding_failed", message))
                        .expect("serialize plugin onboarding error")
                }
            }
        }
        [group, cmd, app, updates_json] if group == "providers" && cmd == "sort" => {
            match app.parse() {
                Ok(app_type) => match commands::sort_providers(app_type, updates_json) {
                    Ok(value) => serde_json::to_value(types::ok(value)).expect("serialize sort"),
                    Err(message) => {
                        serde_json::to_value(types::err::<()>("providers_sort_failed", message))
                            .expect("serialize provider sort error")
                    }
                },
                Err(err) => serde_json::to_value(types::err::<()>("invalid_app", err.to_string()))
                    .expect("serialize invalid app error"),
            }
        }
        [group, cmd] if group == "universal-providers" && cmd == "list" => {
            match commands::list_universal_providers() {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize universal providers")
                }
                Err(message) => serde_json::to_value(types::err::<()>(
                    "universal_providers_list_failed",
                    message,
                ))
                .expect("serialize universal provider error"),
            }
        }
        [group, cmd, id] if group == "universal-providers" && cmd == "get" => {
            match commands::get_universal_provider(id) {
                Ok(value) => serde_json::to_value(types::ok(value))
                    .expect("serialize universal provider"),
                Err(message) => serde_json::to_value(types::err::<()>(
                    "universal_providers_get_failed",
                    message,
                ))
                .expect("serialize universal provider error"),
            }
        }
        [group, cmd, provider_json] if group == "universal-providers" && cmd == "upsert" => {
            match commands::upsert_universal_provider(provider_json) {
                Ok(value) => serde_json::to_value(types::ok(value))
                    .expect("serialize universal provider upsert"),
                Err(message) => serde_json::to_value(types::err::<()>(
                    "universal_providers_upsert_failed",
                    message,
                ))
                .expect("serialize universal provider upsert error"),
            }
        }
        [group, cmd, id] if group == "universal-providers" && cmd == "delete" => {
            match commands::delete_universal_provider(id) {
                Ok(value) => serde_json::to_value(types::ok(value))
                    .expect("serialize universal provider delete"),
                Err(message) => serde_json::to_value(types::err::<()>(
                    "universal_providers_delete_failed",
                    message,
                ))
                .expect("serialize universal provider delete error"),
            }
        }
        [group, cmd, id] if group == "universal-providers" && cmd == "sync" => {
            match commands::sync_universal_provider(id) {
                Ok(value) => serde_json::to_value(types::ok(value))
                    .expect("serialize universal provider sync"),
                Err(message) => serde_json::to_value(types::err::<()>(
                    "universal_providers_sync_failed",
                    message,
                ))
                .expect("serialize universal provider sync error"),
            }
        }
        [group, cmd] if group == "routing-config" && cmd == "global" => {
            match commands::get_routing_global_config() {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize routing global config")
                }
                Err(message) => {
                    serde_json::to_value(types::err::<()>("routing_global_get_failed", message))
                        .expect("serialize routing global config error")
                }
            }
        }
        [group, cmd, config_json] if group == "routing-config" && cmd == "set-global" => {
            match commands::update_routing_global_config(config_json) {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize routing global update")
                }
                Err(message) => {
                    serde_json::to_value(types::err::<()>("routing_global_set_failed", message))
                        .expect("serialize routing global update error")
                }
            }
        }
        [group, cmd, app_type] if group == "routing-config" && cmd == "app" => {
            match commands::get_routing_app_config(app_type) {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize routing app config")
                }
                Err(message) => {
                    serde_json::to_value(types::err::<()>("routing_app_get_failed", message))
                        .expect("serialize routing app config error")
                }
            }
        }
        [group, cmd, app_type] if group == "routing-config" && cmd == "default-cost-multiplier" => {
            match commands::get_default_cost_multiplier(app_type) {
                Ok(value) => serde_json::to_value(types::ok(value))
                    .expect("serialize default cost multiplier"),
                Err(message) => serde_json::to_value(types::err::<()>(
                    "routing_default_cost_multiplier_get_failed",
                    message,
                ))
                .expect("serialize default cost multiplier error"),
            }
        }
        [group, cmd, app_type, value]
            if group == "routing-config" && cmd == "set-default-cost-multiplier" =>
        {
            match commands::set_default_cost_multiplier(app_type, value) {
                Ok(value) => serde_json::to_value(types::ok(value))
                    .expect("serialize default cost multiplier update"),
                Err(message) => serde_json::to_value(types::err::<()>(
                    "routing_default_cost_multiplier_set_failed",
                    message,
                ))
                .expect("serialize default cost multiplier update error"),
            }
        }
        [group, cmd, app_type] if group == "routing-config" && cmd == "pricing-model-source" => {
            match commands::get_pricing_model_source(app_type) {
                Ok(value) => serde_json::to_value(types::ok(value))
                    .expect("serialize pricing model source"),
                Err(message) => serde_json::to_value(types::err::<()>(
                    "routing_pricing_model_source_get_failed",
                    message,
                ))
                .expect("serialize pricing model source error"),
            }
        }
        [group, cmd, app_type, value]
            if group == "routing-config" && cmd == "set-pricing-model-source" =>
        {
            match commands::set_pricing_model_source(app_type, value) {
                Ok(value) => serde_json::to_value(types::ok(value))
                    .expect("serialize pricing model source update"),
                Err(message) => serde_json::to_value(types::err::<()>(
                    "routing_pricing_model_source_set_failed",
                    message,
                ))
                .expect("serialize pricing model source update error"),
            }
        }
        [group, cmd, app_type] if group == "routing-config" && cmd == "failover-queue" => {
            match commands::get_routing_failover_queue(app_type) {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize failover queue")
                }
                Err(message) => {
                    serde_json::to_value(types::err::<()>("routing_failover_queue_failed", message))
                        .expect("serialize failover queue error")
                }
            }
        }
        [group, cmd, app_type]
            if group == "routing-config" && cmd == "available-failover-providers" =>
        {
            match commands::get_routing_available_failover_providers(app_type) {
                Ok(value) => serde_json::to_value(types::ok(value))
                    .expect("serialize available failover providers"),
                Err(message) => serde_json::to_value(types::err::<()>(
                    "routing_available_failover_providers_failed",
                    message,
                ))
                .expect("serialize available failover providers error"),
            }
        }
        [group, cmd, app_type, provider_id]
            if group == "routing-config" && cmd == "add-failover-provider" =>
        {
            match commands::add_routing_failover_queue(app_type, provider_id) {
                Ok(value) => serde_json::to_value(types::ok(value))
                    .expect("serialize failover queue add"),
                Err(message) => serde_json::to_value(types::err::<()>(
                    "routing_failover_queue_add_failed",
                    message,
                ))
                .expect("serialize failover queue add error"),
            }
        }
        [group, cmd, app_type, provider_id]
            if group == "routing-config" && cmd == "remove-failover-provider" =>
        {
            match commands::remove_routing_failover_queue(app_type, provider_id) {
                Ok(value) => serde_json::to_value(types::ok(value))
                    .expect("serialize failover queue remove"),
                Err(message) => serde_json::to_value(types::err::<()>(
                    "routing_failover_queue_remove_failed",
                    message,
                ))
                .expect("serialize failover queue remove error"),
            }
        }
        [group, cmd, app_type] if group == "routing-config" && cmd == "auto-failover" => {
            match commands::get_routing_auto_failover_enabled(app_type) {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize auto failover")
                }
                Err(message) => {
                    serde_json::to_value(types::err::<()>("routing_auto_failover_failed", message))
                        .expect("serialize auto failover error")
                }
            }
        }
        [group, cmd, app_type, enabled]
            if group == "routing-config" && cmd == "set-auto-failover" =>
        {
            match parse_bool_arg(enabled)
                .and_then(|value| commands::set_routing_auto_failover_enabled(app_type, value))
            {
                Ok(value) => serde_json::to_value(types::ok(value))
                    .expect("serialize auto failover set"),
                Err(message) => serde_json::to_value(types::err::<()>(
                    "routing_auto_failover_set_failed",
                    message,
                ))
                .expect("serialize auto failover set error"),
            }
        }
        [group, cmd, config_json] if group == "routing-config" && cmd == "set-app" => {
            match commands::update_routing_app_config(config_json) {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize routing app update")
                }
                Err(message) => {
                    serde_json::to_value(types::err::<()>("routing_app_set_failed", message))
                        .expect("serialize routing app update error")
                }
            }
        }
        [group, cmd, app_type, provider_id]
            if group == "routing-config" && cmd == "provider-health" =>
        {
            match commands::get_routing_provider_health(app_type, provider_id) {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize provider health")
                }
                Err(message) => {
                    serde_json::to_value(types::err::<()>("routing_provider_health_failed", message))
                        .expect("serialize provider health error")
                }
            }
        }
        [group, cmd, app_type, provider_id]
            if group == "routing-config" && cmd == "reset-circuit-breaker" =>
        {
            match commands::reset_routing_circuit_breaker(app_type, provider_id) {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize circuit breaker reset")
                }
                Err(message) => serde_json::to_value(types::err::<()>(
                    "routing_circuit_breaker_reset_failed",
                    message,
                ))
                .expect("serialize circuit breaker reset error"),
            }
        }
        [group, cmd] if group == "routing-config" && cmd == "circuit-breaker" => {
            match commands::get_routing_circuit_breaker_config() {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize circuit breaker config")
                }
                Err(message) => serde_json::to_value(types::err::<()>(
                    "routing_circuit_breaker_get_failed",
                    message,
                ))
                .expect("serialize circuit breaker config error"),
            }
        }
        [group, cmd, config_json] if group == "routing-config" && cmd == "set-circuit-breaker" => {
            match commands::update_routing_circuit_breaker_config(config_json) {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize circuit breaker update")
                }
                Err(message) => serde_json::to_value(types::err::<()>(
                    "routing_circuit_breaker_set_failed",
                    message,
                ))
                .expect("serialize circuit breaker update error"),
            }
        }
        [group, cmd, app_type, provider_id]
            if group == "routing-config" && cmd == "circuit-breaker-stats" =>
        {
            match commands::get_routing_circuit_breaker_stats(app_type, provider_id) {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize circuit breaker stats")
                }
                Err(message) => serde_json::to_value(types::err::<()>(
                    "routing_circuit_breaker_stats_failed",
                    message,
                ))
                .expect("serialize circuit breaker stats error"),
            }
        }
        [group, cmd] if group == "routing-config" && cmd == "rectifier" => {
            match commands::get_routing_rectifier_config() {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize rectifier config")
                }
                Err(message) => {
                    serde_json::to_value(types::err::<()>("routing_rectifier_get_failed", message))
                        .expect("serialize rectifier config error")
                }
            }
        }
        [group, cmd, config_json] if group == "routing-config" && cmd == "set-rectifier" => {
            match commands::set_routing_rectifier_config(config_json) {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize rectifier update")
                }
                Err(message) => {
                    serde_json::to_value(types::err::<()>("routing_rectifier_set_failed", message))
                        .expect("serialize rectifier update error")
                }
            }
        }
        [group, cmd] if group == "routing-config" && cmd == "optimizer" => {
            match commands::get_routing_optimizer_config() {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize optimizer config")
                }
                Err(message) => {
                    serde_json::to_value(types::err::<()>("routing_optimizer_get_failed", message))
                        .expect("serialize optimizer config error")
                }
            }
        }
        [group, cmd, config_json] if group == "routing-config" && cmd == "set-optimizer" => {
            match commands::set_routing_optimizer_config(config_json) {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize optimizer update")
                }
                Err(message) => {
                    serde_json::to_value(types::err::<()>("routing_optimizer_set_failed", message))
                        .expect("serialize optimizer update error")
                }
            }
        }
        [group, cmd] if group == "routing-config" && cmd == "global-outbound" => {
            match commands::get_routing_global_outbound_proxy() {
                Ok(value) => serde_json::to_value(types::ok(value))
                    .expect("serialize outbound proxy config"),
                Err(message) => serde_json::to_value(types::err::<()>(
                    "routing_global_outbound_get_failed",
                    message,
                ))
                .expect("serialize outbound proxy config error"),
            }
        }
        [group, cmd, url] if group == "routing-config" && cmd == "set-global-outbound" => {
            match commands::set_routing_global_outbound_proxy(url) {
                Ok(value) => serde_json::to_value(types::ok(value))
                    .expect("serialize outbound proxy update"),
                Err(message) => serde_json::to_value(types::err::<()>(
                    "routing_global_outbound_set_failed",
                    message,
                ))
                .expect("serialize outbound proxy update error"),
            }
        }
        [group, cmd] if group == "routing-runtime" && cmd == "status" => {
            match commands::routing_runtime_status() {
                Ok(value) => serde_json::to_value(types::ok(value))
                    .expect("serialize routing runtime status"),
                Err(message) => serde_json::to_value(types::err::<()>(
                    "routing_runtime_status_failed",
                    message,
                ))
                .expect("serialize routing runtime status error"),
            }
        }
        [group, cmd] if group == "routing-runtime" && cmd == "start" => {
            match commands::routing_runtime_start() {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize routing runtime start")
                }
                Err(message) => serde_json::to_value(types::err::<()>(
                    "routing_runtime_start_failed",
                    message,
                ))
                .expect("serialize routing runtime start error"),
            }
        }
        [group, cmd] if group == "routing-runtime" && cmd == "stop" => {
            match commands::routing_runtime_stop() {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize routing runtime stop")
                }
                Err(message) => serde_json::to_value(types::err::<()>(
                    "routing_runtime_stop_failed",
                    message,
                ))
                .expect("serialize routing runtime stop error"),
            }
        }
        [group, cmd] if group == "sessions" && cmd == "list" => match commands::list_sessions() {
            Ok(value) => serde_json::to_value(types::ok(value)).expect("serialize sessions"),
            Err(message) => serde_json::to_value(types::err::<()>("sessions_list_failed", message))
                .expect("serialize sessions error"),
        },
        [group, cmd, provider_id, source_path] if group == "sessions" && cmd == "messages" => {
            match commands::session_messages(provider_id, source_path) {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize session messages")
                }
                Err(message) => serde_json::to_value(types::err::<()>(
                    "sessions_messages_failed",
                    message,
                ))
                .expect("serialize session messages error"),
            }
        }
        [group, cmd, provider_id, session_id, source_path]
            if group == "sessions" && cmd == "delete" =>
        {
            match commands::delete_session(provider_id, session_id, source_path) {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize session delete")
                }
                Err(message) => serde_json::to_value(types::err::<()>(
                    "sessions_delete_failed",
                    message,
                ))
                .expect("serialize session delete error"),
            }
        }
        [group, cmd, items_json] if group == "sessions" && cmd == "delete-many" => {
            match commands::delete_sessions(items_json) {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize session delete many")
                }
                Err(message) => serde_json::to_value(types::err::<()>(
                    "sessions_delete_many_failed",
                    message,
                ))
                .expect("serialize session delete many error"),
            }
        }
        [group, scope, cmd, kind] if group == "hermes" && scope == "memory" && cmd == "get" => {
            match commands::get_hermes_memory(kind) {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize hermes memory")
                }
                Err(message) => serde_json::to_value(types::err::<()>(
                    "hermes_memory_get_failed",
                    message,
                ))
                .expect("serialize hermes memory error"),
            }
        }
        [group, scope, cmd, kind, content]
            if group == "hermes" && scope == "memory" && cmd == "set" =>
        {
            match commands::set_hermes_memory(kind, content) {
                Ok(value) => serde_json::to_value(types::ok(value))
                    .expect("serialize hermes memory write"),
                Err(message) => serde_json::to_value(types::err::<()>(
                    "hermes_memory_set_failed",
                    message,
                ))
                .expect("serialize hermes memory write error"),
            }
        }
        [group, scope, cmd] if group == "hermes" && scope == "memory" && cmd == "limits" => {
            match commands::get_hermes_memory_limits() {
                Ok(value) => serde_json::to_value(types::ok(value))
                    .expect("serialize hermes memory limits"),
                Err(message) => serde_json::to_value(types::err::<()>(
                    "hermes_memory_limits_failed",
                    message,
                ))
                .expect("serialize hermes memory limits error"),
            }
        }
        [group, scope, cmd] if group == "hermes" && scope == "model" && cmd == "get" => {
            match commands::get_hermes_model_config() {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize hermes model")
                }
                Err(message) => {
                    serde_json::to_value(types::err::<()>("hermes_model_get_failed", message))
                        .expect("serialize hermes model error")
                }
            }
        }
        [group, scope, cmd, kind, enabled]
            if group == "hermes" && scope == "memory" && cmd == "enabled" =>
        {
            let enabled = enabled == "true";
            match commands::set_hermes_memory_enabled(kind, enabled) {
                Ok(value) => serde_json::to_value(types::ok(value))
                    .expect("serialize hermes memory enabled"),
                Err(message) => serde_json::to_value(types::err::<()>(
                    "hermes_memory_enabled_failed",
                    message,
                ))
                .expect("serialize hermes memory enabled error"),
            }
        }
        [group, cmd] if group == "openclaw" && cmd == "get-default-model" => {
            match commands::get_openclaw_default_model() {
                Ok(value) => serde_json::to_value(types::ok(value))
                    .expect("serialize openclaw default model"),
                Err(message) => serde_json::to_value(types::err::<()>(
                    "openclaw_get_default_model_failed",
                    message,
                ))
                .expect("serialize openclaw default model error"),
            }
        }
        [group, cmd, model_json] if group == "openclaw" && cmd == "set-default-model" => {
            match commands::set_openclaw_default_model(model_json) {
                Ok(value) => serde_json::to_value(types::ok(value))
                    .expect("serialize openclaw default model"),
                Err(message) => serde_json::to_value(types::err::<()>(
                    "openclaw_set_default_model_failed",
                    message,
                ))
                .expect("serialize openclaw default model error"),
            }
        }
        [group, cmd] if group == "openclaw" && cmd == "get-env" => {
            match commands::get_openclaw_env() {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize openclaw env")
                }
                Err(message) => {
                    serde_json::to_value(types::err::<()>("openclaw_get_env_failed", message))
                        .expect("serialize openclaw env error")
                }
            }
        }
        [group, cmd, env_json] if group == "openclaw" && cmd == "set-env" => {
            match commands::set_openclaw_env(env_json) {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize openclaw env")
                }
                Err(message) => {
                    serde_json::to_value(types::err::<()>("openclaw_set_env_failed", message))
                        .expect("serialize openclaw env error")
                }
            }
        }
        [group, cmd] if group == "openclaw" && cmd == "get-tools" => {
            match commands::get_openclaw_tools() {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize openclaw tools")
                }
                Err(message) => {
                    serde_json::to_value(types::err::<()>("openclaw_get_tools_failed", message))
                        .expect("serialize openclaw tools error")
                }
            }
        }
        [group, cmd, tools_json] if group == "openclaw" && cmd == "set-tools" => {
            match commands::set_openclaw_tools(tools_json) {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize openclaw tools")
                }
                Err(message) => {
                    serde_json::to_value(types::err::<()>("openclaw_set_tools_failed", message))
                        .expect("serialize openclaw tools error")
                }
            }
        }
        [group, cmd] if group == "openclaw" && cmd == "get-agents-defaults" => {
            match commands::get_openclaw_agents_defaults() {
                Ok(value) => serde_json::to_value(types::ok(value))
                    .expect("serialize openclaw agents defaults"),
                Err(message) => serde_json::to_value(types::err::<()>(
                    "openclaw_get_agents_defaults_failed",
                    message,
                ))
                .expect("serialize openclaw agents defaults error"),
            }
        }
        [group, cmd, defaults_json] if group == "openclaw" && cmd == "set-agents-defaults" => {
            match commands::set_openclaw_agents_defaults(defaults_json) {
                Ok(value) => serde_json::to_value(types::ok(value))
                    .expect("serialize openclaw agents defaults"),
                Err(message) => serde_json::to_value(types::err::<()>(
                    "openclaw_set_agents_defaults_failed",
                    message,
                ))
                .expect("serialize openclaw agents defaults error"),
            }
        }
        [group, cmd] if group == "openclaw" && cmd == "scan-health" => {
            match commands::scan_openclaw_health() {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize openclaw health")
                }
                Err(message) => {
                    serde_json::to_value(types::err::<()>("openclaw_scan_health_failed", message))
                        .expect("serialize openclaw health error")
                }
            }
        }
        [group, cmd] if group == "mcp" && cmd == "list" => match commands::list_mcp_servers() {
            Ok(value) => serde_json::to_value(types::ok(value)).expect("serialize mcp list"),
            Err(message) => serde_json::to_value(types::err::<()>("mcp_list_failed", message))
                .expect("serialize mcp list error"),
        },
        [group, cmd, server_json] if group == "mcp" && cmd == "upsert" => {
            match commands::upsert_mcp_server(server_json) {
                Ok(value) => serde_json::to_value(types::ok(value)).expect("serialize mcp upsert"),
                Err(message) => {
                    serde_json::to_value(types::err::<()>("mcp_upsert_failed", message))
                        .expect("serialize mcp upsert error")
                }
            }
        }
        [group, cmd, id] if group == "mcp" && cmd == "delete" => {
            match commands::delete_mcp_server(id) {
                Ok(value) => serde_json::to_value(types::ok(value)).expect("serialize mcp delete"),
                Err(message) => {
                    serde_json::to_value(types::err::<()>("mcp_delete_failed", message))
                        .expect("serialize mcp delete error")
                }
            }
        }
        [group, cmd, server_id, app, enabled] if group == "mcp" && cmd == "toggle" => {
            match app.parse() {
                Ok(app_type) => {
                    let enabled = enabled == "true";
                    match commands::toggle_mcp_app(server_id, app_type, enabled) {
                        Ok(value) => {
                            serde_json::to_value(types::ok(value)).expect("serialize mcp toggle")
                        }
                        Err(message) => {
                            serde_json::to_value(types::err::<()>("mcp_toggle_failed", message))
                                .expect("serialize mcp toggle error")
                        }
                    }
                }
                Err(err) => serde_json::to_value(types::err::<()>("invalid_app", err.to_string()))
                    .expect("serialize invalid app error"),
            }
        }
        [group, cmd] if group == "mcp" && cmd == "import" => {
            match commands::import_mcp_from_apps() {
                Ok(value) => serde_json::to_value(types::ok(value)).expect("serialize mcp import"),
                Err(message) => {
                    serde_json::to_value(types::err::<()>("mcp_import_failed", message))
                        .expect("serialize mcp import error")
                }
            }
        }
        [group, cmd, app] if group == "prompts" && cmd == "list" => match app.parse() {
            Ok(app_type) => match commands::list_prompts(app_type) {
                Ok(value) => serde_json::to_value(types::ok(value)).expect("serialize prompts"),
                Err(message) => {
                    serde_json::to_value(types::err::<()>("prompts_list_failed", message))
                        .expect("serialize prompts error")
                }
            },
            Err(err) => serde_json::to_value(types::err::<()>("invalid_app", err.to_string()))
                .expect("serialize invalid app error"),
        },
        [group, cmd, app, id, prompt_json] if group == "prompts" && cmd == "upsert" => {
            match app.parse() {
                Ok(app_type) => match commands::upsert_prompt(app_type, id, prompt_json) {
                    Ok(value) => {
                        serde_json::to_value(types::ok(value)).expect("serialize prompt upsert")
                    }
                    Err(message) => {
                        serde_json::to_value(types::err::<()>("prompt_upsert_failed", message))
                            .expect("serialize prompt upsert error")
                    }
                },
                Err(err) => serde_json::to_value(types::err::<()>("invalid_app", err.to_string()))
                    .expect("serialize invalid app error"),
            }
        }
        [group, cmd, app, id] if group == "prompts" && cmd == "delete" => match app.parse() {
            Ok(app_type) => match commands::delete_prompt(app_type, id) {
                Ok(value) => serde_json::to_value(types::ok(value)).expect("serialize delete"),
                Err(message) => {
                    serde_json::to_value(types::err::<()>("prompt_delete_failed", message))
                        .expect("serialize prompt delete error")
                }
            },
            Err(err) => serde_json::to_value(types::err::<()>("invalid_app", err.to_string()))
                .expect("serialize invalid app error"),
        },
        [group, cmd, app, id] if group == "prompts" && cmd == "enable" => match app.parse() {
            Ok(app_type) => match commands::enable_prompt(app_type, id) {
                Ok(value) => serde_json::to_value(types::ok(value)).expect("serialize enable"),
                Err(message) => {
                    serde_json::to_value(types::err::<()>("prompt_enable_failed", message))
                        .expect("serialize prompt enable error")
                }
            },
            Err(err) => serde_json::to_value(types::err::<()>("invalid_app", err.to_string()))
                .expect("serialize invalid app error"),
        },
        [group, cmd, app] if group == "prompts" && cmd == "import" => match app.parse() {
            Ok(app_type) => match commands::import_prompt_from_file(app_type) {
                Ok(value) => serde_json::to_value(types::ok(value)).expect("serialize import"),
                Err(message) => {
                    serde_json::to_value(types::err::<()>("prompt_import_failed", message))
                        .expect("serialize prompt import error")
                }
            },
            Err(err) => serde_json::to_value(types::err::<()>("invalid_app", err.to_string()))
                .expect("serialize invalid app error"),
        },
        [group, cmd, app] if group == "prompts" && cmd == "current" => match app.parse() {
            Ok(app_type) => match commands::current_prompt_file_content(app_type) {
                Ok(value) => serde_json::to_value(types::ok(value)).expect("serialize current"),
                Err(message) => {
                    serde_json::to_value(types::err::<()>("prompt_current_failed", message))
                        .expect("serialize prompt current error")
                }
            },
            Err(err) => serde_json::to_value(types::err::<()>("invalid_app", err.to_string()))
                .expect("serialize invalid app error"),
        },
        [group, cmd] if group == "skills" && cmd == "installed" => {
            match commands::list_installed_skills() {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize skills installed")
                }
                Err(message) => {
                    serde_json::to_value(types::err::<()>("skills_installed_failed", message))
                        .expect("serialize skills installed error")
                }
            }
        }
        [group, cmd] if group == "skills" && cmd == "backups" => {
            match commands::list_skill_backups() {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize skill backups")
                }
                Err(message) => {
                    serde_json::to_value(types::err::<()>("skill_backups_failed", message))
                        .expect("serialize skill backups error")
                }
            }
        }
        [group, cmd, backup_id] if group == "skills" && cmd == "delete-backup" => {
            match commands::delete_skill_backup(backup_id) {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize delete backup")
                }
                Err(message) => {
                    serde_json::to_value(types::err::<()>("skill_delete_backup_failed", message))
                        .expect("serialize delete backup error")
                }
            }
        }
        [group, cmd, skill_json, current_app] if group == "skills" && cmd == "install" => {
            match current_app.parse() {
                Ok(app_type) => match commands::install_skill_unified(skill_json, app_type) {
                    Ok(value) => {
                        serde_json::to_value(types::ok(value)).expect("serialize skill install")
                    }
                    Err(message) => {
                        serde_json::to_value(types::err::<()>("skill_install_failed", message))
                            .expect("serialize skill install error")
                    }
                },
                Err(err) => serde_json::to_value(types::err::<()>("invalid_app", err.to_string()))
                    .expect("serialize invalid app error"),
            }
        }
        [group, cmd, id] if group == "skills" && cmd == "uninstall" => {
            match commands::uninstall_skill_unified(id) {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize skill uninstall")
                }
                Err(message) => {
                    serde_json::to_value(types::err::<()>("skill_uninstall_failed", message))
                        .expect("serialize skill uninstall error")
                }
            }
        }
        [group, cmd, backup_id, current_app] if group == "skills" && cmd == "restore" => {
            match current_app.parse() {
                Ok(app_type) => match commands::restore_skill_backup(backup_id, app_type) {
                    Ok(value) => {
                        serde_json::to_value(types::ok(value)).expect("serialize skill restore")
                    }
                    Err(message) => {
                        serde_json::to_value(types::err::<()>("skill_restore_failed", message))
                            .expect("serialize skill restore error")
                    }
                },
                Err(err) => serde_json::to_value(types::err::<()>("invalid_app", err.to_string()))
                    .expect("serialize invalid app error"),
            }
        }
        [group, cmd, id, app, enabled] if group == "skills" && cmd == "toggle" => {
            match app.parse() {
                Ok(app_type) => {
                    let enabled = enabled == "true";
                    match commands::toggle_skill_app(id, app_type, enabled) {
                        Ok(value) => {
                            serde_json::to_value(types::ok(value)).expect("serialize skill toggle")
                        }
                        Err(message) => {
                            serde_json::to_value(types::err::<()>("skill_toggle_failed", message))
                                .expect("serialize skill toggle error")
                        }
                    }
                }
                Err(err) => serde_json::to_value(types::err::<()>("invalid_app", err.to_string()))
                    .expect("serialize invalid app error"),
            }
        }
        [group, cmd] if group == "skills" && cmd == "scan-unmanaged" => {
            match commands::scan_unmanaged_skills() {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize unmanaged skills")
                }
                Err(message) => {
                    serde_json::to_value(types::err::<()>("skill_scan_failed", message))
                        .expect("serialize unmanaged skills error")
                }
            }
        }
        [group, cmd, imports_json] if group == "skills" && cmd == "import" => {
            match commands::import_skills_from_apps(imports_json) {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize skill import")
                }
                Err(message) => {
                    serde_json::to_value(types::err::<()>("skill_import_failed", message))
                        .expect("serialize skill import error")
                }
            }
        }
        [group, cmd] if group == "skills" && cmd == "discover" => {
            match commands::discover_available_skills() {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize skill discover")
                }
                Err(message) => {
                    serde_json::to_value(types::err::<()>("skill_discover_failed", message))
                        .expect("serialize skill discover error")
                }
            }
        }
        [group, cmd] if group == "skills" && cmd == "check-updates" => {
            match commands::check_skill_updates() {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize skill updates")
                }
                Err(message) => {
                    serde_json::to_value(types::err::<()>("skill_check_updates_failed", message))
                        .expect("serialize skill updates error")
                }
            }
        }
        [group, cmd, id] if group == "skills" && cmd == "update" => {
            match commands::update_skill(id) {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize skill update")
                }
                Err(message) => {
                    serde_json::to_value(types::err::<()>("skill_update_failed", message))
                        .expect("serialize skill update error")
                }
            }
        }
        [group, cmd] if group == "skills" && cmd == "repos" => match commands::list_skill_repos() {
            Ok(value) => serde_json::to_value(types::ok(value)).expect("serialize skill repos"),
            Err(message) => serde_json::to_value(types::err::<()>("skill_repos_failed", message))
                .expect("serialize skill repos error"),
        },
        [group, cmd, repo_json] if group == "skills" && cmd == "add-repo" => {
            match commands::add_skill_repo(repo_json) {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize skill add repo")
                }
                Err(message) => {
                    serde_json::to_value(types::err::<()>("skill_add_repo_failed", message))
                        .expect("serialize skill add repo error")
                }
            }
        }
        [group, cmd, owner, name] if group == "skills" && cmd == "remove-repo" => {
            match commands::remove_skill_repo(owner, name) {
                Ok(value) => {
                    serde_json::to_value(types::ok(value)).expect("serialize skill remove repo")
                }
                Err(message) => {
                    serde_json::to_value(types::err::<()>("skill_remove_repo_failed", message))
                        .expect("serialize skill remove repo error")
                }
            }
        }
        _ => serde_json::to_value(types::err::<()>(
            "unsupported_command",
            "Supported commands: status, providers, universal-providers, routing-config, routing-runtime, sessions, hermes, openclaw, mcp, prompts, skills, import-export, cloud-sync, tools, settings, plugin, stream-check, usage, auth",
        ))
        .expect("serialize error response"),
    }
}
