use crate::database::Database;
use crate::proxy::managed_auth_runtime::ManagedAuthRuntime;
use crate::services::{ProxyService, UsageCache};
use std::sync::Arc;

/// 全局应用状态
pub struct AppState {
    pub db: Arc<Database>,
    pub proxy_service: ProxyService,
    pub usage_cache: Arc<UsageCache>,
}

impl AppState {
    /// 创建新的应用状态
    pub fn new(db: Arc<Database>) -> Self {
        Self::new_with_managed_auth_runtime(db, ManagedAuthRuntime::default())
    }

    pub(crate) fn new_with_managed_auth_runtime(
        db: Arc<Database>,
        managed_auth_runtime: ManagedAuthRuntime,
    ) -> Self {
        let proxy_service =
            ProxyService::new_with_managed_auth_runtime(db.clone(), managed_auth_runtime);

        Self {
            db,
            proxy_service,
            usage_cache: Arc::new(UsageCache::new()),
        }
    }
}
