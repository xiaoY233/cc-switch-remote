import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  Provider,
  UniversalProvider,
  UniversalProvidersMap,
} from "@/types";
import type { AppId } from "./types";
import { remoteApi, type ManagementTarget } from "./remote";

export interface ProviderSortUpdate {
  id: string;
  sortIndex: number;
}

export interface ProviderSwitchEvent {
  appType: AppId;
  providerId: string;
}

export interface SwitchResult {
  warnings: string[];
}

export interface OpenTerminalOptions {
  cwd?: string;
}

export interface ClaudeDesktopStatus {
  supported: boolean;
  configured: boolean;
  appliedId?: string | null;
  profilePath?: string | null;
  configLibraryPath?: string | null;
  mode?: "direct" | "proxy" | null;
  expectedBaseUrl?: string | null;
  actualBaseUrl?: string | null;
  proxyRunning: boolean;
  staleRawModels: boolean;
  missingRouteMappings: boolean;
  gatewayTokenConfigured: boolean;
}

export interface ClaudeDesktopDefaultRoute {
  routeId: string;
  envKey: string;
  supports1m: boolean;
}

export const providersApi = {
  async getState(
    appId: AppId,
    target: ManagementTarget = { type: "local" },
  ): Promise<{
    providers: Record<string, Provider>;
    currentProviderId: string;
  }> {
    if (target.type === "remote") {
      return await remoteApi.getProviderState(
        target.profile,
        appId,
        target.secret,
      );
    }
    const [providers, currentProviderId] = await Promise.all([
      this.getAll(appId, target),
      this.getCurrent(appId, target),
    ]);
    return { providers, currentProviderId };
  },

  async getAll(
    appId: AppId,
    target: ManagementTarget = { type: "local" },
  ): Promise<Record<string, Provider>> {
    if (target.type === "remote") {
      return await remoteApi.getProviders(target.profile, appId, target.secret);
    }
    return await invoke("get_providers", { app: appId });
  },

  async getCurrent(
    appId: AppId,
    target: ManagementTarget = { type: "local" },
  ): Promise<string> {
    if (target.type === "remote") {
      return await remoteApi.getCurrentProvider(
        target.profile,
        appId,
        target.secret,
      );
    }
    return await invoke("get_current_provider", { app: appId });
  },

  async add(
    provider: Provider,
    appId: AppId,
    addToLive?: boolean,
    target: ManagementTarget = { type: "local" },
  ): Promise<boolean> {
    if (target.type === "remote") {
      return await remoteApi.addProvider(
        target.profile,
        appId,
        provider,
        addToLive,
        target.secret,
      );
    }
    return await invoke("add_provider", { provider, app: appId, addToLive });
  },

  async update(
    provider: Provider,
    appId: AppId,
    originalId?: string,
    target: ManagementTarget = { type: "local" },
  ): Promise<boolean> {
    if (target.type === "remote") {
      return await remoteApi.updateProvider(
        target.profile,
        appId,
        provider,
        originalId,
        target.secret,
      );
    }
    return await invoke("update_provider", {
      provider,
      app: appId,
      originalId,
    });
  },

  async delete(
    id: string,
    appId: AppId,
    target: ManagementTarget = { type: "local" },
  ): Promise<boolean> {
    if (target.type === "remote") {
      return await remoteApi.deleteProvider(
        target.profile,
        appId,
        id,
        target.secret,
      );
    }
    return await invoke("delete_provider", { id, app: appId });
  },

  /**
   * Remove provider from live config only (for additive mode apps like OpenCode)
   * Does NOT delete from database - provider remains in the list
   */
  async removeFromLiveConfig(
    id: string,
    appId: AppId,
    target: ManagementTarget = { type: "local" },
  ): Promise<boolean> {
    if (target.type === "remote") {
      return await remoteApi.removeProviderFromLiveConfig(
        target.profile,
        appId,
        id,
        target.secret,
      );
    }
    return await invoke("remove_provider_from_live_config", { id, app: appId });
  },

  async switch(
    id: string,
    appId: AppId,
    target: ManagementTarget = { type: "local" },
  ): Promise<SwitchResult> {
    if (target.type === "remote") {
      return await remoteApi.switchProvider(
        target.profile,
        appId,
        id,
        target.secret,
      );
    }
    return await invoke("switch_provider", { id, app: appId });
  },

  async importDefault(appId: AppId): Promise<boolean> {
    return await invoke("import_default_config", { app: appId });
  },

  async importCurrent(
    appId: AppId,
    target: ManagementTarget = { type: "local" },
  ): Promise<boolean> {
    if (target.type === "remote") {
      return await remoteApi.importProviders(
        target.profile,
        appId,
        target.secret,
      );
    }
    if (appId === "opencode") {
      const count = await providersApi.importOpenCodeFromLive();
      return count > 0;
    }
    if (appId === "openclaw") {
      const count = await providersApi.importOpenClawFromLive();
      return count > 0;
    }
    if (appId === "hermes") {
      const count = await providersApi.importHermesFromLive();
      return count > 0;
    }
    if (appId === "claude-desktop") {
      const count = await providersApi.importClaudeDesktopFromClaude();
      return count > 0;
    }
    return providersApi.importDefault(appId);
  },

  async importClaudeDesktopFromClaude(): Promise<number> {
    return await invoke("import_claude_desktop_providers_from_claude");
  },

  async ensureClaudeDesktopOfficialProvider(
    target: ManagementTarget = { type: "local" },
  ): Promise<boolean> {
    if (target.type === "remote") {
      return await remoteApi.ensureOfficialProvider(
        target.profile,
        "claude-desktop",
        target.secret,
      );
    }
    return await invoke("ensure_claude_desktop_official_provider");
  },

  async ensureCodexOfficialProvider(
    target: ManagementTarget = { type: "local" },
  ): Promise<boolean> {
    if (target.type === "remote") {
      return await remoteApi.ensureOfficialProvider(
        target.profile,
        "codex",
        target.secret,
      );
    }
    return await invoke("ensure_codex_official_provider");
  },

  async ensureGrokBuildOfficialProvider(
    target: ManagementTarget = { type: "local" },
  ): Promise<boolean> {
    if (target.type === "remote") {
      return await remoteApi.ensureOfficialProvider(
        target.profile,
        "grokbuild",
        target.secret,
      );
    }
    return await invoke("ensure_grokbuild_official_provider");
  },

  async getClaudeDesktopStatus(): Promise<ClaudeDesktopStatus> {
    return await invoke("get_claude_desktop_status");
  },

  async getClaudeDesktopDefaultRoutes(): Promise<ClaudeDesktopDefaultRoute[]> {
    return await invoke("get_claude_desktop_default_routes");
  },

  async updateTrayMenu(): Promise<boolean> {
    return await invoke("update_tray_menu");
  },

  async updateSortOrder(
    updates: ProviderSortUpdate[],
    appId: AppId,
    target: ManagementTarget = { type: "local" },
  ): Promise<boolean> {
    if (target.type === "remote") {
      return await remoteApi.updateProviderSortOrder(
        target.profile,
        appId,
        updates,
        target.secret,
      );
    }
    return await invoke("update_providers_sort_order", { updates, app: appId });
  },

  async onSwitched(
    handler: (event: ProviderSwitchEvent) => void,
  ): Promise<UnlistenFn> {
    return await listen("provider-switched", (event) => {
      const payload = event.payload as ProviderSwitchEvent;
      handler(payload);
    });
  },

  /**
   * 打开指定提供商的终端
   * 任何提供商都可以打开终端，不受是否为当前激活提供商的限制
   * 终端会使用该提供商特定的 API 配置，不影响全局设置
   */
  async openTerminal(
    providerId: string,
    appId: AppId,
    options?: OpenTerminalOptions,
  ): Promise<boolean> {
    const { cwd } = options ?? {};
    return await invoke("open_provider_terminal", {
      providerId,
      app: appId,
      cwd,
    });
  },

  /**
   * 从 OpenCode live 配置导入供应商到数据库
   * OpenCode 特有功能：由于累加模式，用户可能已在 opencode.json 中配置供应商
   */
  async importOpenCodeFromLive(): Promise<number> {
    return await invoke("import_opencode_providers_from_live");
  },

  /**
   * 获取 OpenCode live 配置中的供应商 ID 列表
   * 用于前端判断供应商是否已添加到 opencode.json
   */
  async getOpenCodeLiveProviderIds(
    target: ManagementTarget = { type: "local" },
  ): Promise<string[]> {
    if (target.type === "remote") {
      return await remoteApi.getLiveProviderIds(
        target.profile,
        "opencode",
        target.secret,
      );
    }
    return await invoke("get_opencode_live_provider_ids");
  },

  /**
   * 获取 OpenClaw live 配置中的供应商 ID 列表
   * 用于前端判断供应商是否已添加到 openclaw.json
   */
  async getOpenClawLiveProviderIds(
    target: ManagementTarget = { type: "local" },
  ): Promise<string[]> {
    if (target.type === "remote") {
      return await remoteApi.getLiveProviderIds(
        target.profile,
        "openclaw",
        target.secret,
      );
    }
    return await invoke("get_openclaw_live_provider_ids");
  },

  /**
   * 获取 Hermes live 配置中的供应商 ID 列表
   * 用于前端判断供应商是否已添加到 Hermes 配置
   */
  async getHermesLiveProviderIds(
    target: ManagementTarget = { type: "local" },
  ): Promise<string[]> {
    if (target.type === "remote") {
      return await remoteApi.getLiveProviderIds(
        target.profile,
        "hermes",
        target.secret,
      );
    }
    return await invoke("get_hermes_live_provider_ids");
  },

  /**
   * 从 OpenClaw live 配置导入供应商到数据库
   * OpenClaw 特有功能：由于累加模式，用户可能已在 openclaw.json 中配置供应商
   */
  async importOpenClawFromLive(): Promise<number> {
    return await invoke("import_openclaw_providers_from_live");
  },

  /**
   * 从 Hermes live 配置导入供应商到数据库
   * Hermes 特有功能：由于累加模式，用户可能已在 Hermes 配置中配置供应商
   */
  async importHermesFromLive(): Promise<number> {
    return await invoke("import_hermes_providers_from_live");
  },
};

// ============================================================================
// 统一供应商（Universal Provider）API
// ============================================================================

export const universalProvidersApi = {
  /**
   * 获取所有统一供应商
   */
  async getAll(
    target: ManagementTarget = { type: "local" },
  ): Promise<UniversalProvidersMap> {
    if (target.type === "remote") {
      return await remoteApi.getUniversalProviders(
        target.profile,
        target.secret,
      );
    }
    return await invoke("get_universal_providers");
  },

  /**
   * 获取单个统一供应商
   */
  async get(
    id: string,
    target: ManagementTarget = { type: "local" },
  ): Promise<UniversalProvider | null> {
    if (target.type === "remote") {
      return await remoteApi.getUniversalProvider(
        target.profile,
        id,
        target.secret,
      );
    }
    return await invoke("get_universal_provider", { id });
  },

  /**
   * 添加或更新统一供应商
   */
  async upsert(
    provider: UniversalProvider,
    target: ManagementTarget = { type: "local" },
  ): Promise<boolean> {
    if (target.type === "remote") {
      return await remoteApi.upsertUniversalProvider(
        target.profile,
        provider,
        target.secret,
      );
    }
    return await invoke("upsert_universal_provider", { provider });
  },

  /**
   * 删除统一供应商
   */
  async delete(
    id: string,
    target: ManagementTarget = { type: "local" },
  ): Promise<boolean> {
    if (target.type === "remote") {
      return await remoteApi.deleteUniversalProvider(
        target.profile,
        id,
        target.secret,
      );
    }
    return await invoke("delete_universal_provider", { id });
  },

  /**
   * 手动同步统一供应商到各应用
   */
  async sync(
    id: string,
    target: ManagementTarget = { type: "local" },
  ): Promise<boolean> {
    if (target.type === "remote") {
      return await remoteApi.syncUniversalProvider(
        target.profile,
        id,
        target.secret,
      );
    }
    return await invoke("sync_universal_provider", { id });
  },
};
