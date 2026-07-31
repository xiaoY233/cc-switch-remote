import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { failoverApi } from "@/lib/api/failover";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { extractErrorMessage } from "@/utils/errorUtils";
import type { ManagementTarget } from "@/lib/api/remote";
import {
  getManagementTargetKey,
  LOCAL_MANAGEMENT_TARGET,
} from "@/lib/managementTarget";
import type { QueryClient } from "@tanstack/react-query";
import { proxyKeys } from "@/lib/query/proxy";

function invalidateProvidersForTarget(
  queryClient: QueryClient,
  target: ManagementTarget,
  targetKey: string,
  appType: string,
) {
  queryClient.invalidateQueries({
    queryKey: ["providers", appType, targetKey],
  });
  if (target.type === "local") {
    queryClient.invalidateQueries({
      queryKey: ["providers", appType],
    });
  }
}

function invalidateProxyStatusForTarget(
  queryClient: QueryClient,
  target: ManagementTarget,
) {
  queryClient.invalidateQueries({
    queryKey: proxyKeys.status(target),
  });
  if (target.type === "local") {
    queryClient.invalidateQueries({
      queryKey: ["proxyStatus"],
    });
  }
}

function invalidateProviderHealthForTarget(
  queryClient: QueryClient,
  target: ManagementTarget,
  targetKey: string,
  providerId: string,
  appType: string,
) {
  queryClient.invalidateQueries({
    queryKey: ["providerHealth", targetKey, providerId, appType],
  });
  if (target.type === "local") {
    queryClient.invalidateQueries({
      queryKey: ["providerHealth", providerId, appType],
    });
  }
}

function invalidateCircuitBreakerStatsForTarget(
  queryClient: QueryClient,
  target: ManagementTarget,
  targetKey: string,
  providerId: string,
  appType: string,
) {
  queryClient.invalidateQueries({
    queryKey: ["circuitBreakerStats", targetKey, providerId, appType],
  });
  if (target.type === "local") {
    queryClient.invalidateQueries({
      queryKey: ["circuitBreakerStats", providerId, appType],
    });
  }
}

function invalidateCircuitBreakerConfigForTarget(
  queryClient: QueryClient,
  target: ManagementTarget,
  targetKey: string,
) {
  queryClient.invalidateQueries({
    queryKey: ["circuitBreakerConfig", targetKey],
  });
  if (target.type === "local") {
    queryClient.invalidateQueries({ queryKey: ["circuitBreakerConfig"] });
  }
}

// ========== 熔断器 Hooks ==========

/**
 * 获取供应商健康状态
 */
export function useProviderHealth(
  providerId: string,
  appType: string,
  targetOrEnabled: ManagementTarget | boolean = LOCAL_MANAGEMENT_TARGET,
  enabled = true,
) {
  const resolved = resolveTargetAndEnabled(targetOrEnabled, enabled);
  return useQuery({
    queryKey: ["providerHealth", resolved.targetKey, providerId, appType],
    queryFn: () =>
      failoverApi.getProviderHealth(providerId, appType, resolved.target),
    enabled: resolved.enabled && !!providerId && !!appType,
    refetchInterval: 5000, // 每 5 秒刷新一次
    retry: false,
  });
}

/**
 * 重置熔断器
 *
 * 重置后后端会检查是否应该切回优先级更高的供应商，
 * 因此需要同时刷新供应商列表和代理状态。
 */
export function useResetCircuitBreaker(
  target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
) {
  const queryClient = useQueryClient();
  const targetKey = getManagementTargetKey(target);

  return useMutation({
    mutationFn: ({
      providerId,
      appType,
    }: {
      providerId: string;
      appType: string;
    }) => failoverApi.resetCircuitBreaker(providerId, appType, target),
    onSuccess: (_, variables) => {
      // 刷新健康状态
      invalidateProviderHealthForTarget(
        queryClient,
        target,
        targetKey,
        variables.providerId,
        variables.appType,
      );
      invalidateCircuitBreakerStatsForTarget(
        queryClient,
        target,
        targetKey,
        variables.providerId,
        variables.appType,
      );
      // 刷新供应商列表（因为可能发生了自动恢复切换）
      invalidateProvidersForTarget(
        queryClient,
        target,
        targetKey,
        variables.appType,
      );
      // 刷新代理状态（更新 active_targets）
      invalidateProxyStatusForTarget(queryClient, target);
    },
  });
}

/**
 * 获取熔断器配置
 */
export function useCircuitBreakerConfig(
  targetOrEnabled: ManagementTarget | boolean = LOCAL_MANAGEMENT_TARGET,
  enabled = true,
) {
  const resolved = resolveTargetAndEnabled(targetOrEnabled, enabled);
  return useQuery({
    queryKey: ["circuitBreakerConfig", resolved.targetKey],
    queryFn: () => failoverApi.getCircuitBreakerConfig(resolved.target),
    enabled: resolved.enabled,
  });
}

/**
 * 更新熔断器配置
 */
export function useUpdateCircuitBreakerConfig(
  target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
) {
  const queryClient = useQueryClient();
  const targetKey = getManagementTargetKey(target);

  return useMutation({
    mutationFn: (
      config: Parameters<typeof failoverApi.updateCircuitBreakerConfig>[0],
    ) => failoverApi.updateCircuitBreakerConfig(config, target),
    onSuccess: () => {
      invalidateCircuitBreakerConfigForTarget(queryClient, target, targetKey);
    },
  });
}

/**
 * 获取熔断器统计信息
 */
export function useCircuitBreakerStats(
  providerId: string,
  appType: string,
  targetOrEnabled: ManagementTarget | boolean = LOCAL_MANAGEMENT_TARGET,
  enabled = true,
) {
  const resolved = resolveTargetAndEnabled(targetOrEnabled, enabled);
  return useQuery({
    queryKey: ["circuitBreakerStats", resolved.targetKey, providerId, appType],
    queryFn: () =>
      failoverApi.getCircuitBreakerStats(providerId, appType, resolved.target),
    enabled: resolved.enabled && !!providerId && !!appType,
    refetchInterval: 5000, // 每 5 秒刷新一次
  });
}

// ========== 故障转移队列 Hooks（新） ==========

/**
 * 获取故障转移队列
 */
function resolveTargetAndEnabled(
  targetOrEnabled: ManagementTarget | boolean = LOCAL_MANAGEMENT_TARGET,
  enabled = true,
): { target: ManagementTarget; enabled: boolean; targetKey: string } {
  if (typeof targetOrEnabled === "boolean") {
    return {
      target: LOCAL_MANAGEMENT_TARGET,
      enabled: targetOrEnabled,
      targetKey: getManagementTargetKey(LOCAL_MANAGEMENT_TARGET),
    };
  }
  return {
    target: targetOrEnabled,
    enabled,
    targetKey: getManagementTargetKey(targetOrEnabled),
  };
}

export function useFailoverQueue(
  appType: string,
  targetOrEnabled: ManagementTarget | boolean = LOCAL_MANAGEMENT_TARGET,
  enabled = true,
) {
  const resolved = resolveTargetAndEnabled(targetOrEnabled, enabled);
  return useQuery({
    queryKey: ["failoverQueue", resolved.targetKey, appType],
    queryFn: () => failoverApi.getFailoverQueue(appType, resolved.target),
    enabled: resolved.enabled && !!appType,
  });
}

/**
 * 获取可添加到队列的供应商
 */
export function useAvailableProvidersForFailover(
  appType: string,
  target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
) {
  const targetKey = getManagementTargetKey(target);
  return useQuery({
    queryKey: ["availableProvidersForFailover", targetKey, appType],
    queryFn: () =>
      failoverApi.getAvailableProvidersForFailover(appType, target),
    enabled: !!appType,
  });
}

/**
 * 添加供应商到故障转移队列
 */
export function useAddToFailoverQueue(
  target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
) {
  const queryClient = useQueryClient();
  const targetKey = getManagementTargetKey(target);

  return useMutation({
    mutationFn: ({
      appType,
      providerId,
    }: {
      appType: string;
      providerId: string;
    }) => failoverApi.addToFailoverQueue(appType, providerId, target),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["failoverQueue", targetKey, variables.appType],
      });
      queryClient.invalidateQueries({
        queryKey: [
          "availableProvidersForFailover",
          targetKey,
          variables.appType,
        ],
      });
      invalidateProvidersForTarget(
        queryClient,
        target,
        targetKey,
        variables.appType,
      );
    },
  });
}

/**
 * 从故障转移队列移除供应商
 */
export function useRemoveFromFailoverQueue(
  target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
) {
  const queryClient = useQueryClient();
  const targetKey = getManagementTargetKey(target);

  return useMutation({
    mutationFn: ({
      appType,
      providerId,
    }: {
      appType: string;
      providerId: string;
    }) => failoverApi.removeFromFailoverQueue(appType, providerId, target),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["failoverQueue", targetKey, variables.appType],
      });
      queryClient.invalidateQueries({
        queryKey: [
          "availableProvidersForFailover",
          targetKey,
          variables.appType,
        ],
      });
      invalidateProvidersForTarget(
        queryClient,
        target,
        targetKey,
        variables.appType,
      );
      // 清除该供应商的健康状态缓存（退出队列后不再需要健康监控）
      invalidateProviderHealthForTarget(
        queryClient,
        target,
        targetKey,
        variables.providerId,
        variables.appType,
      );
      // 清除该供应商的熔断器统计缓存
      invalidateCircuitBreakerStatsForTarget(
        queryClient,
        target,
        targetKey,
        variables.providerId,
        variables.appType,
      );
    },
  });
}

// ========== 自动故障转移开关 Hooks ==========

/**
 * 获取指定应用的自动故障转移开关状态
 */
export function useAutoFailoverEnabled(
  appType: string,
  targetOrEnabled: ManagementTarget | boolean = LOCAL_MANAGEMENT_TARGET,
  enabled = true,
) {
  const resolved = resolveTargetAndEnabled(targetOrEnabled, enabled);
  return useQuery({
    queryKey: ["autoFailoverEnabled", resolved.targetKey, appType],
    queryFn: () => failoverApi.getAutoFailoverEnabled(appType, resolved.target),
    enabled: resolved.enabled && !!appType,
    // 默认值为 false（与后端保持一致）
    placeholderData: false,
  });
}

/**
 * 设置指定应用的自动故障转移开关状态
 */
export function useSetAutoFailoverEnabled(
  target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
) {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const targetKey = getManagementTargetKey(target);

  return useMutation({
    mutationFn: ({ appType, enabled }: { appType: string; enabled: boolean }) =>
      failoverApi.setAutoFailoverEnabled(appType, enabled, target),

    // 乐观更新
    onMutate: async ({ appType, enabled }) => {
      await queryClient.cancelQueries({
        queryKey: ["autoFailoverEnabled", targetKey, appType],
      });
      const previousValue = queryClient.getQueryData<boolean>([
        "autoFailoverEnabled",
        targetKey,
        appType,
      ]);

      queryClient.setQueryData(
        ["autoFailoverEnabled", targetKey, appType],
        enabled,
      );

      return { previousValue, appType };
    },

    onSuccess: (_data, variables) => {
      const appLabel =
        variables.appType === "claude"
          ? "Claude"
          : variables.appType === "codex"
            ? "Codex"
            : variables.appType === "grokbuild"
              ? "Grok Build"
              : "Gemini";

      toast.success(
        variables.enabled
          ? t("failover.enabled", {
              app: appLabel,
              defaultValue: `${appLabel} 故障转移已启用`,
            })
          : t("failover.disabled", {
              app: appLabel,
              defaultValue: `${appLabel} 故障转移已关闭`,
            }),
        { closeButton: true },
      );
    },

    // 错误时回滚
    onError: (error: Error, _variables, context) => {
      if (context?.previousValue !== undefined) {
        queryClient.setQueryData(
          ["autoFailoverEnabled", targetKey, context.appType],
          context.previousValue,
        );
      }

      const detail =
        extractErrorMessage(error) ||
        t("common.unknown", { defaultValue: "未知错误" });
      toast.error(
        t("failover.toggleFailed", {
          detail,
          defaultValue: `操作失败: ${detail}`,
        }),
      );
    },

    // 无论成功失败，都重新获取
    onSettled: (_, __, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["autoFailoverEnabled", targetKey, variables.appType],
      });
      // 启用/关闭故障转移可能触发：
      // - 立即切到队列 P1（当前供应商变化）
      // - 队列为空时自动把当前供应商加入队列（队列内容变化）
      queryClient.invalidateQueries({
        queryKey: ["failoverQueue", targetKey, variables.appType],
      });
      queryClient.invalidateQueries({
        queryKey: [
          "availableProvidersForFailover",
          targetKey,
          variables.appType,
        ],
      });
      invalidateProvidersForTarget(
        queryClient,
        target,
        targetKey,
        variables.appType,
      );
      invalidateProxyStatusForTarget(queryClient, target);
    },
  });
}
