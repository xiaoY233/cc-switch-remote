use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteHostProfile {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_method: RemoteAuthMethod,
    pub helper_path: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum RemoteAuthMethod {
    SshAgent,
    KeyFile { path: String },
    Password,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteConnectionSecret {
    pub password: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSessionStatus {
    pub profile_id: String,
    pub state: RemoteSessionState,
    pub last_error: Option<String>,
    pub active_request_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RemoteSessionState {
    Idle,
    Connecting,
    Ready,
    Busy,
    Reconnecting,
    Failed,
    Closed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteHealth {
    pub reachable: bool,
    pub helper_installed: bool,
    pub helper_version: Option<String>,
    pub helper_build: Option<String>,
    pub helper_arch: Option<String>,
    pub helper_latest_version: Option<String>,
    pub helper_latest_build: Option<String>,
    pub helper_latest_asset: Option<String>,
    pub helper_update_available: bool,
    pub helper_update_error: Option<String>,
    pub platform: Option<RemotePlatform>,
    pub capabilities: Vec<RemoteCapability>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RemotePlatform {
    Linux,
    Macos,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RemoteCapability {
    Providers,
    UniversalProviders,
    RoutingConfig,
    RoutingRuntime,
    RoutingDaemon,
    Openclaw,
    Mcp,
    Prompts,
    Skills,
    Sessions,
    HermesMemory,
    ImportExport,
    CloudSync,
    Tools,
    StreamCheck,
    Usage,
    Auth,
    Settings,
    SettingsAppConfigDir,
    Plugin,
    Session,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteCommandRequest {
    pub command: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteCommandResponse<T> {
    pub ok: bool,
    pub data: Option<T>,
    pub error: Option<RemoteCommandError>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteCommandError {
    pub code: String,
    pub message: String,
}
