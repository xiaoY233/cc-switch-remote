use std::io::Write;
use std::process::{Command, Stdio};

fn write_codex_rollout(sessions: &std::path::Path, session_id: &str, first: u64, second: u64) {
    let path = sessions.join(format!("rollout-2026-08-10T03-00-00-{session_id}.jsonl"));
    let lines = [
        serde_json::json!({
            "timestamp": "2026-08-10T03:00:00Z",
            "type": "session_meta",
            "payload": { "id": session_id, "source": "cli" }
        }),
        serde_json::json!({
            "timestamp": "2026-08-10T03:00:01Z",
            "type": "turn_context",
            "payload": { "model": "gpt-5.6-sol" }
        }),
        serde_json::json!({
            "timestamp": "2026-08-10T03:00:02Z",
            "type": "event_msg",
            "payload": { "type": "token_count", "info": {
                "total_token_usage": {
                    "input_tokens": first,
                    "cached_input_tokens": first / 2,
                    "output_tokens": first / 10,
                    "total_tokens": first + first / 10
                }
            }}
        }),
        serde_json::json!({
            "timestamp": "2026-08-10T03:00:04Z",
            "type": "event_msg",
            "payload": { "type": "token_count", "info": {
                "total_token_usage": {
                    "input_tokens": second,
                    "cached_input_tokens": second / 2,
                    "output_tokens": second / 10,
                    "total_tokens": second + second / 10
                }
            }}
        }),
    ]
    .into_iter()
    .map(|value| value.to_string())
    .collect::<Vec<_>>()
    .join("\n")
        + "\n";
    std::fs::write(path, lines).expect("write Codex rollout");
}

#[test]
fn production_helper_serve_keeps_session_and_uses_shared_codex_sync() {
    let test_home = tempfile::tempdir().expect("serve test home");
    let sessions = test_home.path().join(".codex/sessions/2026/08/10");
    std::fs::create_dir_all(&sessions).expect("create Codex session directory");
    let session_a = "00000000-0000-4000-8000-0000000000a1";
    let session_b = "00000000-0000-4000-8000-0000000000b2";
    write_codex_rollout(&sessions, session_a, 100, 150);
    write_codex_rollout(&sessions, session_b, 1_000, 1_300);

    let mut child = Command::new(env!("CARGO_BIN_EXE_cc-switch-remote-helper"))
        .arg("serve")
        .env("CC_SWITCH_TEST_HOME", test_home.path())
        .env("HOME", test_home.path())
        .env("XDG_DATA_HOME", test_home.path().join("xdg-data"))
        .env("OPENCODE_DB", test_home.path().join("missing-opencode.db"))
        .env_remove("CC_SWITCH_DISABLE_SESSION_SYNC_FOR_TESTS")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn helper serve session");

    let mut stdin = child.stdin.take().expect("helper stdin");
    stdin
        .write_all(
            concat!(
                r#"{"id":"bad","command":["missing"]}"#,
                "\n",
                r#"{"id":"unit","command":["routing-config","set-global-outbound","-"]}"#,
                "\n",
                r#"{"id":"sync-1","command":["usage","sync-session"]}"#,
                "\n",
                r#"{"id":"sync-2","command":["usage","sync-session"]}"#,
                "\n",
                r#"{"id":"next","command":["status"]}"#,
                "\n"
            )
            .as_bytes(),
        )
        .expect("write helper requests");
    drop(stdin);

    let output = child.wait_with_output().expect("wait for helper session");
    assert!(
        output.status.success(),
        "helper serve session failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let responses = String::from_utf8(output.stdout)
        .expect("helper stdout UTF-8")
        .lines()
        .map(|line| serde_json::from_str::<serde_json::Value>(line).expect("serve response JSON"))
        .collect::<Vec<_>>();
    assert_eq!(responses.len(), 5);
    assert_eq!(responses[0]["id"], "bad");
    assert_eq!(responses[0]["ok"], false);
    assert_eq!(responses[0]["error"]["code"], "unsupported_command");
    assert_eq!(responses[1]["id"], "unit");
    assert_eq!(responses[1]["ok"], true);
    assert!(responses[1]["data"].is_null());
    assert_eq!(responses[2]["id"], "sync-1");
    assert_eq!(responses[2]["data"]["imported"], 4);
    assert_eq!(responses[3]["id"], "sync-2");
    assert_eq!(responses[3]["data"]["imported"], 0);
    assert_eq!(responses[3]["data"]["skipped"], 0);
    assert_eq!(responses[4]["id"], "next");
    assert_eq!(responses[4]["ok"], true);
    assert!(responses[4]["data"]["capabilities"].is_array());

    let db_path = test_home.path().join(".cc-switch-remote/cc-switch.db");
    let conn = rusqlite::Connection::open(db_path).expect("open helper database");
    let rows = conn
        .prepare(
            "SELECT session_id, input_tokens FROM proxy_request_logs
             WHERE data_source = 'codex_session'
             ORDER BY session_id, request_id",
        )
        .expect("prepare usage query")
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .expect("query helper usage")
        .collect::<Result<Vec<_>, _>>()
        .expect("collect helper usage");
    assert_eq!(
        rows,
        vec![
            (session_a.to_string(), 100),
            (session_a.to_string(), 50),
            (session_b.to_string(), 1_000),
            (session_b.to_string(), 300),
        ]
    );
    let cursor_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM session_log_sync WHERE last_line_offset = 4",
            [],
            |row| row.get(0),
        )
        .expect("query persisted helper cursors");
    assert_eq!(cursor_count, 2);

    let upstream_root = test_home.path().join(".cc-switch");
    assert!(
        !upstream_root.exists(),
        "the remote helper must never create or mutate the upstream CC Switch root: {}",
        upstream_root.display()
    );
    assert!(
        !upstream_root.join("cc-switch.db").exists(),
        "the remote helper database must remain isolated under .cc-switch-remote"
    );
}
