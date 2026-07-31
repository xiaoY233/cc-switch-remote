import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { proxyApi } from "@/lib/api/proxy";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import type {
  GlobalProxyConfig,
  AppProxyConfig,
  ProxyTakeoverStatus,
} from "@/types/proxy";
import type { ManagementTarget } from "@/lib/api/remote";
import {
  getManagementTargetKey,
  LOCAL_MANAGEMENT_TARGET,
} from "@/lib/managementTarget";

export const proxyKeys = {
  status: (target: ManagementTarget = LOCAL_MANAGEMENT_TARGET) =>
    ["proxyStatus", getManagementTargetKey(target)] as const,
  takeoverStatus: (target: ManagementTarget = LOCAL_MANAGEMENT_TARGET) =>
    ["proxyTakeoverStatus", getManagementTargetKey(target)] as const,
  globalConfig: (target: ManagementTarget = LOCAL_MANAGEMENT_TARGET) =>
    ["globalProxyConfig", getManagementTargetKey(target)] as const,
  appConfig: (
    appType: string,
    target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
  ) => ["appProxyConfig", getManagementTargetKey(target), appType] as const,
};

// ========== 代理服务器状态 Hooks ==========

/**
 * 获取代理服务器状态
 */
export function useProxyStatusQuery(
  target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
) {
  return useQuery({
    queryKey: proxyKeys.status(target),
    queryFn: () => proxyApi.getProxyStatus(target),
    // 仅在服务运行时轮询
    refetchInterval: (query) => (query.state.data?.running ? 2000 : false),
    // 保持之前的数据，避免闪烁
    placeholderData: (previousData) => previousData,
  });
}

/**
 * 获取各应用接管状态
 */
export function useProxyTakeoverStatus(
  target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
  poll = true,
) {
  return useQuery({
    queryKey: proxyKeys.takeoverStatus(target),
    queryFn: () => proxyApi.getProxyTakeoverStatus(),
    enabled: target.type === "local",
    refetchInterval: poll ? 2000 : false,
    ...(poll
      ? {}
      : {
          placeholderData: (previousData: ProxyTakeoverStatus | undefined) =>
            previousData,
        }),
  });
}

// ========== 代理服务器控制 Hooks ==========

/**
 * 设置应用接管状态
 */
export function useSetProxyTakeoverForApp() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ appType, enabled }: { appType: string; enabled: boolean }) =>
      proxyApi.setProxyTakeoverForApp(appType, enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: proxyKeys.takeoverStatus(),
      });
    },
  });
}

// ========== v3+ 全局/应用级配置 Hooks ==========

/**
 * 获取全局代理配置
 */
export function useGlobalProxyConfig(
  target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
) {
  return useQuery({
    queryKey: proxyKeys.globalConfig(target),
    queryFn: () => proxyApi.getGlobalProxyConfig(target),
  });
}

/**
 * 更新全局代理配置
 */
export function useUpdateGlobalProxyConfig(
  target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
) {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: (config: GlobalProxyConfig) =>
      proxyApi.updateGlobalProxyConfig(config, target),
    onSuccess: () => {
      toast.success(t("proxy.settings.toast.saved"), { closeButton: true });
      queryClient.invalidateQueries({
        queryKey: proxyKeys.globalConfig(target),
      });
      queryClient.invalidateQueries({
        queryKey: proxyKeys.status(target),
      });
      if (target.type === "local") {
        queryClient.invalidateQueries({ queryKey: ["proxyConfig"] });
        queryClient.invalidateQueries({ queryKey: ["proxyStatus"] });
      }
    },
    onError: (error: Error) => {
      toast.error(
        t("proxy.settings.toast.saveFailed", { error: error.message }),
      );
    },
  });
}

/**
 * 获取指定应用的代理配置
 */
export function useAppProxyConfig(
  appType: string,
  target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
  enabled = true,
) {
  return useQuery({
    queryKey: proxyKeys.appConfig(appType, target),
    queryFn: () => proxyApi.getProxyConfigForApp(appType, target),
    enabled: enabled && !!appType,
  });
}

/**
 * 获取指定应用启用远程路由的前置条件
 */
export function useRoutingAppPreflight(
  appType: string,
  target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
  enabled = true,
) {
  const targetKey = getManagementTargetKey(target);
  return useQuery({
    queryKey: ["routingAppPreflight", targetKey, appType],
    queryFn: () => proxyApi.preflightRoutingApp(appType, target),
    enabled: enabled && !!appType,
    staleTime: target.type === "remote" ? 10_000 : Infinity,
  });
}

/**
 * 更新指定应用的代理配置
 */
export function useUpdateAppProxyConfig(
  target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
) {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const targetKey = getManagementTargetKey(target);

  return useMutation({
    mutationFn: (config: AppProxyConfig) =>
      proxyApi.updateProxyConfigForApp(config, target),
    onSuccess: (_, variables) => {
      toast.success(t("proxy.settings.toast.saved"), { closeButton: true });
      queryClient.invalidateQueries({
        queryKey: proxyKeys.appConfig(variables.appType, target),
      });
      queryClient.invalidateQueries({
        queryKey: ["routingAppPreflight", targetKey, variables.appType],
      });
      queryClient.invalidateQueries({
        queryKey: proxyKeys.status(target),
      });
      queryClient.invalidateQueries({
        queryKey: ["autoFailoverEnabled", targetKey, variables.appType],
      });
      if (target.type === "local") {
        queryClient.invalidateQueries({
          queryKey: ["autoFailoverEnabled", variables.appType],
        });
        queryClient.invalidateQueries({ queryKey: ["proxyConfig"] });
        queryClient.invalidateQueries({ queryKey: ["circuitBreakerConfig"] });
        queryClient.invalidateQueries({ queryKey: ["proxyStatus"] });
      }
    },
    onError: (error: Error) => {
      toast.error(
        t("proxy.settings.toast.saveFailed", { error: error.message }),
      );
    },
  });
}
