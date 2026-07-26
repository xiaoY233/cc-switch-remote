import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { usageApi } from "@/lib/api/usage";
import { resolveUsageRange } from "@/lib/usageRange";
import { LOCAL_MANAGEMENT_TARGET } from "@/lib/managementTarget";
import type { ManagementTarget } from "@/lib/api/remote";
import type {
  LogFilters,
  UsageRangeSelection,
  UsageScopeFilters,
} from "@/types/usage";

const DEFAULT_REFETCH_INTERVAL_MS = 30000;

type UsageQueryOptions = {
  refetchInterval?: number | false;
  refetchIntervalInBackground?: boolean;
};

type RequestLogsQueryArgs = {
  filters: LogFilters;
  range: UsageRangeSelection;
  page?: number;
  pageSize?: number;
  options?: UsageQueryOptions;
  target?: ManagementTarget;
};

type RequestLogsKey = {
  preset: UsageRangeSelection["preset"];
  customStartDate?: number;
  customEndDate?: number;
  liveEndTime?: boolean;
  appType?: string;
  providerName?: string;
  model?: string;
  statusCode?: number;
};

function usageTargetKey(target: ManagementTarget = LOCAL_MANAGEMENT_TARGET) {
  return target.type === "remote"
    ? (["remote", target.profile.id] as const)
    : (["local"] as const);
}

// Query keys
export const usageKeys = {
  all: (target: ManagementTarget = LOCAL_MANAGEMENT_TARGET) =>
    ["usage", ...usageTargetKey(target)] as const,
  summary: (
    preset: UsageRangeSelection["preset"],
    customStartDate: number | undefined,
    customEndDate: number | undefined,
    filters?: UsageScopeFilters,
    target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
    liveEndTime?: boolean,
  ) =>
    [
      ...usageKeys.all(target),
      "summary",
      preset,
      customStartDate ?? 0,
      customEndDate ?? 0,
      liveEndTime ?? false,
      filters?.appType ?? null,
      filters?.providerName ?? null,
      filters?.model ?? null,
    ] as const,
  summaryByApp: (
    preset: UsageRangeSelection["preset"],
    customStartDate: number | undefined,
    customEndDate: number | undefined,
    filters?: Pick<UsageScopeFilters, "providerName" | "model">,
    target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
    liveEndTime?: boolean,
  ) =>
    [
      ...usageKeys.all(target),
      "summary-by-app",
      preset,
      customStartDate ?? 0,
      customEndDate ?? 0,
      liveEndTime ?? false,
      filters?.providerName ?? null,
      filters?.model ?? null,
    ] as const,
  trends: (
    preset: UsageRangeSelection["preset"],
    customStartDate: number | undefined,
    customEndDate: number | undefined,
    filters?: UsageScopeFilters,
    target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
    liveEndTime?: boolean,
  ) =>
    [
      ...usageKeys.all(target),
      "trends",
      preset,
      customStartDate ?? 0,
      customEndDate ?? 0,
      liveEndTime ?? false,
      filters?.appType ?? null,
      filters?.providerName ?? null,
      filters?.model ?? null,
    ] as const,
  providerStats: (
    preset: UsageRangeSelection["preset"],
    customStartDate: number | undefined,
    customEndDate: number | undefined,
    filters?: UsageScopeFilters,
    target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
    liveEndTime?: boolean,
  ) =>
    [
      ...usageKeys.all(target),
      "provider-stats",
      preset,
      customStartDate ?? 0,
      customEndDate ?? 0,
      liveEndTime ?? false,
      filters?.appType ?? null,
      filters?.providerName ?? null,
      filters?.model ?? null,
    ] as const,
  modelStats: (
    preset: UsageRangeSelection["preset"],
    customStartDate: number | undefined,
    customEndDate: number | undefined,
    filters?: UsageScopeFilters,
    target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
    liveEndTime?: boolean,
  ) =>
    [
      ...usageKeys.all(target),
      "model-stats",
      preset,
      customStartDate ?? 0,
      customEndDate ?? 0,
      liveEndTime ?? false,
      filters?.appType ?? null,
      filters?.providerName ?? null,
      filters?.model ?? null,
    ] as const,
  logs: (
    key: RequestLogsKey,
    page: number,
    pageSize: number,
    target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
  ) =>
    [
      ...usageKeys.all(target),
      "logs",
      key.preset,
      key.customStartDate ?? 0,
      key.customEndDate ?? 0,
      key.liveEndTime ?? false,
      key.appType ?? "",
      key.providerName ?? "",
      key.model ?? "",
      key.statusCode ?? -1,
      page,
      pageSize,
    ] as const,
  detail: (
    requestId: string,
    target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
  ) => [...usageKeys.all(target), "detail", requestId] as const,
  pricing: (target: ManagementTarget = LOCAL_MANAGEMENT_TARGET) =>
    [...usageKeys.all(target), "pricing"] as const,
  limits: (
    providerId: string,
    appType: string,
    target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
  ) => [...usageKeys.all(target), "limits", providerId, appType] as const,
  script: (
    providerId: string,
    appType: string,
    target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
  ) => [...usageKeys.all(target), "script", providerId, appType] as const,
};

export function usageScriptResultKey(
  providerId: string,
  appType: string,
  target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
) {
  return usageKeys.script(providerId, appType, target);
}

/** 把 UI 侧的 "all" 哨兵归一成 undefined（后端语义：不过滤）。 */
function normalizeScopeFilters(filters?: UsageScopeFilters): UsageScopeFilters {
  return {
    appType: filters?.appType === "all" ? undefined : filters?.appType,
    providerName: filters?.providerName,
    model: filters?.model,
  };
}

// Hooks
export function useUsageSummary(
  range: UsageRangeSelection,
  filters?: UsageScopeFilters,
  options?: UsageQueryOptions,
  target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
) {
  const effective = normalizeScopeFilters(filters);
  return useQuery({
    queryKey: usageKeys.summary(
      range.preset,
      range.customStartDate,
      range.customEndDate,
      effective,
      target,
      range.liveEndTime,
    ),
    queryFn: () => {
      const { startDate, endDate } = resolveUsageRange(range);
      return usageApi.getUsageSummary(
        startDate,
        endDate,
        effective.appType,
        effective.providerName,
        effective.model,
        target,
      );
    },
    refetchInterval: options?.refetchInterval ?? DEFAULT_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: options?.refetchIntervalInBackground ?? false,
  });
}

export function useUsageSummaryByApp(
  range: UsageRangeSelection,
  filters?: Pick<UsageScopeFilters, "providerName" | "model">,
  options?: UsageQueryOptions,
  target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
) {
  return useQuery({
    queryKey: usageKeys.summaryByApp(
      range.preset,
      range.customStartDate,
      range.customEndDate,
      filters,
      target,
      range.liveEndTime,
    ),
    queryFn: () => {
      const { startDate, endDate } = resolveUsageRange(range);
      return usageApi.getUsageSummaryByApp(
        startDate,
        endDate,
        filters?.providerName,
        filters?.model,
        target,
      );
    },
    refetchInterval: options?.refetchInterval ?? DEFAULT_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: options?.refetchIntervalInBackground ?? false,
  });
}

export function useUsageTrends(
  range: UsageRangeSelection,
  filters?: UsageScopeFilters,
  options?: UsageQueryOptions,
  target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
) {
  const effective = normalizeScopeFilters(filters);
  return useQuery({
    queryKey: usageKeys.trends(
      range.preset,
      range.customStartDate,
      range.customEndDate,
      effective,
      target,
      range.liveEndTime,
    ),
    queryFn: () => {
      const { startDate, endDate } = resolveUsageRange(range);
      return usageApi.getUsageTrends(
        startDate,
        endDate,
        effective.appType,
        effective.providerName,
        effective.model,
        target,
      );
    },
    refetchInterval: options?.refetchInterval ?? DEFAULT_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: options?.refetchIntervalInBackground ?? false,
  });
}

export function useProviderStats(
  range: UsageRangeSelection,
  filters?: UsageScopeFilters,
  options?: UsageQueryOptions,
  target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
) {
  const effective = normalizeScopeFilters(filters);
  return useQuery({
    queryKey: usageKeys.providerStats(
      range.preset,
      range.customStartDate,
      range.customEndDate,
      effective,
      target,
      range.liveEndTime,
    ),
    queryFn: () => {
      const { startDate, endDate } = resolveUsageRange(range);
      return usageApi.getProviderStats(
        startDate,
        endDate,
        effective.appType,
        effective.providerName,
        effective.model,
        target,
      );
    },
    refetchInterval: options?.refetchInterval ?? DEFAULT_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: options?.refetchIntervalInBackground ?? false,
  });
}

export function useModelStats(
  range: UsageRangeSelection,
  filters?: UsageScopeFilters,
  options?: UsageQueryOptions,
  target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
) {
  const effective = normalizeScopeFilters(filters);
  return useQuery({
    queryKey: usageKeys.modelStats(
      range.preset,
      range.customStartDate,
      range.customEndDate,
      effective,
      target,
      range.liveEndTime,
    ),
    queryFn: () => {
      const { startDate, endDate } = resolveUsageRange(range);
      return usageApi.getModelStats(
        startDate,
        endDate,
        effective.appType,
        effective.providerName,
        effective.model,
        target,
      );
    },
    refetchInterval: options?.refetchInterval ?? DEFAULT_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: options?.refetchIntervalInBackground ?? false,
  });
}

export function useRequestLogs({
  filters,
  range,
  page = 0,
  pageSize = 20,
  options,
  target = LOCAL_MANAGEMENT_TARGET,
}: RequestLogsQueryArgs) {
  const key: RequestLogsKey = {
    preset: range.preset,
    customStartDate: range.customStartDate,
    customEndDate: range.customEndDate,
    liveEndTime: range.liveEndTime,
    appType: filters.appType,
    providerName: filters.providerName,
    model: filters.model,
    statusCode: filters.statusCode,
  };

  return useQuery({
    queryKey: usageKeys.logs(key, page, pageSize, target),
    queryFn: () => {
      const effectiveFilters = { ...filters, ...resolveUsageRange(range) };
      return usageApi.getRequestLogs(effectiveFilters, page, pageSize, target);
    },
    refetchInterval: options?.refetchInterval ?? DEFAULT_REFETCH_INTERVAL_MS, // 每30秒自动刷新
    refetchIntervalInBackground: options?.refetchIntervalInBackground ?? false,
  });
}

export function useRequestDetail(
  requestId: string,
  target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
) {
  return useQuery({
    queryKey: usageKeys.detail(requestId, target),
    queryFn: () => usageApi.getRequestDetail(requestId, target),
    enabled: !!requestId,
  });
}

export function useModelPricing(
  target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
) {
  return useQuery({
    queryKey: usageKeys.pricing(target),
    queryFn: () => usageApi.getModelPricing(target),
  });
}

export function useProviderLimits(
  providerId: string,
  appType: string,
  target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
) {
  return useQuery({
    queryKey: usageKeys.limits(providerId, appType, target),
    queryFn: () => usageApi.checkProviderLimits(providerId, appType),
    enabled: !!providerId && !!appType,
  });
}

export function useUpdateModelPricing(
  target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: {
      modelId: string;
      displayName: string;
      inputCost: string;
      outputCost: string;
      cacheReadCost: string;
      cacheCreationCost: string;
    }) =>
      usageApi.updateModelPricing(
        params.modelId,
        params.displayName,
        params.inputCost,
        params.outputCost,
        params.cacheReadCost,
        params.cacheCreationCost,
        target,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: usageKeys.all(target) });
    },
  });
}

export function useDeleteModelPricing(
  target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (modelId: string) =>
      usageApi.deleteModelPricing(modelId, target),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: usageKeys.all(target) });
    },
  });
}
