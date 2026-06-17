pub const REMOTE_HELPER_CAPABILITIES: &[&str] = &[
    "providers",
    "universal-providers",
    "routing-config",
    #[cfg(feature = "proxy-runtime")]
    "routing-runtime",
    "openclaw",
    "mcp",
    "prompts",
    "skills",
    "sessions",
    "hermes-memory",
    "import-export",
    "tools",
    "stream-check",
    "settings",
    "settings-app-config-dir",
    "plugin",
    "session",
];

pub const REMOTE_HELPER_REQUIRED_CAPABILITIES: &[&str] = REMOTE_HELPER_CAPABILITIES;

pub fn remote_helper_capabilities() -> Vec<String> {
    REMOTE_HELPER_CAPABILITIES
        .iter()
        .map(|capability| (*capability).to_string())
        .collect()
}
