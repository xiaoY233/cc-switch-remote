use crate::database::Database;
use crate::proxy::managed_auth_runtime::ManagedAuthRuntime;
use crate::proxy::providers::codex_oauth_auth::CodexOAuthManager;
use crate::services::{ProxyService, UsageCache};
use std::sync::Arc;

/// 全局应用状态
#[derive(Clone)]
pub struct AppState {
    pub db: Arc<Database>,
    pub proxy_service: ProxyService,
    pub usage_cache: Arc<UsageCache>,
    // 内部已使用细粒度锁（accounts/access_tokens/refresh_locks），所有方法均为
    // `&self`，无需外层 RwLock；避免持有粗粒度锁跨网络刷新导致的连锁阻塞。
    pub codex_oauth_manager: Arc<CodexOAuthManager>,
}

impl AppState {
    /// 创建新的应用状态
    pub fn new(db: Arc<Database>) -> Self {
        let codex_oauth_manager =
            Arc::new(CodexOAuthManager::new(crate::config::get_app_config_dir()));
        Self::new_with_codex_oauth_manager_and_managed_auth_runtime(
            db,
            codex_oauth_manager,
            ManagedAuthRuntime::default(),
        )
    }

    pub(crate) fn new_with_codex_oauth_manager_and_managed_auth_runtime(
        db: Arc<Database>,
        codex_oauth_manager: Arc<CodexOAuthManager>,
        managed_auth_runtime: ManagedAuthRuntime,
    ) -> Self {
        let proxy_service = ProxyService::new_with_codex_oauth_manager_and_managed_auth_runtime(
            db.clone(),
            codex_oauth_manager.clone(),
            managed_auth_runtime,
        );

        Self {
            db,
            proxy_service,
            usage_cache: Arc::new(UsageCache::new()),
            codex_oauth_manager,
        }
    }
}
