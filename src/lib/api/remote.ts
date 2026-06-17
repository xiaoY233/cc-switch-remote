import { invoke } from "@tauri-apps/api/core";
import type {
  HermesMemoryKind,
  HermesMemoryLimits,
  HermesModelConfig,
  McpServer,
  McpServersMap,
  OpenClawAgentsDefaults,
  OpenClawDefaultModel,
  OpenClawEnvConfig,
  OpenClawToolsConfig,
  OpenClawWriteOutcome,
  Provider,
  SessionMessage,
  SessionMeta,
  UniversalProvider,
  UniversalProvidersMap,
} from "@/types";
import type { AppId } from "./types";
import type { ProviderSortUpdate, SwitchResult } from "./providers";
import type { StreamCheckConfig, StreamCheckResult } from "./model-test";
import type { LogConfig } from "./settings";
import type { Prompt } from "./prompts";
import type {
  DiscoverableSkill,
  ImportSkillSelection,
  InstalledSkill,
  SkillBackupEntry,
  SkillRepo,
  SkillUninstallResult,
  SkillUpdateInfo,
  UnmanagedSkill,
  MigrationResult,
} from "./skills";
import type { Settings, SkillStorageLocation } from "@/types";
import type {
  AppProxyConfig,
  CircuitBreakerConfig,
  CircuitBreakerStats,
  FailoverQueueItem,
  GlobalProxyConfig,
  ProviderHealth,
  ProxyServerInfo,
  ProxyStatus,
} from "@/types/proxy";
import type {
  OptimizerConfig,
  RectifierConfig,
  ToolInstallationReport,
} from "./settings";

export type RemoteAuthMethod =
  | { type: "sshAgent" }
  | { type: "keyFile"; path: string }
  | { type: "password" };

export interface RemoteHostProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authMethod: RemoteAuthMethod;
  helperPath: string;
  createdAt: number;
  updatedAt: number;
}

export interface RemoteConnectionSecret {
  password?: string;
}

export interface RemoteHealth {
  reachable: boolean;
  helperInstalled: boolean;
  helperVersion?: string;
  helperBuild?: string;
  helperArch?: string;
  helperLatestVersion?: string;
  helperLatestBuild?: string;
  helperLatestAsset?: string;
  helperUpdateAvailable?: boolean;
  helperUpdateError?: string;
  platform?: "linux" | "macos" | "unknown";
  capabilities: string[];
  lastError?: string;
}

export type RemoteSessionState =
  | "idle"
  | "connecting"
  | "ready"
  | "busy"
  | "reconnecting"
  | "failed"
  | "closed";

export interface RemoteSessionStatus {
  profileId: string;
  state: RemoteSessionState;
  lastError?: string;
  activeRequestId?: string;
}

export interface RemoteProviderState {
  providers: Record<string, Provider>;
  currentProviderId: string;
}

export interface RemoteToolVersion {
  name: string;
  version: string | null;
  latest_version: string | null;
  error: string | null;
  installed_but_broken: boolean;
  env_type: "windows" | "wsl" | "macos" | "linux" | "unknown";
  wsl_distro: string | null;
}

export interface RemoteDeleteSessionOptions {
  providerId: string;
  sessionId: string;
  sourcePath: string;
}

export interface RemoteDeleteSessionResult extends RemoteDeleteSessionOptions {
  success: boolean;
  error?: string;
}

export type ManagementTarget =
  | { type: "local" }
  | {
      type: "remote";
      profile: RemoteHostProfile;
      secret?: RemoteConnectionSecret;
    };

export const REMOTE_PROFILE_PREVIEW_STORAGE_KEY =
  "cc-switch-preview-remote-hosts";

type RemoteProfileStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function getPreviewStorage(): RemoteProfileStorage | null {
  if (typeof window === "undefined") return null;
  return window.localStorage ?? null;
}

export function validateRemoteProfile(profile: RemoteHostProfile): void {
  if (!profile.id.trim()) {
    throw new Error("Remote profile id is required");
  }
  if (!profile.host.trim()) {
    throw new Error("Remote host is required");
  }
  if (!profile.username.trim()) {
    throw new Error("Remote username is required");
  }
  if (!profile.port) {
    throw new Error("Remote SSH port is required");
  }
  if (
    profile.authMethod.type === "keyFile" &&
    !profile.authMethod.path.trim()
  ) {
    throw new Error("Remote SSH key path is required");
  }
}

export function loadPreviewRemoteProfiles(
  storage: RemoteProfileStorage | null = getPreviewStorage(),
): RemoteHostProfile[] {
  if (!storage) return [];
  const raw = storage.getItem(REMOTE_PROFILE_PREVIEW_STORAGE_KEY);
  if (!raw?.trim()) return [];
  try {
    const profiles = JSON.parse(raw) as RemoteHostProfile[];
    if (!Array.isArray(profiles)) return [];
    return profiles.filter((profile) => {
      try {
        validateRemoteProfile(profile);
        return true;
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

export function savePreviewRemoteProfile(
  profile: RemoteHostProfile,
  storage: RemoteProfileStorage | null = getPreviewStorage(),
): RemoteHostProfile {
  validateRemoteProfile(profile);
  if (!storage) return profile;
  const profiles = loadPreviewRemoteProfiles(storage);
  const next = [profile, ...profiles.filter((item) => item.id !== profile.id)];
  storage.setItem(REMOTE_PROFILE_PREVIEW_STORAGE_KEY, JSON.stringify(next));
  return profile;
}

export function deletePreviewRemoteProfile(
  id: string,
  storage: RemoteProfileStorage | null = getPreviewStorage(),
): boolean {
  if (!storage) return false;
  const profiles = loadPreviewRemoteProfiles(storage);
  const next = profiles.filter((profile) => profile.id !== id);
  if (next.length === profiles.length) return false;
  if (next.length === 0) {
    storage.removeItem(REMOTE_PROFILE_PREVIEW_STORAGE_KEY);
  } else {
    storage.setItem(REMOTE_PROFILE_PREVIEW_STORAGE_KEY, JSON.stringify(next));
  }
  return true;
}

function isTauriUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    message.includes("reading 'invoke'") ||
    message.includes("__TAURI_INTERNALS__") ||
    message.includes("__TAURI__") ||
    message.includes("not allowed on this window") ||
    message.includes("Tauri API is not available")
  );
}

async function invokeWithPreviewFallback<T>(
  command: string,
  args: Record<string, unknown>,
  preview: () => T,
): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    if (isTauriUnavailableError(error)) {
      return preview();
    }
    throw error;
  }
}

export const remoteApi = {
  listProfiles(): Promise<RemoteHostProfile[]> {
    return invokeWithPreviewFallback(
      "remote_list_profiles",
      {},
      loadPreviewRemoteProfiles,
    );
  },

  saveProfile(
    profile: RemoteHostProfile,
    secret?: RemoteConnectionSecret,
  ): Promise<RemoteHostProfile> {
    return invokeWithPreviewFallback(
      "remote_save_profile",
      { profile, secret },
      () => savePreviewRemoteProfile(profile),
    );
  },

  deleteProfile(id: string): Promise<boolean> {
    return invokeWithPreviewFallback("remote_delete_profile", { id }, () =>
      deletePreviewRemoteProfile(id),
    );
  },

  validateProfile(profile: RemoteHostProfile): Promise<boolean> {
    return invokeWithPreviewFallback(
      "remote_validate_profile",
      { profile },
      () => {
        validateRemoteProfile(profile);
        return true;
      },
    );
  },

  buildStatusCommand(profile: RemoteHostProfile): Promise<string[]> {
    return invoke<string[]>("remote_build_status_command", { profile });
  },

  buildHelperInstallCommand(profile: RemoteHostProfile): Promise<string[]> {
    return invoke<string[]>("remote_build_helper_install_command", { profile });
  },

  checkHealth(
    profile: RemoteHostProfile,
    secret?: RemoteConnectionSecret,
  ): Promise<RemoteHealth> {
    return invoke<RemoteHealth>("remote_check_health", { profile, secret });
  },

  installHelper(
    profile: RemoteHostProfile,
    secret?: RemoteConnectionSecret,
  ): Promise<RemoteHealth> {
    return invoke<RemoteHealth>("remote_install_helper", { profile, secret });
  },

  getSessionStatus(profileId: string): Promise<RemoteSessionStatus> {
    return invoke<RemoteSessionStatus>("remote_get_session_status", {
      profileId,
    });
  },

  closeSession(profileId: string): Promise<boolean> {
    return invoke<boolean>("remote_close_session", { profileId });
  },

  getSettings(
    profile: RemoteHostProfile,
    secret?: RemoteConnectionSecret,
  ): Promise<Settings> {
    return invoke<Settings>("remote_get_settings", { profile, secret });
  },

  saveSettings(
    profile: RemoteHostProfile,
    settings: Settings,
    secret?: RemoteConnectionSecret,
  ): Promise<boolean> {
    return invoke<boolean>("remote_save_settings", {
      profile,
      settings,
      secret,
    });
  },

  migrateSkillStorage(
    profile: RemoteHostProfile,
    target: SkillStorageLocation,
    secret?: RemoteConnectionSecret,
  ): Promise<MigrationResult> {
    return invoke<MigrationResult>("remote_migrate_skill_storage", {
      profile,
      target,
      secret,
    });
  },

  applyClaudePluginConfig(
    profile: RemoteHostProfile,
    official: boolean,
    secret?: RemoteConnectionSecret,
  ): Promise<boolean> {
    return invoke<boolean>("remote_apply_claude_plugin_config", {
      profile,
      official,
      secret,
    });
  },

  setClaudeOnboardingSkip(
    profile: RemoteHostProfile,
    enabled: boolean,
    secret?: RemoteConnectionSecret,
  ): Promise<boolean> {
    return invoke<boolean>("remote_set_claude_onboarding_skip", {
      profile,
      enabled,
      secret,
    });
  },

  exportConfigToFile(
    profile: RemoteHostProfile,
    filePath: string,
    secret?: RemoteConnectionSecret,
  ): Promise<{ success: boolean; message: string; filePath?: string }> {
    return invoke("remote_export_config_to_file", {
      profile,
      filePath,
      secret,
    });
  },

  importConfigFromFile(
    profile: RemoteHostProfile,
    filePath: string,
    secret?: RemoteConnectionSecret,
  ): Promise<{
    success: boolean;
    message: string;
    backupId?: string;
    warning?: string;
  }> {
    return invoke("remote_import_config_from_file", {
      profile,
      filePath,
      secret,
    });
  },

  getToolVersions(
    profile: RemoteHostProfile,
    tools?: string[],
    secret?: RemoteConnectionSecret,
  ): Promise<RemoteToolVersion[]> {
    return invoke<RemoteToolVersion[]>("remote_get_tool_versions", {
      profile,
      tools,
      secret,
    });
  },

  runToolLifecycleAction(
    profile: RemoteHostProfile,
    tools: string[],
    action: "install" | "update",
    secret?: RemoteConnectionSecret,
  ): Promise<void> {
    return invoke<void>("remote_run_tool_lifecycle_action", {
      profile,
      tools,
      action,
      secret,
    });
  },

  probeToolInstallations(
    profile: RemoteHostProfile,
    tools?: string[],
    secret?: RemoteConnectionSecret,
  ): Promise<ToolInstallationReport[]> {
    return invoke<ToolInstallationReport[]>("remote_probe_tool_installations", {
      profile,
      tools,
      secret,
    });
  },

  getProviders(
    profile: RemoteHostProfile,
    app: AppId,
    secret?: RemoteConnectionSecret,
  ): Promise<Record<string, Provider>> {
    return invoke<Record<string, Provider>>("remote_get_providers", {
      profile,
      app,
      secret,
    });
  },

  getCurrentProvider(
    profile: RemoteHostProfile,
    app: AppId,
    secret?: RemoteConnectionSecret,
  ): Promise<string> {
    return invoke<string>("remote_get_current_provider", {
      profile,
      app,
      secret,
    });
  },

  getProviderState(
    profile: RemoteHostProfile,
    app: AppId,
    secret?: RemoteConnectionSecret,
  ): Promise<RemoteProviderState> {
    return invoke<RemoteProviderState>("remote_get_provider_state", {
      profile,
      app,
      secret,
    });
  },

  switchProvider(
    profile: RemoteHostProfile,
    app: AppId,
    id: string,
    secret?: RemoteConnectionSecret,
  ): Promise<SwitchResult> {
    return invoke<SwitchResult>("remote_switch_provider", {
      profile,
      app,
      id,
      secret,
    });
  },

  addProvider(
    profile: RemoteHostProfile,
    app: AppId,
    provider: Provider,
    addToLive?: boolean,
    secret?: RemoteConnectionSecret,
  ): Promise<boolean> {
    return invoke<boolean>("remote_add_provider", {
      profile,
      app,
      provider,
      addToLive,
      secret,
    });
  },

  updateProvider(
    profile: RemoteHostProfile,
    app: AppId,
    provider: Provider,
    originalId?: string,
    secret?: RemoteConnectionSecret,
  ): Promise<boolean> {
    return invoke<boolean>("remote_update_provider", {
      profile,
      app,
      provider,
      originalId,
      secret,
    });
  },

  deleteProvider(
    profile: RemoteHostProfile,
    app: AppId,
    id: string,
    secret?: RemoteConnectionSecret,
  ): Promise<boolean> {
    return invoke<boolean>("remote_delete_provider", {
      profile,
      app,
      id,
      secret,
    });
  },

  removeProviderFromLiveConfig(
    profile: RemoteHostProfile,
    app: AppId,
    id: string,
    secret?: RemoteConnectionSecret,
  ): Promise<boolean> {
    return invoke<boolean>("remote_remove_provider_from_live_config", {
      profile,
      app,
      id,
      secret,
    });
  },

  getLiveProviderIds(
    profile: RemoteHostProfile,
    app: AppId,
    secret?: RemoteConnectionSecret,
  ): Promise<string[]> {
    return invoke<string[]>("remote_get_live_provider_ids", {
      profile,
      app,
      secret,
    });
  },

  streamCheckProvider(
    profile: RemoteHostProfile,
    app: AppId,
    providerId: string,
    secret?: RemoteConnectionSecret,
  ): Promise<StreamCheckResult> {
    return invoke<StreamCheckResult>("remote_stream_check_provider", {
      profile,
      app,
      providerId,
      secret,
    });
  },

  getStreamCheckConfig(
    profile: RemoteHostProfile,
    secret?: RemoteConnectionSecret,
  ): Promise<StreamCheckConfig> {
    return invoke<StreamCheckConfig>("remote_get_stream_check_config", {
      profile,
      secret,
    });
  },

  saveStreamCheckConfig(
    profile: RemoteHostProfile,
    config: StreamCheckConfig,
    secret?: RemoteConnectionSecret,
  ): Promise<boolean> {
    return invoke<boolean>("remote_save_stream_check_config", {
      profile,
      config,
      secret,
    });
  },

  getLogConfig(
    profile: RemoteHostProfile,
    secret?: RemoteConnectionSecret,
  ): Promise<LogConfig> {
    return invoke<LogConfig>("remote_get_log_config", {
      profile,
      secret,
    });
  },

  setLogConfig(
    profile: RemoteHostProfile,
    config: LogConfig,
    secret?: RemoteConnectionSecret,
  ): Promise<boolean> {
    return invoke<boolean>("remote_set_log_config", {
      profile,
      config,
      secret,
    });
  },

  importProviders(
    profile: RemoteHostProfile,
    app: AppId,
    secret?: RemoteConnectionSecret,
  ): Promise<boolean> {
    return invoke<boolean>("remote_import_providers", {
      profile,
      app,
      secret,
    });
  },

  updateProviderSortOrder(
    profile: RemoteHostProfile,
    app: AppId,
    updates: ProviderSortUpdate[],
    secret?: RemoteConnectionSecret,
  ): Promise<boolean> {
    return invoke<boolean>("remote_update_providers_sort_order", {
      profile,
      app,
      updates,
      secret,
    });
  },

  getUniversalProviders(
    profile: RemoteHostProfile,
    secret?: RemoteConnectionSecret,
  ): Promise<UniversalProvidersMap> {
    return invoke<UniversalProvidersMap>("remote_get_universal_providers", {
      profile,
      secret,
    });
  },

  getUniversalProvider(
    profile: RemoteHostProfile,
    id: string,
    secret?: RemoteConnectionSecret,
  ): Promise<UniversalProvider | null> {
    return invoke<UniversalProvider | null>("remote_get_universal_provider", {
      profile,
      id,
      secret,
    });
  },

  upsertUniversalProvider(
    profile: RemoteHostProfile,
    provider: UniversalProvider,
    secret?: RemoteConnectionSecret,
  ): Promise<boolean> {
    return invoke<boolean>("remote_upsert_universal_provider", {
      profile,
      provider,
      secret,
    });
  },

  deleteUniversalProvider(
    profile: RemoteHostProfile,
    id: string,
    secret?: RemoteConnectionSecret,
  ): Promise<boolean> {
    return invoke<boolean>("remote_delete_universal_provider", {
      profile,
      id,
      secret,
    });
  },

  syncUniversalProvider(
    profile: RemoteHostProfile,
    id: string,
    secret?: RemoteConnectionSecret,
  ): Promise<boolean> {
    return invoke<boolean>("remote_sync_universal_provider", {
      profile,
      id,
      secret,
    });
  },

  getRoutingGlobalConfig(
    profile: RemoteHostProfile,
    secret?: RemoteConnectionSecret,
  ): Promise<GlobalProxyConfig> {
    return invoke<GlobalProxyConfig>("remote_get_routing_global_config", {
      profile,
      secret,
    });
  },

  updateRoutingGlobalConfig(
    profile: RemoteHostProfile,
    config: GlobalProxyConfig,
    secret?: RemoteConnectionSecret,
  ): Promise<void> {
    return invoke<void>("remote_update_routing_global_config", {
      profile,
      config,
      secret,
    });
  },

  getRoutingAppConfig(
    profile: RemoteHostProfile,
    appType: string,
    secret?: RemoteConnectionSecret,
  ): Promise<AppProxyConfig> {
    return invoke<AppProxyConfig>("remote_get_routing_app_config", {
      profile,
      appType,
      secret,
    });
  },

  updateRoutingAppConfig(
    profile: RemoteHostProfile,
    config: AppProxyConfig,
    secret?: RemoteConnectionSecret,
  ): Promise<void> {
    return invoke<void>("remote_update_routing_app_config", {
      profile,
      config,
      secret,
    });
  },

  getRoutingFailoverQueue(
    profile: RemoteHostProfile,
    appType: string,
    secret?: RemoteConnectionSecret,
  ): Promise<FailoverQueueItem[]> {
    return invoke<FailoverQueueItem[]>("remote_get_routing_failover_queue", {
      profile,
      appType,
      secret,
    });
  },

  getAvailableProvidersForFailover(
    profile: RemoteHostProfile,
    appType: string,
    secret?: RemoteConnectionSecret,
  ): Promise<Provider[]> {
    return invoke<Provider[]>("remote_get_available_providers_for_failover", {
      profile,
      appType,
      secret,
    });
  },

  addToFailoverQueue(
    profile: RemoteHostProfile,
    appType: string,
    providerId: string,
    secret?: RemoteConnectionSecret,
  ): Promise<void> {
    return invoke<void>("remote_add_to_failover_queue", {
      profile,
      appType,
      providerId,
      secret,
    });
  },

  removeFromFailoverQueue(
    profile: RemoteHostProfile,
    appType: string,
    providerId: string,
    secret?: RemoteConnectionSecret,
  ): Promise<void> {
    return invoke<void>("remote_remove_from_failover_queue", {
      profile,
      appType,
      providerId,
      secret,
    });
  },

  getAutoFailoverEnabled(
    profile: RemoteHostProfile,
    appType: string,
    secret?: RemoteConnectionSecret,
  ): Promise<boolean> {
    return invoke<boolean>("remote_get_auto_failover_enabled", {
      profile,
      appType,
      secret,
    });
  },

  setAutoFailoverEnabled(
    profile: RemoteHostProfile,
    appType: string,
    enabled: boolean,
    secret?: RemoteConnectionSecret,
  ): Promise<void> {
    return invoke<void>("remote_set_auto_failover_enabled", {
      profile,
      appType,
      enabled,
      secret,
    });
  },

  getRoutingProviderHealth(
    profile: RemoteHostProfile,
    providerId: string,
    appType: string,
    secret?: RemoteConnectionSecret,
  ): Promise<ProviderHealth> {
    return invoke<ProviderHealth>("remote_get_routing_provider_health", {
      profile,
      providerId,
      appType,
      secret,
    });
  },

  resetRoutingCircuitBreaker(
    profile: RemoteHostProfile,
    providerId: string,
    appType: string,
    secret?: RemoteConnectionSecret,
  ): Promise<void> {
    return invoke<void>("remote_reset_routing_circuit_breaker", {
      profile,
      providerId,
      appType,
      secret,
    });
  },

  getRoutingCircuitBreakerConfig(
    profile: RemoteHostProfile,
    secret?: RemoteConnectionSecret,
  ): Promise<CircuitBreakerConfig> {
    return invoke<CircuitBreakerConfig>(
      "remote_get_routing_circuit_breaker_config",
      {
        profile,
        secret,
      },
    );
  },

  updateRoutingCircuitBreakerConfig(
    profile: RemoteHostProfile,
    config: CircuitBreakerConfig,
    secret?: RemoteConnectionSecret,
  ): Promise<void> {
    return invoke<void>("remote_update_routing_circuit_breaker_config", {
      profile,
      config,
      secret,
    });
  },

  getRoutingCircuitBreakerStats(
    profile: RemoteHostProfile,
    providerId: string,
    appType: string,
    secret?: RemoteConnectionSecret,
  ): Promise<CircuitBreakerStats | null> {
    return invoke<CircuitBreakerStats | null>(
      "remote_get_routing_circuit_breaker_stats",
      {
        profile,
        providerId,
        appType,
        secret,
      },
    );
  },

  getRoutingRectifierConfig(
    profile: RemoteHostProfile,
    secret?: RemoteConnectionSecret,
  ): Promise<RectifierConfig> {
    return invoke<RectifierConfig>("remote_get_routing_rectifier_config", {
      profile,
      secret,
    });
  },

  setRoutingRectifierConfig(
    profile: RemoteHostProfile,
    config: RectifierConfig,
    secret?: RemoteConnectionSecret,
  ): Promise<boolean> {
    return invoke<boolean>("remote_set_routing_rectifier_config", {
      profile,
      config,
      secret,
    });
  },

  getRoutingOptimizerConfig(
    profile: RemoteHostProfile,
    secret?: RemoteConnectionSecret,
  ): Promise<OptimizerConfig> {
    return invoke<OptimizerConfig>("remote_get_routing_optimizer_config", {
      profile,
      secret,
    });
  },

  setRoutingOptimizerConfig(
    profile: RemoteHostProfile,
    config: OptimizerConfig,
    secret?: RemoteConnectionSecret,
  ): Promise<boolean> {
    return invoke<boolean>("remote_set_routing_optimizer_config", {
      profile,
      config,
      secret,
    });
  },

  getRoutingGlobalOutboundProxy(
    profile: RemoteHostProfile,
    secret?: RemoteConnectionSecret,
  ): Promise<string | null> {
    return invoke<string | null>("remote_get_routing_global_outbound_proxy", {
      profile,
      secret,
    });
  },

  setRoutingGlobalOutboundProxy(
    profile: RemoteHostProfile,
    url: string,
    secret?: RemoteConnectionSecret,
  ): Promise<void> {
    return invoke<void>("remote_set_routing_global_outbound_proxy", {
      profile,
      url,
      secret,
    });
  },

  getRoutingRuntimeStatus(
    profile: RemoteHostProfile,
    secret?: RemoteConnectionSecret,
  ): Promise<ProxyStatus> {
    return invoke<ProxyStatus>("remote_get_routing_runtime_status", {
      profile,
      secret,
    });
  },

  startRoutingRuntime(
    profile: RemoteHostProfile,
    secret?: RemoteConnectionSecret,
  ): Promise<ProxyServerInfo> {
    return invoke<ProxyServerInfo>("remote_start_routing_runtime", {
      profile,
      secret,
    });
  },

  stopRoutingRuntime(
    profile: RemoteHostProfile,
    secret?: RemoteConnectionSecret,
  ): Promise<boolean> {
    return invoke<boolean>("remote_stop_routing_runtime", {
      profile,
      secret,
    });
  },

  listSessions(
    profile: RemoteHostProfile,
    secret?: RemoteConnectionSecret,
  ): Promise<SessionMeta[]> {
    return invoke<SessionMeta[]>("remote_list_sessions", {
      profile,
      secret,
    });
  },

  getSessionMessages(
    profile: RemoteHostProfile,
    providerId: string,
    sourcePath: string,
    secret?: RemoteConnectionSecret,
  ): Promise<SessionMessage[]> {
    return invoke<SessionMessage[]>("remote_get_session_messages", {
      profile,
      providerId,
      sourcePath,
      secret,
    });
  },

  deleteSession(
    profile: RemoteHostProfile,
    options: RemoteDeleteSessionOptions,
    secret?: RemoteConnectionSecret,
  ): Promise<boolean> {
    const { providerId, sessionId, sourcePath } = options;
    return invoke<boolean>("remote_delete_session", {
      profile,
      providerId,
      sessionId,
      sourcePath,
      secret,
    });
  },

  deleteSessions(
    profile: RemoteHostProfile,
    items: RemoteDeleteSessionOptions[],
    secret?: RemoteConnectionSecret,
  ): Promise<RemoteDeleteSessionResult[]> {
    return invoke<RemoteDeleteSessionResult[]>("remote_delete_sessions", {
      profile,
      items,
      secret,
    });
  },

  getHermesMemory(
    profile: RemoteHostProfile,
    kind: HermesMemoryKind,
    secret?: RemoteConnectionSecret,
  ): Promise<string> {
    return invoke<string>("remote_get_hermes_memory", {
      profile,
      kind,
      secret,
    });
  },

  getHermesModelConfig(
    profile: RemoteHostProfile,
    secret?: RemoteConnectionSecret,
  ): Promise<HermesModelConfig | null> {
    return invoke<HermesModelConfig | null>("remote_get_hermes_model_config", {
      profile,
      secret,
    });
  },

  setHermesMemory(
    profile: RemoteHostProfile,
    kind: HermesMemoryKind,
    content: string,
    secret?: RemoteConnectionSecret,
  ): Promise<void> {
    return invoke<void>("remote_set_hermes_memory", {
      profile,
      kind,
      content,
      secret,
    });
  },

  getHermesMemoryLimits(
    profile: RemoteHostProfile,
    secret?: RemoteConnectionSecret,
  ): Promise<HermesMemoryLimits> {
    return invoke<HermesMemoryLimits>("remote_get_hermes_memory_limits", {
      profile,
      secret,
    });
  },

  setHermesMemoryEnabled(
    profile: RemoteHostProfile,
    kind: HermesMemoryKind,
    enabled: boolean,
    secret?: RemoteConnectionSecret,
  ): Promise<void> {
    return invoke<void>("remote_set_hermes_memory_enabled", {
      profile,
      kind,
      enabled,
      secret,
    });
  },

  getOpenClawDefaultModel(
    profile: RemoteHostProfile,
    secret?: RemoteConnectionSecret,
  ): Promise<OpenClawDefaultModel | null> {
    return invoke<OpenClawDefaultModel | null>(
      "remote_get_openclaw_default_model",
      {
        profile,
        secret,
      },
    );
  },

  setOpenClawDefaultModel(
    profile: RemoteHostProfile,
    model: OpenClawDefaultModel,
    secret?: RemoteConnectionSecret,
  ): Promise<OpenClawWriteOutcome> {
    return invoke<OpenClawWriteOutcome>("remote_set_openclaw_default_model", {
      profile,
      model,
      secret,
    });
  },

  getOpenClawEnv(
    profile: RemoteHostProfile,
    secret?: RemoteConnectionSecret,
  ): Promise<OpenClawEnvConfig> {
    return invoke<OpenClawEnvConfig>("remote_get_openclaw_env", {
      profile,
      secret,
    });
  },

  setOpenClawEnv(
    profile: RemoteHostProfile,
    env: OpenClawEnvConfig,
    secret?: RemoteConnectionSecret,
  ): Promise<OpenClawWriteOutcome> {
    return invoke<OpenClawWriteOutcome>("remote_set_openclaw_env", {
      profile,
      env,
      secret,
    });
  },

  getOpenClawTools(
    profile: RemoteHostProfile,
    secret?: RemoteConnectionSecret,
  ): Promise<OpenClawToolsConfig> {
    return invoke<OpenClawToolsConfig>("remote_get_openclaw_tools", {
      profile,
      secret,
    });
  },

  setOpenClawTools(
    profile: RemoteHostProfile,
    tools: OpenClawToolsConfig,
    secret?: RemoteConnectionSecret,
  ): Promise<OpenClawWriteOutcome> {
    return invoke<OpenClawWriteOutcome>("remote_set_openclaw_tools", {
      profile,
      tools,
      secret,
    });
  },

  getOpenClawAgentsDefaults(
    profile: RemoteHostProfile,
    secret?: RemoteConnectionSecret,
  ): Promise<OpenClawAgentsDefaults | null> {
    return invoke<OpenClawAgentsDefaults | null>(
      "remote_get_openclaw_agents_defaults",
      {
        profile,
        secret,
      },
    );
  },

  setOpenClawAgentsDefaults(
    profile: RemoteHostProfile,
    defaults: OpenClawAgentsDefaults,
    secret?: RemoteConnectionSecret,
  ): Promise<OpenClawWriteOutcome> {
    return invoke<OpenClawWriteOutcome>("remote_set_openclaw_agents_defaults", {
      profile,
      defaults,
      secret,
    });
  },

  getMcpServers(
    profile: RemoteHostProfile,
    secret?: RemoteConnectionSecret,
  ): Promise<McpServersMap> {
    return invoke<McpServersMap>("remote_get_mcp_servers", {
      profile,
      secret,
    });
  },

  upsertMcpServer(
    profile: RemoteHostProfile,
    server: McpServer,
    secret?: RemoteConnectionSecret,
  ): Promise<void> {
    return invoke<void>("remote_upsert_mcp_server", {
      profile,
      server,
      secret,
    });
  },

  deleteMcpServer(
    profile: RemoteHostProfile,
    id: string,
    secret?: RemoteConnectionSecret,
  ): Promise<boolean> {
    return invoke<boolean>("remote_delete_mcp_server", {
      profile,
      id,
      secret,
    });
  },

  toggleMcpApp(
    profile: RemoteHostProfile,
    serverId: string,
    app: AppId,
    enabled: boolean,
    secret?: RemoteConnectionSecret,
  ): Promise<void> {
    return invoke<void>("remote_toggle_mcp_app", {
      profile,
      serverId,
      app,
      enabled,
      secret,
    });
  },

  importMcpFromApps(
    profile: RemoteHostProfile,
    secret?: RemoteConnectionSecret,
  ): Promise<number> {
    return invoke<number>("remote_import_mcp_from_apps", {
      profile,
      secret,
    });
  },

  getPrompts(
    profile: RemoteHostProfile,
    app: AppId,
    secret?: RemoteConnectionSecret,
  ): Promise<Record<string, Prompt>> {
    return invoke<Record<string, Prompt>>("remote_get_prompts", {
      profile,
      app,
      secret,
    });
  },

  upsertPrompt(
    profile: RemoteHostProfile,
    app: AppId,
    id: string,
    prompt: Prompt,
    secret?: RemoteConnectionSecret,
  ): Promise<void> {
    return invoke<void>("remote_upsert_prompt", {
      profile,
      app,
      id,
      prompt,
      secret,
    });
  },

  deletePrompt(
    profile: RemoteHostProfile,
    app: AppId,
    id: string,
    secret?: RemoteConnectionSecret,
  ): Promise<void> {
    return invoke<void>("remote_delete_prompt", {
      profile,
      app,
      id,
      secret,
    });
  },

  enablePrompt(
    profile: RemoteHostProfile,
    app: AppId,
    id: string,
    secret?: RemoteConnectionSecret,
  ): Promise<void> {
    return invoke<void>("remote_enable_prompt", {
      profile,
      app,
      id,
      secret,
    });
  },

  importPromptFromFile(
    profile: RemoteHostProfile,
    app: AppId,
    secret?: RemoteConnectionSecret,
  ): Promise<string> {
    return invoke<string>("remote_import_prompt_from_file", {
      profile,
      app,
      secret,
    });
  },

  getCurrentPromptFileContent(
    profile: RemoteHostProfile,
    app: AppId,
    secret?: RemoteConnectionSecret,
  ): Promise<string | null> {
    return invoke<string | null>("remote_get_current_prompt_file_content", {
      profile,
      app,
      secret,
    });
  },

  getInstalledSkills(
    profile: RemoteHostProfile,
    secret?: RemoteConnectionSecret,
  ): Promise<InstalledSkill[]> {
    return invoke<InstalledSkill[]>("remote_get_installed_skills", {
      profile,
      secret,
    });
  },

  getSkillBackups(
    profile: RemoteHostProfile,
    secret?: RemoteConnectionSecret,
  ): Promise<SkillBackupEntry[]> {
    return invoke<SkillBackupEntry[]>("remote_get_skill_backups", {
      profile,
      secret,
    });
  },

  deleteSkillBackup(
    profile: RemoteHostProfile,
    backupId: string,
    secret?: RemoteConnectionSecret,
  ): Promise<boolean> {
    return invoke<boolean>("remote_delete_skill_backup", {
      profile,
      backupId,
      secret,
    });
  },

  installSkillUnified(
    profile: RemoteHostProfile,
    skill: DiscoverableSkill,
    currentApp: AppId,
    secret?: RemoteConnectionSecret,
  ): Promise<InstalledSkill> {
    return invoke<InstalledSkill>("remote_install_skill_unified", {
      profile,
      skill,
      currentApp,
      secret,
    });
  },

  uninstallSkillUnified(
    profile: RemoteHostProfile,
    id: string,
    secret?: RemoteConnectionSecret,
  ): Promise<SkillUninstallResult> {
    return invoke<SkillUninstallResult>("remote_uninstall_skill_unified", {
      profile,
      id,
      secret,
    });
  },

  restoreSkillBackup(
    profile: RemoteHostProfile,
    backupId: string,
    currentApp: AppId,
    secret?: RemoteConnectionSecret,
  ): Promise<InstalledSkill> {
    return invoke<InstalledSkill>("remote_restore_skill_backup", {
      profile,
      backupId,
      currentApp,
      secret,
    });
  },

  toggleSkillApp(
    profile: RemoteHostProfile,
    id: string,
    app: AppId,
    enabled: boolean,
    secret?: RemoteConnectionSecret,
  ): Promise<boolean> {
    return invoke<boolean>("remote_toggle_skill_app", {
      profile,
      id,
      app,
      enabled,
      secret,
    });
  },

  scanUnmanagedSkills(
    profile: RemoteHostProfile,
    secret?: RemoteConnectionSecret,
  ): Promise<UnmanagedSkill[]> {
    return invoke<UnmanagedSkill[]>("remote_scan_unmanaged_skills", {
      profile,
      secret,
    });
  },

  importSkillsFromApps(
    profile: RemoteHostProfile,
    imports: ImportSkillSelection[],
    secret?: RemoteConnectionSecret,
  ): Promise<InstalledSkill[]> {
    return invoke<InstalledSkill[]>("remote_import_skills_from_apps", {
      profile,
      imports,
      secret,
    });
  },

  discoverAvailableSkills(
    profile: RemoteHostProfile,
    secret?: RemoteConnectionSecret,
  ): Promise<DiscoverableSkill[]> {
    return invoke<DiscoverableSkill[]>("remote_discover_available_skills", {
      profile,
      secret,
    });
  },

  checkSkillUpdates(
    profile: RemoteHostProfile,
    secret?: RemoteConnectionSecret,
  ): Promise<SkillUpdateInfo[]> {
    return invoke<SkillUpdateInfo[]>("remote_check_skill_updates", {
      profile,
      secret,
    });
  },

  updateSkill(
    profile: RemoteHostProfile,
    id: string,
    secret?: RemoteConnectionSecret,
  ): Promise<InstalledSkill> {
    return invoke<InstalledSkill>("remote_update_skill", {
      profile,
      id,
      secret,
    });
  },

  getSkillRepos(
    profile: RemoteHostProfile,
    secret?: RemoteConnectionSecret,
  ): Promise<SkillRepo[]> {
    return invoke<SkillRepo[]>("remote_get_skill_repos", {
      profile,
      secret,
    });
  },

  addSkillRepo(
    profile: RemoteHostProfile,
    repo: SkillRepo,
    secret?: RemoteConnectionSecret,
  ): Promise<boolean> {
    return invoke<boolean>("remote_add_skill_repo", {
      profile,
      repo,
      secret,
    });
  },

  removeSkillRepo(
    profile: RemoteHostProfile,
    owner: string,
    name: string,
    secret?: RemoteConnectionSecret,
  ): Promise<boolean> {
    return invoke<boolean>("remote_remove_skill_repo", {
      profile,
      owner,
      name,
      secret,
    });
  },
};
