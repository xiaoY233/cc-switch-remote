pub const REMOTE_HELPER_CAPABILITIES: &[&str] = &[
    "providers",
    "profiles",
    "common-config",
    "omo",
    "provider-official-seed",
    "provider-model-fetch",
    "opencode-runtime-models",
    "universal-providers",
    "routing-config",
    #[cfg(feature = "proxy-runtime")]
    "routing-runtime",
    #[cfg(feature = "proxy-runtime")]
    "routing-daemon",
    "openclaw",
    "mcp",
    "prompts",
    "skills",
    "sessions",
    "hermes-memory",
    "import-export",
    "restore-preflight",
    "cloud-sync",
    "tools",
    "stream-check",
    "usage",
    "usage-model-pricing-sync",
    "auth",
    "auth-targeted-relogin",
    "auth-cancel-login",
    "codex-config-only",
    "settings",
    "settings-app-config-dir",
    "plugin",
    "session",
];

pub const REMOTE_HELPER_REQUIRED_CAPABILITIES: &[&str] = &["providers"];

pub fn remote_helper_capabilities() -> Vec<String> {
    REMOTE_HELPER_CAPABILITIES
        .iter()
        .map(|capability| (*capability).to_string())
        .collect()
}
