#![cfg(feature = "desktop")]

use serial_test::serial;
use std::path::Path;
use std::sync::OnceLock;

fn cli_test_home() -> &'static Path {
    static CLI_TEST_HOME: OnceLock<tempfile::TempDir> = OnceLock::new();
    CLI_TEST_HOME
        .get_or_init(|| tempfile::tempdir().expect("cli test home"))
        .path()
}

fn with_temp_home<T>(run: impl FnOnce() -> T) -> T {
    let old_test_home = std::env::var_os("CC_SWITCH_TEST_HOME");
    let old_home = std::env::var_os("HOME");
    let test_home = cli_test_home();
    std::env::set_var("CC_SWITCH_TEST_HOME", test_home);
    std::env::set_var("HOME", test_home);

    let result = run();

    match old_test_home {
        Some(value) => std::env::set_var("CC_SWITCH_TEST_HOME", value),
        None => std::env::remove_var("CC_SWITCH_TEST_HOME"),
    }
    match old_home {
        Some(value) => std::env::set_var("HOME", value),
        None => std::env::remove_var("HOME"),
    }

    result
}

#[test]
#[serial]
fn status_returns_stable_json_envelope() {
    let response = cc_switch_lib::cli::run(&["status".to_string()]);

    assert_eq!(response["ok"], true);
    assert_eq!(response["data"]["version"], env!("CARGO_PKG_VERSION"));
    assert_eq!(response["data"]["platform"], std::env::consts::OS);
    assert_eq!(
        response["data"]["capabilities"],
        serde_json::json!(cc_switch_lib::remote_capabilities::REMOTE_HELPER_CAPABILITIES)
    );
    assert!(response["error"].is_null());
}

#[test]
#[serial]
fn status_advertises_session_capability() {
    let response = cc_switch_lib::cli::run(&["status".to_string()]);
    let capabilities = response
        .get("data")
        .and_then(|data| data.get("capabilities"))
        .and_then(|value| value.as_array())
        .expect("status capabilities");

    assert!(
        capabilities
            .iter()
            .any(|value| value.as_str() == Some("session")),
        "remote helper status must advertise persistent session support"
    );
}

#[test]
#[serial]
fn settings_round_trip_through_json_cli() {
    let (save_response, get_response) = with_temp_home(|| {
        let settings_json = serde_json::json!({
            "showInTray": true,
            "minimizeToTrayOnClose": true,
            "useAppWindowControls": false,
            "enableClaudePluginIntegration": true,
            "skipClaudeOnboarding": true,
            "launchOnStartup": false,
            "silentStartup": false,
            "enableLocalProxy": false,
            "enableRemoteRoutingToggle": true,
            "enableRemoteFailoverToggle": true,
            "visibleApps": {
                "claude": true,
                "claude-desktop": false,
                "codex": true,
                "gemini": false,
                "opencode": true,
                "openclaw": true,
                "hermes": true
            },
            "skillSyncMethod": "auto",
            "skillStorageLocation": "unified"
        })
        .to_string();

        let save_response =
            cc_switch_lib::cli::run(&["settings".to_string(), "save".to_string(), settings_json]);
        let get_response = cc_switch_lib::cli::run(&["settings".to_string(), "get".to_string()]);
        (save_response, get_response)
    });

    assert_eq!(save_response["ok"], true);
    assert!(save_response["error"].is_null());
    assert_eq!(get_response["ok"], true);
    assert_eq!(get_response["data"]["visibleApps"]["claude-desktop"], false);
    assert_eq!(get_response["data"]["visibleApps"]["hermes"], true);
    assert_eq!(get_response["data"]["enableRemoteRoutingToggle"], true);
    assert_eq!(get_response["data"]["enableRemoteFailoverToggle"], true);
    assert_eq!(get_response["data"]["skillStorageLocation"], "unified");
    assert_eq!(get_response["data"]["enableClaudePluginIntegration"], true);
    assert_eq!(get_response["data"]["skipClaudeOnboarding"], true);
}

#[test]
#[serial]
fn settings_app_config_dir_override_round_trips_through_json_cli() {
    let (default_response, set_response, get_response, clear_response, cleared_response) =
        with_temp_home(|| {
            let override_dir = cli_test_home().join("remote-data-dir");
            let override_dir = override_dir.to_string_lossy().to_string();

            let default_response =
                cc_switch_lib::cli::run(&["settings".to_string(), "app-config-dir".to_string()]);
            let set_response = cc_switch_lib::cli::run(&[
                "settings".to_string(),
                "set-app-config-dir".to_string(),
                override_dir,
            ]);
            let get_response =
                cc_switch_lib::cli::run(&["settings".to_string(), "app-config-dir".to_string()]);
            let clear_response = cc_switch_lib::cli::run(&[
                "settings".to_string(),
                "set-app-config-dir".to_string(),
                "-".to_string(),
            ]);
            let cleared_response =
                cc_switch_lib::cli::run(&["settings".to_string(), "app-config-dir".to_string()]);

            (
                default_response,
                set_response,
                get_response,
                clear_response,
                cleared_response,
            )
        });

    assert_eq!(default_response["ok"], true);
    assert!(default_response["data"]
        .as_str()
        .expect("default app config dir")
        .ends_with(".cc-switch-remote"));
    assert_eq!(set_response["ok"], true);
    assert_eq!(set_response["data"], true);
    assert!(
        cli_test_home().join("remote-data-dir").exists(),
        "setting a remote app config dir should create the remote directory"
    );
    assert_eq!(get_response["ok"], true);
    assert!(get_response["data"]
        .as_str()
        .expect("overridden app config dir")
        .ends_with("remote-data-dir"));
    assert_eq!(clear_response["ok"], true);
    assert_eq!(clear_response["data"], true);
    assert_eq!(cleared_response["ok"], true);
    assert!(cleared_response["data"]
        .as_str()
        .expect("cleared app config dir")
        .ends_with(".cc-switch-remote"));
}

#[test]
#[serial]
fn cloud_sync_settings_round_trip_through_json_cli() {
    let (webdav_save, webdav_preserve, s3_save, s3_preserve, webdav_password, s3_secret) =
        with_temp_home(|| {
            let webdav_settings = serde_json::json!({
                "enabled": true,
                "autoSync": false,
                "baseUrl": "https://dav.example.com/dav/",
                "username": "webdav-user",
                "password": "webdav-secret",
                "remoteRoot": "cc-switch-sync",
                "profile": "default"
            })
            .to_string();
            let webdav_save = cc_switch_lib::cli::run(&[
                "cloud-sync".to_string(),
                "webdav-save".to_string(),
                webdav_settings,
                "true".to_string(),
            ]);

            let webdav_without_password = serde_json::json!({
                "enabled": true,
                "autoSync": false,
                "baseUrl": "https://dav.example.com/dav/",
                "username": "webdav-user",
                "password": "",
                "remoteRoot": "cc-switch-sync",
                "profile": "default"
            })
            .to_string();
            let webdav_preserve = cc_switch_lib::cli::run(&[
                "cloud-sync".to_string(),
                "webdav-save".to_string(),
                webdav_without_password,
                "false".to_string(),
            ]);

            let s3_settings = serde_json::json!({
                "enabled": true,
                "autoSync": false,
                "region": "us-east-1",
                "bucket": "cc-switch",
                "accessKeyId": "s3-ak",
                "secretAccessKey": "s3-secret",
                "remoteRoot": "cc-switch-sync",
                "profile": "default"
            })
            .to_string();
            let s3_save = cc_switch_lib::cli::run(&[
                "cloud-sync".to_string(),
                "s3-save".to_string(),
                s3_settings,
                "true".to_string(),
            ]);

            let s3_without_secret = serde_json::json!({
                "enabled": true,
                "autoSync": false,
                "region": "us-east-1",
                "bucket": "cc-switch",
                "accessKeyId": "s3-ak",
                "secretAccessKey": "",
                "remoteRoot": "cc-switch-sync",
                "profile": "default"
            })
            .to_string();
            let s3_preserve = cc_switch_lib::cli::run(&[
                "cloud-sync".to_string(),
                "s3-save".to_string(),
                s3_without_secret,
                "false".to_string(),
            ]);

            let settings_path = cli_test_home().join(".cc-switch").join("settings.json");
            let settings_file = std::fs::read_to_string(settings_path).expect("settings file");
            let settings_json: serde_json::Value =
                serde_json::from_str(&settings_file).expect("settings json");
            let webdav_password = settings_json["webdavSync"]["password"]
                .as_str()
                .expect("webdav password")
                .to_string();
            let s3_secret = settings_json["s3Sync"]["secretAccessKey"]
                .as_str()
                .expect("s3 secret")
                .to_string();

            (
                webdav_save,
                webdav_preserve,
                s3_save,
                s3_preserve,
                webdav_password,
                s3_secret,
            )
        });

    assert_eq!(webdav_save["ok"], true);
    assert_eq!(webdav_preserve["ok"], true);
    assert_eq!(s3_save["ok"], true);
    assert_eq!(s3_preserve["ok"], true);
    assert_eq!(webdav_password, "webdav-secret");
    assert_eq!(s3_secret, "s3-secret");
}

#[test]
#[serial]
fn stream_check_config_round_trip_through_json_cli() {
    let (save_response, get_response) = with_temp_home(|| {
        let config_json = serde_json::json!({
            "timeoutSecs": 12,
            "maxRetries": 3,
            "degradedThresholdMs": 9000
        })
        .to_string();

        let save_response = cc_switch_lib::cli::run(&[
            "stream-check".to_string(),
            "set-config".to_string(),
            config_json,
        ]);
        let get_response =
            cc_switch_lib::cli::run(&["stream-check".to_string(), "config".to_string()]);
        (save_response, get_response)
    });

    assert_eq!(save_response["ok"], true, "save_response={save_response:?}");
    assert!(save_response["error"].is_null());
    assert_eq!(get_response["ok"], true, "get_response={get_response:?}");
    assert_eq!(get_response["data"]["timeoutSecs"], 12);
    assert_eq!(get_response["data"]["maxRetries"], 3);
    assert_eq!(get_response["data"]["degradedThresholdMs"], 9000);
}

#[test]
#[serial]
fn log_config_round_trip_through_json_cli() {
    let (save_response, get_response) = with_temp_home(|| {
        let config_json = serde_json::json!({
            "enabled": false,
            "level": "debug"
        })
        .to_string();

        let save_response = cc_switch_lib::cli::run(&[
            "settings".to_string(),
            "set-log-config".to_string(),
            config_json,
        ]);
        let get_response =
            cc_switch_lib::cli::run(&["settings".to_string(), "log-config".to_string()]);
        (save_response, get_response)
    });

    assert_eq!(save_response["ok"], true, "save_response={save_response:?}");
    assert!(save_response["error"].is_null());
    assert_eq!(get_response["ok"], true, "get_response={get_response:?}");
    assert_eq!(get_response["data"]["enabled"], false);
    assert_eq!(get_response["data"]["level"], "debug");
}

#[test]
#[serial]
fn routing_circuit_breaker_commands_round_trip_through_json_cli() {
    let (
        add_provider_response,
        set_response,
        get_response,
        health_response,
        reset_response,
        stats_response,
    ) = with_temp_home(|| {
        let config_json = serde_json::json!({
            "failureThreshold": 6,
            "successThreshold": 3,
            "timeoutSeconds": 90,
            "errorRateThreshold": 0.7,
            "minRequests": 12
        })
        .to_string();
        let provider_json = serde_json::json!({
                "id": "provider-a",
                "name": "Provider A",
                "settingsConfig": {
                    "auth": { "OPENAI_API_KEY": "sk-test" },
                    "config": "model_provider = \"test\"\nmodel = \"gpt-5\"\n\n[model_providers.test]\nname = \"Test\"\nbase_url = \"https://example.com/v1\"\nwire_api = \"responses\"\nrequires_openai_auth = true\n"
                }
            })
            .to_string();

        let add_provider_response = cc_switch_lib::cli::run(&[
            "providers".to_string(),
            "add".to_string(),
            "codex".to_string(),
            provider_json,
            "false".to_string(),
        ]);
        let set_response = cc_switch_lib::cli::run(&[
            "routing-config".to_string(),
            "set-circuit-breaker".to_string(),
            config_json,
        ]);
        let get_response =
            cc_switch_lib::cli::run(&["routing-config".to_string(), "circuit-breaker".to_string()]);
        let health_response = cc_switch_lib::cli::run(&[
            "routing-config".to_string(),
            "provider-health".to_string(),
            "codex".to_string(),
            "provider-a".to_string(),
        ]);
        let reset_response = cc_switch_lib::cli::run(&[
            "routing-config".to_string(),
            "reset-circuit-breaker".to_string(),
            "codex".to_string(),
            "provider-a".to_string(),
        ]);
        let stats_response = cc_switch_lib::cli::run(&[
            "routing-config".to_string(),
            "circuit-breaker-stats".to_string(),
            "codex".to_string(),
            "provider-a".to_string(),
        ]);

        (
            add_provider_response,
            set_response,
            get_response,
            health_response,
            reset_response,
            stats_response,
        )
    });

    assert_eq!(
        add_provider_response["ok"], true,
        "add_provider_response={add_provider_response:?}"
    );
    assert_eq!(set_response["ok"], true);
    assert!(set_response["error"].is_null());
    assert_eq!(get_response["ok"], true);
    assert_eq!(get_response["data"]["failureThreshold"], 6);
    assert_eq!(get_response["data"]["successThreshold"], 3);
    assert_eq!(get_response["data"]["timeoutSeconds"], 90);
    assert_eq!(health_response["ok"], true);
    assert_eq!(health_response["data"]["provider_id"], "provider-a");
    assert_eq!(health_response["data"]["app_type"], "codex");
    assert_eq!(health_response["data"]["is_healthy"], true);
    assert_eq!(
        reset_response["ok"], true,
        "reset_response={reset_response:?}"
    );
    assert!(reset_response["data"].is_null());
    assert_eq!(stats_response["ok"], true);
    assert!(stats_response["error"].is_null());
}

#[test]
#[serial]
fn routing_config_commands_round_trip_through_json_cli() {
    let (
        add_provider_response,
        set_global_response,
        get_global_response,
        set_app_response,
        get_app_response,
        available_response,
        add_queue_response,
        queue_after_add_response,
        auto_failover_response,
        set_auto_failover_response,
        remove_queue_response,
        queue_after_remove_response,
        set_rectifier_response,
        get_rectifier_response,
        set_optimizer_response,
        get_optimizer_response,
        set_outbound_response,
        get_outbound_response,
        clear_outbound_response,
        get_cleared_outbound_response,
        runtime_status_response,
    ) = with_temp_home(|| {
        let provider_json = serde_json::json!({
            "id": "provider-b",
            "name": "Provider B",
            "settingsConfig": {
                "auth": { "OPENAI_API_KEY": "sk-test" },
                "config": "model_provider = \"test\"\nmodel = \"gpt-5\"\n\n[model_providers.test]\nname = \"Test\"\nbase_url = \"https://example.com/v1\"\nwire_api = \"responses\"\nrequires_openai_auth = true\n"
            },
            "sortIndex": 7
        })
        .to_string();
        let global_json = serde_json::json!({
            "proxyEnabled": false,
            "listenAddress": "127.0.0.1",
            "listenPort": 15722,
            "enableLogging": false
        })
        .to_string();
        let app_json = serde_json::json!({
            "appType": "codex",
            "enabled": false,
            "autoFailoverEnabled": false,
            "maxRetries": 5,
            "streamingFirstByteTimeout": 45,
            "streamingIdleTimeout": 150,
            "nonStreamingTimeout": 650,
            "circuitFailureThreshold": 8,
            "circuitSuccessThreshold": 3,
            "circuitTimeoutSeconds": 75,
            "circuitErrorRateThreshold": 0.55,
            "circuitMinRequests": 11
        })
        .to_string();
        let rectifier_json = serde_json::json!({
            "enabled": false,
            "requestThinkingSignature": true,
            "requestThinkingBudget": false,
            "requestMediaFallback": true,
            "requestMediaHeuristic": false
        })
        .to_string();
        let optimizer_json = serde_json::json!({
            "enabled": true,
            "thinkingOptimizer": false,
            "cacheInjection": true
        })
        .to_string();

        let add_provider_response = cc_switch_lib::cli::run(&[
            "providers".to_string(),
            "add".to_string(),
            "codex".to_string(),
            provider_json,
            "false".to_string(),
        ]);
        let set_global_response = cc_switch_lib::cli::run(&[
            "routing-config".to_string(),
            "set-global".to_string(),
            global_json,
        ]);
        let get_global_response =
            cc_switch_lib::cli::run(&["routing-config".to_string(), "global".to_string()]);
        let set_app_response = cc_switch_lib::cli::run(&[
            "routing-config".to_string(),
            "set-app".to_string(),
            app_json,
        ]);
        let get_app_response = cc_switch_lib::cli::run(&[
            "routing-config".to_string(),
            "app".to_string(),
            "codex".to_string(),
        ]);
        let available_response = cc_switch_lib::cli::run(&[
            "routing-config".to_string(),
            "available-failover-providers".to_string(),
            "codex".to_string(),
        ]);
        let add_queue_response = cc_switch_lib::cli::run(&[
            "routing-config".to_string(),
            "add-failover-provider".to_string(),
            "codex".to_string(),
            "provider-b".to_string(),
        ]);
        let queue_after_add_response = cc_switch_lib::cli::run(&[
            "routing-config".to_string(),
            "failover-queue".to_string(),
            "codex".to_string(),
        ]);
        let auto_failover_response = cc_switch_lib::cli::run(&[
            "routing-config".to_string(),
            "auto-failover".to_string(),
            "codex".to_string(),
        ]);
        let set_auto_failover_response = cc_switch_lib::cli::run(&[
            "routing-config".to_string(),
            "set-auto-failover".to_string(),
            "codex".to_string(),
            "false".to_string(),
        ]);
        let remove_queue_response = cc_switch_lib::cli::run(&[
            "routing-config".to_string(),
            "remove-failover-provider".to_string(),
            "codex".to_string(),
            "provider-b".to_string(),
        ]);
        let queue_after_remove_response = cc_switch_lib::cli::run(&[
            "routing-config".to_string(),
            "failover-queue".to_string(),
            "codex".to_string(),
        ]);
        let set_rectifier_response = cc_switch_lib::cli::run(&[
            "routing-config".to_string(),
            "set-rectifier".to_string(),
            rectifier_json,
        ]);
        let get_rectifier_response =
            cc_switch_lib::cli::run(&["routing-config".to_string(), "rectifier".to_string()]);
        let set_optimizer_response = cc_switch_lib::cli::run(&[
            "routing-config".to_string(),
            "set-optimizer".to_string(),
            optimizer_json,
        ]);
        let get_optimizer_response =
            cc_switch_lib::cli::run(&["routing-config".to_string(), "optimizer".to_string()]);
        let set_outbound_response = cc_switch_lib::cli::run(&[
            "routing-config".to_string(),
            "set-global-outbound".to_string(),
            "socks5://127.0.0.1:1080".to_string(),
        ]);
        let get_outbound_response =
            cc_switch_lib::cli::run(&["routing-config".to_string(), "global-outbound".to_string()]);
        let clear_outbound_response = cc_switch_lib::cli::run(&[
            "routing-config".to_string(),
            "set-global-outbound".to_string(),
            "-".to_string(),
        ]);
        let get_cleared_outbound_response =
            cc_switch_lib::cli::run(&["routing-config".to_string(), "global-outbound".to_string()]);
        let runtime_status_response =
            cc_switch_lib::cli::run(&["routing-runtime".to_string(), "status".to_string()]);

        (
            add_provider_response,
            set_global_response,
            get_global_response,
            set_app_response,
            get_app_response,
            available_response,
            add_queue_response,
            queue_after_add_response,
            auto_failover_response,
            set_auto_failover_response,
            remove_queue_response,
            queue_after_remove_response,
            set_rectifier_response,
            get_rectifier_response,
            set_optimizer_response,
            get_optimizer_response,
            set_outbound_response,
            get_outbound_response,
            clear_outbound_response,
            get_cleared_outbound_response,
            runtime_status_response,
        )
    });

    assert_eq!(add_provider_response["ok"], true);
    assert_eq!(set_global_response["ok"], true);
    assert_eq!(get_global_response["ok"], true);
    assert_eq!(get_global_response["data"]["listenPort"], 15722);
    assert_eq!(get_global_response["data"]["enableLogging"], false);
    assert_eq!(
        set_app_response["ok"], true,
        "set_app_response={set_app_response:?}"
    );
    assert_eq!(get_app_response["ok"], true);
    assert_eq!(get_app_response["data"]["appType"], "codex");
    assert_eq!(get_app_response["data"]["maxRetries"], 5);
    assert_eq!(get_app_response["data"]["streamingIdleTimeout"], 150);
    assert_eq!(available_response["ok"], true);
    assert_eq!(available_response["data"][0]["id"], "provider-b");
    assert_eq!(add_queue_response["ok"], true);
    assert!(add_queue_response["data"].is_null());
    assert_eq!(queue_after_add_response["ok"], true);
    assert_eq!(
        queue_after_add_response["data"][0]["providerId"],
        "provider-b"
    );
    assert_eq!(auto_failover_response["ok"], true);
    assert_eq!(auto_failover_response["data"], false);
    assert_eq!(set_auto_failover_response["ok"], true);
    assert!(set_auto_failover_response["data"].is_null());
    assert_eq!(remove_queue_response["ok"], true);
    assert!(remove_queue_response["data"].is_null());
    assert_eq!(queue_after_remove_response["ok"], true);
    assert_eq!(queue_after_remove_response["data"], serde_json::json!([]));
    assert_eq!(set_rectifier_response["ok"], true);
    assert_eq!(get_rectifier_response["ok"], true);
    assert_eq!(get_rectifier_response["data"]["enabled"], false);
    assert_eq!(
        get_rectifier_response["data"]["requestThinkingBudget"],
        false
    );
    assert_eq!(set_optimizer_response["ok"], true);
    assert_eq!(get_optimizer_response["ok"], true);
    assert_eq!(get_optimizer_response["data"]["enabled"], true);
    assert_eq!(get_optimizer_response["data"]["thinkingOptimizer"], false);
    assert_eq!(get_optimizer_response["data"]["cacheInjection"], true);
    assert_eq!(set_outbound_response["ok"], true);
    assert_eq!(get_outbound_response["ok"], true);
    assert_eq!(get_outbound_response["data"], "socks5://127.0.0.1:1080");
    assert_eq!(clear_outbound_response["ok"], true);
    assert_eq!(get_cleared_outbound_response["ok"], true);
    assert!(get_cleared_outbound_response["data"].is_null());
    assert_eq!(runtime_status_response["ok"], true);
    assert!(runtime_status_response["data"]["running"].is_boolean());
}

#[test]
#[serial]
fn saved_invalid_global_outbound_proxy_is_cleared_on_cli_startup() {
    let (status_response, get_response) = with_temp_home(|| {
        let db = cc_switch_lib::Database::init().expect("init db");
        db.set_global_proxy_url(Some("http://127.0.0.1:99999"))
            .expect("seed invalid outbound proxy");

        let status_response = cc_switch_lib::cli::run(&["status".to_string()]);
        let get_response =
            cc_switch_lib::cli::run(&["routing-config".to_string(), "global-outbound".to_string()]);

        (status_response, get_response)
    });

    assert_eq!(status_response["ok"], true);
    assert_eq!(get_response["ok"], true);
    assert!(get_response["data"].is_null());
}

#[test]
#[serial]
fn routing_runtime_stop_clears_enabled_app_routing_configs() {
    let (stop_response, claude_response, codex_response, gemini_response) = with_temp_home(|| {
        let db = cc_switch_lib::Database::init().expect("init db");
        let runtime = tokio::runtime::Runtime::new().expect("tokio runtime");
        runtime.block_on(async {
            for app_type in ["claude", "codex", "gemini"] {
                let mut config = db
                    .get_proxy_config_for_app(app_type)
                    .await
                    .expect("get app proxy config");
                config.enabled = true;
                db.update_proxy_config_for_app(config)
                    .await
                    .expect("mark app routing enabled");
            }
        });

        let stop_response =
            cc_switch_lib::cli::run(&["routing-runtime".to_string(), "stop".to_string()]);
        let claude_response = cc_switch_lib::cli::run(&[
            "routing-config".to_string(),
            "app".to_string(),
            "claude".to_string(),
        ]);
        let codex_response = cc_switch_lib::cli::run(&[
            "routing-config".to_string(),
            "app".to_string(),
            "codex".to_string(),
        ]);
        let gemini_response = cc_switch_lib::cli::run(&[
            "routing-config".to_string(),
            "app".to_string(),
            "gemini".to_string(),
        ]);

        (
            stop_response,
            claude_response,
            codex_response,
            gemini_response,
        )
    });

    assert_eq!(stop_response["ok"], true, "stop_response={stop_response:?}");
    assert_eq!(claude_response["data"]["enabled"], false);
    assert_eq!(codex_response["data"]["enabled"], false);
    assert_eq!(gemini_response["data"]["enabled"], false);
}

#[test]
#[serial]
fn status_accepts_json_flag_for_remote_invocation() {
    let response = cc_switch_lib::cli::run(&["--json".to_string(), "status".to_string()]);

    assert_eq!(response["ok"], true);
    assert_eq!(response["data"]["version"], env!("CARGO_PKG_VERSION"));
    assert!(response["error"].is_null());
}

#[test]
#[serial]
fn openclaw_default_model_round_trips_through_json_cli() {
    let (set_response, get_response) = with_temp_home(|| {
        let model_json =
            r#"{"primary":"provider-1/gpt-4.1","fallbacks":["provider-1/gpt-4.1-mini"]}"#;
        let set_response = cc_switch_lib::cli::run(&[
            "openclaw".to_string(),
            "set-default-model".to_string(),
            model_json.to_string(),
        ]);
        let get_response =
            cc_switch_lib::cli::run(&["openclaw".to_string(), "get-default-model".to_string()]);
        (set_response, get_response)
    });

    assert_eq!(set_response["ok"], true);
    assert!(set_response["error"].is_null());
    assert_eq!(get_response["ok"], true);
    assert_eq!(get_response["data"]["primary"], "provider-1/gpt-4.1");
    assert_eq!(
        get_response["data"]["fallbacks"],
        serde_json::json!(["provider-1/gpt-4.1-mini"])
    );
}

#[test]
#[serial]
fn openclaw_sections_round_trip_through_json_cli() {
    let (set_env, get_env, set_tools, get_tools, set_agents, get_agents) = with_temp_home(|| {
        let env_json = r#"{"vars":{"NODE_ENV":"remote"}}"#;
        let tools_json = r#"{"profile":"coding","allow":["Bash(*)"]}"#;
        let agents_json = r#"{"workspace":"~/remote","timeoutSeconds":300}"#;

        let set_env = cc_switch_lib::cli::run(&[
            "openclaw".to_string(),
            "set-env".to_string(),
            env_json.to_string(),
        ]);
        let get_env = cc_switch_lib::cli::run(&["openclaw".to_string(), "get-env".to_string()]);
        let set_tools = cc_switch_lib::cli::run(&[
            "openclaw".to_string(),
            "set-tools".to_string(),
            tools_json.to_string(),
        ]);
        let get_tools = cc_switch_lib::cli::run(&["openclaw".to_string(), "get-tools".to_string()]);
        let set_agents = cc_switch_lib::cli::run(&[
            "openclaw".to_string(),
            "set-agents-defaults".to_string(),
            agents_json.to_string(),
        ]);
        let get_agents =
            cc_switch_lib::cli::run(&["openclaw".to_string(), "get-agents-defaults".to_string()]);
        (
            set_env, get_env, set_tools, get_tools, set_agents, get_agents,
        )
    });

    assert_eq!(set_env["ok"], true);
    assert_eq!(get_env["ok"], true);
    assert_eq!(get_env["data"]["vars"]["NODE_ENV"], "remote");
    assert_eq!(set_tools["ok"], true);
    assert_eq!(get_tools["ok"], true);
    assert_eq!(get_tools["data"]["profile"], "coding");
    assert_eq!(get_tools["data"]["allow"], serde_json::json!(["Bash(*)"]));
    assert_eq!(set_agents["ok"], true);
    assert_eq!(get_agents["ok"], true);
    assert_eq!(get_agents["data"]["workspace"], "~/remote");
    assert_eq!(get_agents["data"]["timeoutSeconds"], 300);
}

#[test]
#[serial]
fn hermes_memory_round_trips_through_json_cli() {
    let (set_response, get_response, limits_response) = with_temp_home(|| {
        let set_response = cc_switch_lib::cli::run(&[
            "hermes".to_string(),
            "memory".to_string(),
            "set".to_string(),
            "memory".to_string(),
            "remote helper memory".to_string(),
        ]);
        let get_response = cc_switch_lib::cli::run(&[
            "hermes".to_string(),
            "memory".to_string(),
            "get".to_string(),
            "memory".to_string(),
        ]);
        let limits_response = cc_switch_lib::cli::run(&[
            "hermes".to_string(),
            "memory".to_string(),
            "limits".to_string(),
        ]);
        (set_response, get_response, limits_response)
    });

    assert_eq!(set_response["ok"], true);
    assert!(set_response["error"].is_null());
    assert_eq!(get_response["ok"], true);
    assert_eq!(get_response["data"], "remote helper memory");
    assert_eq!(limits_response["ok"], true);
    assert_eq!(limits_response["data"]["memory"], 2200);
}

#[test]
#[serial]
fn providers_import_returns_stable_json_envelope() {
    let response = with_temp_home(|| {
        cc_switch_lib::cli::run(&[
            "providers".to_string(),
            "import".to_string(),
            "claude".to_string(),
        ])
    });

    assert_eq!(response["ok"], true);
    assert!(response["error"].is_null());
    assert_eq!(response["data"], false);
}

#[test]
#[serial]
fn providers_sort_returns_stable_json_envelope() {
    let response = with_temp_home(|| {
        cc_switch_lib::cli::run(&[
            "providers".to_string(),
            "sort".to_string(),
            "claude".to_string(),
            r#"[{"id":"provider-a","sortIndex":0}]"#.to_string(),
        ])
    });

    assert_eq!(response["ok"], true);
    assert!(response["error"].is_null());
    assert_eq!(response["data"], true);
}

#[test]
#[serial]
fn providers_update_preserves_existing_secret_when_payload_contains_redacted_sentinel() {
    let (list_response, update_response, stored_token) = with_temp_home(|| {
        let add_response = cc_switch_lib::cli::run(&[
            "providers".to_string(),
            "add".to_string(),
            "claude".to_string(),
            r#"{"id":"remote-provider","name":"Remote Provider","settingsConfig":{"env":{"ANTHROPIC_AUTH_TOKEN":"sk-original","ANTHROPIC_BASE_URL":"https://api.anthropic.com"}}}"#
                .to_string(),
            "false".to_string(),
        ]);
        assert_eq!(add_response["ok"], true);

        let list_response = cc_switch_lib::cli::run(&[
            "providers".to_string(),
            "list".to_string(),
            "claude".to_string(),
        ]);
        assert_eq!(list_response["ok"], true, "{list_response}");
        let mut provider = list_response["data"]["remote-provider"].clone();
        assert_eq!(provider["id"], "remote-provider", "{list_response}");
        assert_eq!(
            provider["settingsConfig"]["env"]["ANTHROPIC_AUTH_TOKEN"],
            "[redacted]"
        );

        provider["name"] = serde_json::Value::String("Remote Secret Renamed".to_string());
        let update_response = cc_switch_lib::cli::run(&[
            "providers".to_string(),
            "update".to_string(),
            "claude".to_string(),
            serde_json::to_string(&provider).expect("provider json"),
            "-".to_string(),
        ]);

        let stored = cc_switch_lib::Database::init()
            .expect("database")
            .get_provider_by_id("remote-provider", "claude")
            .expect("load provider")
            .expect("stored provider");
        let stored_token = stored.settings_config["env"]["ANTHROPIC_AUTH_TOKEN"]
            .as_str()
            .expect("stored token")
            .to_string();

        (list_response, update_response, stored_token)
    });

    assert_eq!(list_response["ok"], true);
    assert_eq!(update_response["ok"], true);
    assert_eq!(stored_token, "sk-original");
}

#[test]
#[serial]
fn import_export_round_trips_database_sql_through_json_cli() {
    let (export_response, import_response) = with_temp_home(|| {
        let seed_response = cc_switch_lib::cli::run(&[
            "providers".to_string(),
            "add".to_string(),
            "claude".to_string(),
            r#"{"id":"remote-seed","name":"Remote Seed","settingsConfig":{"env":{"ANTHROPIC_AUTH_TOKEN":"test-key"}}}"#
                .to_string(),
            "false".to_string(),
        ]);
        assert_eq!(seed_response["ok"], true);
        let export_response =
            cc_switch_lib::cli::run(&["import-export".to_string(), "export-sql".to_string()]);
        let sql = export_response["data"]
            .as_str()
            .expect("exported SQL string");
        let encoded = {
            use base64::{engine::general_purpose::STANDARD, Engine as _};
            STANDARD.encode(sql)
        };
        let import_response = cc_switch_lib::cli::run(&[
            "import-export".to_string(),
            "import-sql-b64".to_string(),
            encoded,
        ]);
        (export_response, import_response)
    });

    assert_eq!(export_response["ok"], true);
    assert!(export_response["error"].is_null());
    assert!(export_response["data"]
        .as_str()
        .expect("exported SQL string")
        .starts_with("-- CC Switch SQLite 导出"));
    assert_eq!(import_response["ok"], true);
    assert!(import_response["error"].is_null());
    assert!(import_response["data"]["success"]
        .as_bool()
        .unwrap_or(false));
    assert!(import_response["data"]["backupId"].is_string());
}

#[test]
#[serial]
fn import_export_manages_database_backups_through_json_cli() {
    let (
        create_response,
        list_after_create,
        rename_response,
        list_after_rename,
        restore_response,
        delete_response,
        list_after_delete,
    ) = with_temp_home(|| {
        let seed_response = cc_switch_lib::cli::run(&[
            "providers".to_string(),
            "add".to_string(),
            "claude".to_string(),
            r#"{"id":"backup-seed","name":"Backup Seed","settingsConfig":{"env":{"ANTHROPIC_AUTH_TOKEN":"test-key"}}}"#
                .to_string(),
            "false".to_string(),
        ]);
        assert_eq!(seed_response["ok"], true);

        let create_response =
            cc_switch_lib::cli::run(&["import-export".to_string(), "create-backup".to_string()]);
        let created_filename = create_response["data"]
            .as_str()
            .expect("created backup filename")
            .to_string();
        let list_after_create =
            cc_switch_lib::cli::run(&["import-export".to_string(), "backups".to_string()]);

        let rename_response = cc_switch_lib::cli::run(&[
            "import-export".to_string(),
            "rename-backup".to_string(),
            created_filename,
            "remote backup renamed".to_string(),
        ]);
        let renamed_filename = rename_response["data"]
            .as_str()
            .expect("renamed backup filename")
            .to_string();
        let list_after_rename =
            cc_switch_lib::cli::run(&["import-export".to_string(), "backups".to_string()]);

        let restore_response = cc_switch_lib::cli::run(&[
            "import-export".to_string(),
            "restore-backup".to_string(),
            renamed_filename.clone(),
        ]);

        let delete_response = cc_switch_lib::cli::run(&[
            "import-export".to_string(),
            "delete-backup".to_string(),
            renamed_filename,
        ]);
        let list_after_delete =
            cc_switch_lib::cli::run(&["import-export".to_string(), "backups".to_string()]);

        (
            create_response,
            list_after_create,
            rename_response,
            list_after_rename,
            restore_response,
            delete_response,
            list_after_delete,
        )
    });

    assert_eq!(create_response["ok"], true);
    let created_filename = create_response["data"]
        .as_str()
        .expect("created backup filename");
    assert!(created_filename.starts_with("db_backup_"));
    assert!(created_filename.ends_with(".db"));

    assert_eq!(list_after_create["ok"], true);
    assert!(list_after_create["data"]
        .as_array()
        .expect("backup list")
        .iter()
        .any(|entry| entry["filename"] == created_filename));

    assert_eq!(rename_response["ok"], true);
    let renamed_filename = rename_response["data"]
        .as_str()
        .expect("renamed backup filename");
    assert_eq!(renamed_filename, "remote backup renamed.db");

    assert_eq!(list_after_rename["ok"], true);
    assert!(list_after_rename["data"]
        .as_array()
        .expect("renamed backup list")
        .iter()
        .any(|entry| entry["filename"] == renamed_filename));

    assert_eq!(restore_response["ok"], true);
    assert!(restore_response["data"].is_string());

    assert_eq!(delete_response["ok"], true);
    assert_eq!(delete_response["data"], true);
    assert_eq!(list_after_delete["ok"], true);
    assert!(!list_after_delete["data"]
        .as_array()
        .expect("backup list after delete")
        .iter()
        .any(|entry| entry["filename"] == renamed_filename));
}

#[test]
#[serial]
fn unsupported_command_returns_stable_error_envelope() {
    let response = cc_switch_lib::cli::run(&["unknown".to_string()]);

    assert_eq!(response["ok"], false);
    assert!(response["data"].is_null());
    assert_eq!(response["error"]["code"], "unsupported_command");
    assert_eq!(
        response["error"]["message"],
        "Supported commands: status, providers, profiles, config, universal-providers, routing-config, routing-runtime, routing-runtime daemon-start/status/stop/run, sessions, hermes, openclaw, mcp, prompts, skills, import-export, cloud-sync, tools, settings, plugin, stream-check, usage, auth"
    );
}
