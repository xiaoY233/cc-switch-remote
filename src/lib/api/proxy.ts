import { invoke } from "@tauri-apps/api/core";
import type {
  ProxyConfig,
  ProxyStatus,
  ProxyServerInfo,
  ProxyTakeoverStatus,
  GlobalProxyConfig,
  AppProxyConfig,
} from "@/types/proxy";
import { LOCAL_MANAGEMENT_TARGET } from "@/lib/managementTarget";
import { remoteApi, type ManagementTarget } from "./remote";

export const proxyApi = {
  // ========== 代理服务器控制 API ==========

  // 启动代理服务器
  async startProxyServer(
    target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
  ): Promise<ProxyServerInfo> {
    if (target.type === "remote") {
      return remoteApi.startRoutingRuntime(target.profile, target.secret);
    }
    return invoke("start_proxy_server");
  },

  // 停止代理服务器并恢复配置
  async stopProxyWithRestore(
    target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
  ): Promise<void> {
    if (target.type === "remote") {
      await remoteApi.stopRoutingRuntime(target.profile, target.secret);
      return;
    }
    return invoke("stop_proxy_with_restore");
  },

  // 获取代理服务器状态
  async getProxyStatus(
    target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
  ): Promise<ProxyStatus> {
    if (target.type === "remote") {
      return remoteApi.getRoutingRuntimeStatus(target.profile, target.secret);
    }
    return invoke("get_proxy_status");
  },

  // 检查代理服务器是否正在运行
  async isProxyRunning(): Promise<boolean> {
    return invoke("is_proxy_running");
  },

  // 检查是否处于接管模式
  async isLiveTakeoverActive(): Promise<boolean> {
    return invoke("is_live_takeover_active");
  },

  // 代理模式下切换供应商
  async switchProxyProvider(
    appType: string,
    providerId: string,
  ): Promise<void> {
    return invoke("switch_proxy_provider", { appType, providerId });
  },

  // ========== 接管状态 API ==========

  // 获取各应用接管状态
  async getProxyTakeoverStatus(): Promise<ProxyTakeoverStatus> {
    return invoke("get_proxy_takeover_status");
  },

  // 为指定应用开启/关闭接管
  async setProxyTakeoverForApp(
    appType: string,
    enabled: boolean,
  ): Promise<void> {
    return invoke("set_proxy_takeover_for_app", { appType, enabled });
  },

  // ========== Legacy 代理配置 API (兼容) ==========

  // 获取代理配置（旧版 v2 兼容接口）
  async getProxyConfig(): Promise<ProxyConfig> {
    return invoke("get_proxy_config");
  },

  // 更新代理配置（旧版 v2 兼容接口）
  async updateProxyConfig(config: ProxyConfig): Promise<void> {
    return invoke("update_proxy_config", { config });
  },

  // ========== v3+ 全局/应用级配置 API ==========

  // 获取全局代理配置
  async getGlobalProxyConfig(
    target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
  ): Promise<GlobalProxyConfig> {
    if (target.type === "remote") {
      return remoteApi.getRoutingGlobalConfig(target.profile, target.secret);
    }
    return invoke("get_global_proxy_config");
  },

  // 更新全局代理配置
  async updateGlobalProxyConfig(
    config: GlobalProxyConfig,
    target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
  ): Promise<void> {
    if (target.type === "remote") {
      return remoteApi.updateRoutingGlobalConfig(
        target.profile,
        config,
        target.secret,
      );
    }
    return invoke("update_global_proxy_config", { config });
  },

  // 获取指定应用的代理配置
  async getProxyConfigForApp(
    appType: string,
    target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
  ): Promise<AppProxyConfig> {
    if (target.type === "remote") {
      return remoteApi.getRoutingAppConfig(
        target.profile,
        appType,
        target.secret,
      );
    }
    return invoke("get_proxy_config_for_app", { appType });
  },

  // 更新指定应用的代理配置
  async updateProxyConfigForApp(
    config: AppProxyConfig,
    target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
  ): Promise<void> {
    if (target.type === "remote") {
      return remoteApi.updateRoutingAppConfig(
        target.profile,
        config,
        target.secret,
      );
    }
    return invoke("update_proxy_config_for_app", { config });
  },

  // ========== 计费默认配置 API ==========

  // 获取默认成本倍率
  async getDefaultCostMultiplier(
    appType: string,
    target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
  ): Promise<string> {
    if (target.type === "remote") {
      return remoteApi.getDefaultCostMultiplier(
        target.profile,
        appType,
        target.secret,
      );
    }
    return invoke("get_default_cost_multiplier", { appType });
  },

  // 设置默认成本倍率
  async setDefaultCostMultiplier(
    appType: string,
    value: string,
    target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
  ): Promise<void> {
    if (target.type === "remote") {
      return remoteApi.setDefaultCostMultiplier(
        target.profile,
        appType,
        value,
        target.secret,
      );
    }
    return invoke("set_default_cost_multiplier", { appType, value });
  },

  // 获取计费模式来源
  async getPricingModelSource(
    appType: string,
    target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
  ): Promise<string> {
    if (target.type === "remote") {
      return remoteApi.getPricingModelSource(
        target.profile,
        appType,
        target.secret,
      );
    }
    return invoke("get_pricing_model_source", { appType });
  },

  // 设置计费模式来源
  async setPricingModelSource(
    appType: string,
    value: string,
    target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
  ): Promise<void> {
    if (target.type === "remote") {
      return remoteApi.setPricingModelSource(
        target.profile,
        appType,
        value,
        target.secret,
      );
    }
    return invoke("set_pricing_model_source", { appType, value });
  },
};
