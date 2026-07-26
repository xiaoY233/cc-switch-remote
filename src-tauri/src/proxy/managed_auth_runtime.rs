use super::providers::{
    codex_oauth_auth::CodexOAuthManager, copilot_auth::CopilotAuthManager,
    xai_oauth_auth::XaiOAuthManager,
};
use std::sync::Arc;

#[derive(Clone, Default)]
pub(crate) struct ManagedAuthRuntime {
    pub(crate) copilot: Option<Arc<CopilotAuthManager>>,
    pub(crate) codex_oauth: Option<Arc<CodexOAuthManager>>,
    pub(crate) xai_oauth: Option<Arc<XaiOAuthManager>>,
}
