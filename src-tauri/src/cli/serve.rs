use crate::cli::types::{self, CliServeRequest, CliServeResponse};
use serde_json::Value;
use std::io::{self, BufRead, Write};

pub fn handle_line(line: &str) -> CliServeResponse {
    let request: CliServeRequest = match serde_json::from_str(line) {
        Ok(request) => request,
        Err(error) => {
            return types::serve_err(
                "invalid".to_string(),
                "invalid_request",
                format!("Invalid serve request JSON: {error}"),
            );
        }
    };

    let data = super::run_command(&request.command);
    if data.get("ok").and_then(Value::as_bool).unwrap_or(false) {
        types::serve_ok(request.id, data.get("data").cloned().unwrap_or(Value::Null))
    } else {
        let error = data.get("error").cloned().unwrap_or(Value::Null);
        let code = error
            .get("code")
            .and_then(Value::as_str)
            .unwrap_or("remote_error");
        let message = error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("Remote helper command failed");
        types::serve_err(request.id, code, message)
    }
}

pub fn run_stdio() -> io::Result<()> {
    let stdin = io::stdin();
    let mut stdout = io::stdout().lock();

    for line in stdin.lock().lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let response = handle_line(&line);
        serde_json::to_writer(&mut stdout, &response)?;
        stdout.write_all(b"\n")?;
        stdout.flush()?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn handle_line_dispatches_status() {
        let response = handle_line(r#"{"id":"1","command":["status"]}"#);

        assert_eq!(response.id, "1");
        assert!(response.ok);
        assert!(response.data.expect("data").get("capabilities").is_some());
    }

    #[test]
    fn handle_line_preserves_unsupported_command_error() {
        let response = handle_line(r#"{"id":"2","command":["missing"]}"#);

        assert_eq!(response.id, "2");
        assert!(!response.ok);
        assert_eq!(response.error.expect("error").code, "unsupported_command");
    }

    #[test]
    fn handle_line_dispatches_routing_runtime_status() {
        let dir = tempfile::tempdir().expect("temp test home");
        let previous_home = std::env::var_os("CC_SWITCH_TEST_HOME");
        std::env::set_var("CC_SWITCH_TEST_HOME", dir.path());
        let db = crate::database::Database::init().expect("init test database");
        let mut proxy_config =
            futures::executor::block_on(db.get_proxy_config()).expect("get proxy config");
        proxy_config.listen_port = 0;
        futures::executor::block_on(db.update_proxy_config(proxy_config))
            .expect("disable external proxy probe");

        let response = handle_line(r#"{"id":"proxy","command":["routing-runtime","status"]}"#);

        match previous_home {
            Some(value) => std::env::set_var("CC_SWITCH_TEST_HOME", value),
            None => std::env::remove_var("CC_SWITCH_TEST_HOME"),
        }

        assert_eq!(response.id, "proxy");
        assert!(response.ok, "expected ok response: {:?}", response.error);
        assert_eq!(
            response
                .data
                .expect("data")
                .get("running")
                .and_then(Value::as_bool),
            Some(false)
        );
    }

    #[test]
    fn handle_line_rejects_invalid_json() {
        let response = handle_line("{");

        assert_eq!(response.id, "invalid");
        assert!(!response.ok);
        assert_eq!(response.error.expect("error").code, "invalid_request");
    }
}
