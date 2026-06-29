//! 代理服务器模块
//!
//! 提供本地HTTP代理服务，支持多Provider故障转移和请求透传

#[cfg(feature = "desktop")]
pub(crate) type ProxyAppHandle = tauri::AppHandle;

#[cfg(not(feature = "desktop"))]
#[derive(Clone)]
pub(crate) struct ProxyAppHandle;

pub mod body_filter;
pub mod cache_injector;
pub mod circuit_breaker;
pub(crate) mod content_encoding;
pub mod copilot_optimizer;
pub mod error;
pub mod error_mapper;
#[cfg(any(feature = "desktop", feature = "proxy-runtime"))]
pub(crate) mod failover_switch;
#[cfg(any(feature = "desktop", feature = "proxy-runtime"))]
mod forwarder;
pub mod gemini_url;
pub mod handler_config;
#[cfg(any(feature = "desktop", feature = "proxy-runtime"))]
pub mod handler_context;
#[cfg(any(feature = "desktop", feature = "proxy-runtime"))]
mod handlers;
#[cfg(any(feature = "desktop", feature = "proxy-runtime"))]
mod health;
pub mod http_client;
pub mod hyper_client;
pub(crate) mod json_canonical;
pub mod log_codes;
#[cfg(any(feature = "desktop", feature = "proxy-runtime"))]
pub(crate) mod managed_auth_runtime;
pub mod media_sanitizer;
pub mod model_mapper;
pub mod provider_router;
pub mod providers;
pub mod response_handler;
#[cfg(any(feature = "desktop", feature = "proxy-runtime"))]
pub mod response_processor;
#[cfg(any(feature = "desktop", feature = "proxy-runtime"))]
pub(crate) mod server;
pub mod session;
pub(crate) mod sse;
#[cfg(any(feature = "desktop", feature = "proxy-runtime"))]
pub(crate) mod switch_lock;
pub mod thinking_budget_rectifier;
pub mod thinking_optimizer;
pub mod thinking_rectifier;
pub(crate) mod types;
pub mod usage;

// 公开导出给外部使用（commands, services等模块需要）
#[allow(unused_imports)]
pub use circuit_breaker::{
    CircuitBreaker, CircuitBreakerConfig, CircuitBreakerStats, CircuitState,
};
#[allow(unused_imports)]
pub use error::ProxyError;
#[allow(unused_imports)]
pub use provider_router::ProviderRouter;
#[allow(unused_imports)]
pub use response_handler::{NonStreamHandler, ResponseType, StreamHandler};
#[allow(unused_imports)]
pub use session::{
    extract_session_id, ClientFormat, ProxySession, SessionIdResult, SessionIdSource,
};
#[allow(unused_imports)]
pub use types::{ProxyConfig, ProxyServerInfo, ProxyStatus};

// 内部模块间共享（供子模块使用）
// 注意：这个导出用于模块内部，编译器可能警告未使用但实际被子模块使用
#[allow(unused_imports)]
pub(crate) use types::*;
