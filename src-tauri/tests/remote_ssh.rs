use cc_switch_lib::remote::{
    build_helper_install_args, build_helper_install_args_with_source, build_ssh_args,
    run_helper_json, RemoteAuthMethod, RemoteConnectionSecret, RemoteHelperInstallSource,
    RemoteHostProfile,
};
use cc_switch_lib::remote_capabilities::REMOTE_HELPER_REQUIRED_CAPABILITIES;
#[cfg(unix)]
use serial_test::serial;
#[cfg(unix)]
use std::fs;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

fn profile() -> RemoteHostProfile {
    RemoteHostProfile {
        id: "dev".to_string(),
        name: "Dev".to_string(),
        host: "example.com".to_string(),
        port: 2222,
        username: "alice".to_string(),
        auth_method: RemoteAuthMethod::KeyFile {
            path: "/Users/alice/.ssh/id_ed25519".to_string(),
        },
        helper_path: "~/.local/bin/cc-switch-remote-helper".to_string(),
        created_at: 1,
        updated_at: 1,
    }
}

#[test]
fn ssh_args_include_port_identity_and_json_command() {
    let args = build_ssh_args(&profile(), &["status".to_string()]);
    assert_eq!(args[0], "-p");
    assert!(args.contains(&"2222".to_string()));
    assert!(args.contains(&"-i".to_string()));
    assert!(args.contains(&"/Users/alice/.ssh/id_ed25519".to_string()));
    assert!(args.contains(&"alice@example.com".to_string()));
    assert!(args.last().expect("remote command").contains("--json"));
}

#[test]
fn ssh_serve_args_start_helper_in_serve_mode() {
    let args = cc_switch_lib::remote::build_ssh_serve_args(&profile());

    assert!(args.contains(&"alice@example.com".to_string()));
    assert_eq!(
        args.last().expect("remote command"),
        "~/.local/bin/cc-switch-remote-helper --json serve"
    );
    assert!(args.contains(&"ControlMaster=no".to_string()));
    assert!(!args.iter().any(|arg| arg == "-S"));
}

#[test]
fn ssh_args_accept_new_host_keys_without_disabling_changed_host_protection() {
    let args = build_ssh_args(&profile(), &["status".to_string()]);

    assert!(args.contains(&"StrictHostKeyChecking=accept-new".to_string()));
    assert!(args.contains(&"NumberOfPasswordPrompts=1".to_string()));
    assert!(!args.contains(&"StrictHostKeyChecking=no".to_string()));
}

#[test]
fn ssh_args_disable_control_master_by_default() {
    let args = build_ssh_args(&profile(), &["providers".to_string(), "list".to_string()]);

    assert!(args.contains(&"ControlMaster=no".to_string()));
    assert!(args.contains(&"ControlPersist=no".to_string()));
    assert!(!args.contains(&"ControlMaster=auto".to_string()));
    assert!(!args.iter().any(|arg| arg == "-S"));
}

#[test]
#[cfg(unix)]
fn ssh_args_do_not_create_control_socket_path() {
    let args = build_ssh_args(&profile(), &["status".to_string()]);

    assert!(!args.iter().any(|arg| arg == "-S"));
}

#[test]
fn ssh_args_terminate_options_before_destination() {
    let mut profile = profile();
    profile.username = "-oProxyCommand=bad".to_string();

    let args = build_ssh_args(&profile, &["status".to_string()]);
    let destination_index = args
        .iter()
        .position(|arg| arg == "-oProxyCommand=bad@example.com")
        .expect("destination");

    assert_eq!(args[destination_index - 1], "--");
}

#[test]
fn ssh_password_auth_uses_interactive_options_without_exposing_password() {
    let mut profile = profile();
    profile.auth_method = RemoteAuthMethod::Password;

    let args = build_ssh_args(&profile, &["status".to_string()]);
    let joined = args.join(" ");

    assert!(args.contains(&"BatchMode=no".to_string()));
    assert!(args.contains(&"PreferredAuthentications=password,keyboard-interactive".to_string()));
    assert!(args.contains(&"PubkeyAuthentication=no".to_string()));
    assert!(!joined.contains("password="));
}

#[test]
#[cfg(unix)]
fn tokio_password_auth_setup_uses_askpass_env() {
    use cc_switch_lib::remote::configure_password_auth_for_tokio;

    let mut profile = profile();
    profile.auth_method = RemoteAuthMethod::Password;
    let secret = RemoteConnectionSecret {
        password: Some("secret".to_string()),
    };
    let mut command = tokio::process::Command::new("ssh");

    let guard = configure_password_auth_for_tokio(&profile, Some(&secret), &mut command)
        .expect("askpass guard");
    assert!(guard.is_some());
}

#[test]
#[cfg(unix)]
#[serial]
fn password_auth_runs_ssh_with_askpass_secret_without_command_line_secret() {
    let dir = tempfile::tempdir().expect("temp dir");
    let ssh_path = dir.path().join("ssh");
    fs::write(
        &ssh_path,
        r#"#!/bin/sh
set -eu
test "${SSH_ASKPASS_REQUIRE:-}" = "force"
test "${DISPLAY:-}" = "cc-switch"
test "$("$SSH_ASKPASS")" = "unit-test-secret"
test "${CC_SWITCH_REMOTE_SSH_PASSWORD:-}" = "unit-test-secret"
printf '%s\n' '{"ok":true,"data":{"version":"test","platform":"linux","capabilities":["providers"]},"error":null}'
"#,
    )
    .expect("write fake ssh");
    let mut permissions = fs::metadata(&ssh_path)
        .expect("fake ssh metadata")
        .permissions();
    permissions.set_mode(0o700);
    fs::set_permissions(&ssh_path, permissions).expect("chmod fake ssh");

    let old_path = std::env::var_os("PATH").unwrap_or_default();
    let new_path = format!("{}:{}", dir.path().display(), old_path.to_string_lossy());
    std::env::set_var("PATH", new_path);

    let mut profile = profile();
    profile.auth_method = RemoteAuthMethod::Password;
    let secret = RemoteConnectionSecret {
        password: Some("unit-test-secret".to_string()),
    };

    let status: serde_json::Value =
        run_helper_json(&profile, &["status".to_string()], Some(&secret)).expect("helper status");

    std::env::set_var("PATH", old_path);

    assert_eq!(status["version"], "test");
}

#[test]
#[cfg(unix)]
#[serial]
fn helper_json_accepts_ok_null_data_for_void_commands() {
    let dir = tempfile::tempdir().expect("temp dir");
    let ssh_path = dir.path().join("ssh");
    fs::write(
        &ssh_path,
        r#"#!/bin/sh
set -eu
printf '%s\n' '{"ok":true,"data":null,"error":null}'
"#,
    )
    .expect("write fake ssh");
    let mut permissions = fs::metadata(&ssh_path)
        .expect("fake ssh metadata")
        .permissions();
    permissions.set_mode(0o700);
    fs::set_permissions(&ssh_path, permissions).expect("chmod fake ssh");

    let old_path = std::env::var_os("PATH").unwrap_or_default();
    let new_path = format!("{}:{}", dir.path().display(), old_path.to_string_lossy());
    std::env::set_var("PATH", new_path);

    let result =
        run_helper_json::<()>(&profile(), &["mcp".to_string(), "upsert".to_string()], None);

    std::env::set_var("PATH", old_path);

    assert!(result.is_ok());
}

#[test]
fn ssh_command_preserves_empty_and_space_helper_args() {
    let args = build_ssh_args(
        &profile(),
        &[
            "".to_string(),
            "two words".to_string(),
            "status".to_string(),
        ],
    );

    assert_eq!(
        args.last().expect("remote command"),
        "~/.local/bin/cc-switch-remote-helper --json '' 'two words' status"
    );
}

#[test]
fn ssh_command_quotes_helper_path_with_spaces() {
    let mut profile = profile();
    profile.helper_path = "/opt/cc switch/bin/cc-switch".to_string();

    let args = build_ssh_args(&profile, &["status".to_string()]);

    assert_eq!(
        args.last().expect("remote command"),
        "'/opt/cc switch/bin/cc-switch' --json status"
    );
}

#[test]
fn ssh_command_escapes_single_quote_and_metacharacters_in_helper_path() {
    let mut profile = profile();
    profile.helper_path = "/tmp/cc switch'; rm -rf /".to_string();

    let args = build_ssh_args(&profile, &["status".to_string()]);

    assert_eq!(
        args.last().expect("remote command"),
        "'/tmp/cc switch'\\''; rm -rf /' --json status"
    );
}

#[test]
fn ssh_command_escapes_single_quote_and_metacharacters_in_helper_args() {
    let args = build_ssh_args(&profile(), &["it's; $(rm -rf /) && ok".to_string()]);

    assert_eq!(
        args.last().expect("remote command"),
        "~/.local/bin/cc-switch-remote-helper --json 'it'\\''s; $(rm -rf /) && ok'"
    );
}

#[test]
fn ssh_command_has_no_trailing_space_when_helper_args_are_empty() {
    let args = build_ssh_args(&profile(), &[]);

    assert_eq!(
        args.last().expect("remote command"),
        "~/.local/bin/cc-switch-remote-helper --json"
    );
}

#[test]
fn helper_install_args_install_cli_and_link_configured_helper_path() {
    let args = build_helper_install_args(&profile());
    let remote_command = args.last().expect("remote command");

    assert!(args.contains(&"alice@example.com".to_string()));
    assert!(remote_command.contains(
        "api.github.com/repos/xiaoY233/cc-switch-remote/releases/tags/remote-helper-latest"
    ));
    assert!(remote_command.contains("fetch_url_to_stdout()"));
    assert!(remote_command.contains("curl -fsSL \"$1\" -o \"$2\""));
    assert!(remote_command.contains("wget -qO- \"$1\""));
    assert!(remote_command.contains("fetch_url_to_file()"));
    assert!(remote_command.contains("wget -qO \"$2\" \"$1\""));
    assert!(remote_command.contains("verify_helper_status()"));
    assert!(remote_command.contains("Remote server cannot download helper"));
    assert!(remote_command.contains("Remote server failed to query GitHub helper release"));
    assert!(remote_command.contains("Remote server failed to download the compatible helper asset"));
    assert!(remote_command.contains("Remote-side helper install failed before verification"));
    assert!(remote_command.contains("grep -q '\"openclaw\"'"));
    assert!(remote_command.contains("grep -q '\"hermes-memory\"'"));
    assert!(remote_command.contains("grep -q '\"settings\"'"));
    assert!(remote_command.contains("grep -q '\"plugin\"'"));
    assert!(remote_command.contains("cc-switch-remote helper is missing required capabilities"));
    assert!(remote_command.contains(&REMOTE_HELPER_REQUIRED_CAPABILITIES.join(", ")));
    assert!(remote_command.contains("cc-switch-remote-helper"));
    assert!(remote_command.contains("cc-switch-cli"));
    assert!(!remote_command.contains("asset_arch=universal"));
    assert!(remote_command.contains("fetch_url_to_file \"$download_url\" \"$helper_tmp\""));
    assert!(remote_command.contains("verify_helper_status"));
    assert!(!remote_command.contains("cargo install"));
    assert!(!remote_command.contains("rustup"));
    assert!(!remote_command.contains("tar -xzf"));
}

#[test]
#[cfg(unix)]
#[serial]
fn helper_startup_native_library_error_is_user_friendly() {
    let dir = tempfile::tempdir().expect("temp dir");
    let ssh_path = dir.path().join("ssh");
    fs::write(
        &ssh_path,
        r#"#!/bin/sh
set -eu
printf '%s\n' '/root/.local/bin/cc-switch-remote-helper: error while loading shared libraries: libgdk-3.so.0: cannot open shared object file: No such file or directory' >&2
exit 127
"#,
    )
    .expect("write fake ssh");
    let mut permissions = fs::metadata(&ssh_path)
        .expect("fake ssh metadata")
        .permissions();
    permissions.set_mode(0o700);
    fs::set_permissions(&ssh_path, permissions).expect("chmod fake ssh");

    let old_path = std::env::var_os("PATH").unwrap_or_default();
    let new_path = format!("{}:{}", dir.path().display(), old_path.to_string_lossy());
    std::env::set_var("PATH", new_path);

    let error = run_helper_json::<serde_json::Value>(&profile(), &["status".to_string()], None)
        .expect_err("helper should fail");

    std::env::set_var("PATH", old_path);

    let message = error.to_string();
    assert!(message.contains("远程 Helper 不是纯 CLI 构建"));
    assert!(!message.contains("libgdk-3.so.0"));
}

#[test]
#[cfg(unix)]
#[serial]
fn missing_helper_error_is_user_friendly() {
    let dir = tempfile::tempdir().expect("temp dir");
    let ssh_path = dir.path().join("ssh");
    fs::write(
        &ssh_path,
        r#"#!/bin/sh
set -eu
printf '%s\n' 'bash: line 1: /root/.local/bin/cc-switch-remote-helper: No such file or directory' >&2
exit 127
"#,
    )
    .expect("write fake ssh");
    let mut permissions = fs::metadata(&ssh_path)
        .expect("fake ssh metadata")
        .permissions();
    permissions.set_mode(0o700);
    fs::set_permissions(&ssh_path, permissions).expect("chmod fake ssh");

    let old_path = std::env::var_os("PATH").unwrap_or_default();
    let new_path = format!("{}:{}", dir.path().display(), old_path.to_string_lossy());
    std::env::set_var("PATH", new_path);

    let error = run_helper_json::<serde_json::Value>(&profile(), &["status".to_string()], None)
        .expect_err("missing helper should fail");

    std::env::set_var("PATH", old_path);

    let message = error.to_string();
    assert!(message.contains("远程 Helper 未安装或路径不正确"));
    assert!(message.contains("安装 Helper"));
    assert!(!message.contains("bash: line 1"));
}

#[test]
fn helper_install_downloads_from_github_release_without_remote_compile() {
    let source = RemoteHelperInstallSource::default();
    assert_eq!(source.release_tag, "remote-helper-latest");

    let args = build_helper_install_args_with_source(&profile(), &source);
    let remote_command = args.last().expect("remote command");

    assert!(remote_command.contains("if try_release_asset_install; then"));
    assert!(remote_command.contains("verify_helper_status"));
    assert!(!remote_command.contains("cargo install"));
    assert!(!remote_command.contains("Local source remote helper install failed"));
    assert!(!remote_command.contains("Git remote helper install failed"));
}

#[test]
fn helper_install_args_quote_configured_helper_path() {
    let mut profile = profile();
    profile.helper_path = "/tmp/cc switch'; rm -rf /".to_string();

    let args = build_helper_install_args(&profile);

    assert!(args
        .last()
        .expect("remote command")
        .contains("helper_path='/tmp/cc switch'\\''; rm -rf /'"));
}

#[test]
fn helper_install_args_accept_custom_release_source() {
    let source = RemoteHelperInstallSource {
        release_repo: "acme/cc-switch".to_string(),
        release_tag: "remote-helper-canary".to_string(),
    };

    let args = build_helper_install_args_with_source(&profile(), &source);
    let remote_command = args.last().expect("remote command");

    assert!(remote_command
        .contains("api.github.com/repos/acme/cc-switch/releases/tags/remote-helper-canary"));
    assert!(!remote_command.contains("cargo install"));
}

#[test]
#[cfg(unix)]
#[serial]
fn install_helper_runs_github_release_download_command_without_local_archive() {
    let dir = tempfile::tempdir().expect("temp dir");
    let ssh_path = dir.path().join("ssh");
    fs::write(
        &ssh_path,
        r#"#!/bin/sh
set -eu
printf '%s\n' '{"ok":true,"data":{"version":"test","platform":"linux","capabilities":["providers","universal-providers","routing-config","openclaw","mcp","prompts","skills","sessions","hermes-memory","import-export","cloud-sync","tools","stream-check","usage","auth","settings","settings-app-config-dir","plugin","session"]},"error":null}'
"#,
    )
    .expect("write fake ssh");
    let mut permissions = fs::metadata(&ssh_path)
        .expect("fake ssh metadata")
        .permissions();
    permissions.set_mode(0o700);
    fs::set_permissions(&ssh_path, permissions).expect("chmod fake ssh");

    let old_path = std::env::var_os("PATH").unwrap_or_default();
    let new_path = format!("{}:{}", dir.path().display(), old_path.to_string_lossy());
    std::env::set_var("PATH", new_path);

    let status: serde_json::Value =
        cc_switch_lib::remote::install_helper_json(&profile(), None).expect("install helper");

    std::env::set_var("PATH", old_path);

    assert_eq!(status["version"], "test");
}
