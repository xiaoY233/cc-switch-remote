import { invoke } from "@tauri-apps/api/core";
import type {
  UsageSummary,
  UsageSummaryByApp,
  DailyStats,
  ProviderStats,
  ModelStats,
  RequestLog,
  LogFilters,
  ModelPricing,
  ProviderLimitStatus,
  PaginatedLogs,
  SessionSyncResult,
  DataSourceSummary,
} from "@/types/usage";
import type { UsageResult } from "@/types";
import type { AppId } from "./types";
import type { TemplateType } from "@/config/constants";
import { LOCAL_MANAGEMENT_TARGET } from "@/lib/managementTarget";
import { remoteApi, type ManagementTarget } from "./remote";

export const usageApi = {
  // Provider usage script methods
  query: async (
    providerId: string,
    appId: AppId,
    target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
  ): Promise<UsageResult> => {
    if (target.type === "remote") {
      return remoteApi.queryProviderUsage(
        target.profile,
        appId,
        providerId,
        target.secret,
      );
    }

    return invoke("queryProviderUsage", { providerId, app: appId });
  },

  testScript: async (
    providerId: string,
    appId: AppId,
    scriptCode: string,
    timeout?: number,
    apiKey?: string,
    baseUrl?: string,
    accessToken?: string,
    userId?: string,
    templateType?: TemplateType,
    target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
  ): Promise<UsageResult> => {
    if (target.type === "remote") {
      return remoteApi.testUsageScript(
        target.profile,
        appId,
        providerId,
        {
          scriptCode,
          timeout,
          apiKey,
          baseUrl,
          accessToken,
          userId,
          templateType,
        },
        target.secret,
      );
    }

    return invoke("testUsageScript", {
      providerId,
      app: appId,
      scriptCode,
      timeout,
      apiKey,
      baseUrl,
      accessToken,
      userId,
      templateType,
    });
  },

  // Proxy usage statistics methods
  getUsageSummary: async (
    startDate?: number,
    endDate?: number,
    appType?: string,
    providerName?: string,
    model?: string,
    target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
  ): Promise<UsageSummary> => {
    if (target.type === "remote") {
      return remoteApi.getUsageSummary(
        target.profile,
        startDate,
        endDate,
        appType,
        providerName,
        model,
        target.secret,
      );
    }
    return invoke("get_usage_summary", {
      startDate,
      endDate,
      appType,
      providerName,
      model,
    });
  },

  getUsageSummaryByApp: async (
    startDate?: number,
    endDate?: number,
    providerName?: string,
    model?: string,
    target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
  ): Promise<UsageSummaryByApp[]> => {
    if (target.type === "remote") {
      return remoteApi.getUsageSummaryByApp(
        target.profile,
        startDate,
        endDate,
        providerName,
        model,
        target.secret,
      );
    }
    return invoke("get_usage_summary_by_app", {
      startDate,
      endDate,
      providerName,
      model,
    });
  },

  getUsageTrends: async (
    startDate?: number,
    endDate?: number,
    appType?: string,
    providerName?: string,
    model?: string,
    target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
  ): Promise<DailyStats[]> => {
    if (target.type === "remote") {
      return remoteApi.getUsageTrends(
        target.profile,
        startDate,
        endDate,
        appType,
        providerName,
        model,
        target.secret,
      );
    }
    return invoke("get_usage_trends", {
      startDate,
      endDate,
      appType,
      providerName,
      model,
    });
  },

  getProviderStats: async (
    startDate?: number,
    endDate?: number,
    appType?: string,
    providerName?: string,
    model?: string,
    target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
  ): Promise<ProviderStats[]> => {
    if (target.type === "remote") {
      return remoteApi.getProviderStats(
        target.profile,
        startDate,
        endDate,
        appType,
        providerName,
        model,
        target.secret,
      );
    }
    return invoke("get_provider_stats", {
      startDate,
      endDate,
      appType,
      providerName,
      model,
    });
  },

  getModelStats: async (
    startDate?: number,
    endDate?: number,
    appType?: string,
    providerName?: string,
    model?: string,
    target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
  ): Promise<ModelStats[]> => {
    if (target.type === "remote") {
      return remoteApi.getModelStats(
        target.profile,
        startDate,
        endDate,
        appType,
        providerName,
        model,
        target.secret,
      );
    }
    return invoke("get_model_stats", {
      startDate,
      endDate,
      appType,
      providerName,
      model,
    });
  },

  getRequestLogs: async (
    filters: LogFilters,
    page: number = 0,
    pageSize: number = 20,
    target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
  ): Promise<PaginatedLogs> => {
    if (target.type === "remote") {
      return remoteApi.getRequestLogs(
        target.profile,
        filters,
        page,
        pageSize,
        target.secret,
      );
    }
    return invoke("get_request_logs", {
      filters,
      page,
      pageSize,
    });
  },

  getRequestDetail: async (
    requestId: string,
    target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
  ): Promise<RequestLog | null> => {
    if (target.type === "remote") {
      return remoteApi.getRequestDetail(
        target.profile,
        requestId,
        target.secret,
      );
    }
    return invoke("get_request_detail", { requestId });
  },

  getModelPricing: async (
    target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
  ): Promise<ModelPricing[]> => {
    if (target.type === "remote") {
      return remoteApi.getModelPricing(target.profile, target.secret);
    }
    return invoke("get_model_pricing");
  },

  updateModelPricing: async (
    modelId: string,
    displayName: string,
    inputCost: string,
    outputCost: string,
    cacheReadCost: string,
    cacheCreationCost: string,
    target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
  ): Promise<void> => {
    if (target.type === "remote") {
      return remoteApi.updateModelPricing(
        target.profile,
        modelId,
        displayName,
        inputCost,
        outputCost,
        cacheReadCost,
        cacheCreationCost,
        target.secret,
      );
    }
    return invoke("update_model_pricing", {
      modelId,
      displayName,
      inputCost,
      outputCost,
      cacheReadCost,
      cacheCreationCost,
    });
  },

  deleteModelPricing: async (
    modelId: string,
    target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
  ): Promise<void> => {
    if (target.type === "remote") {
      return remoteApi.deleteModelPricing(
        target.profile,
        modelId,
        target.secret,
      );
    }
    return invoke("delete_model_pricing", { modelId });
  },

  checkProviderLimits: async (
    providerId: string,
    appType: string,
  ): Promise<ProviderLimitStatus> => {
    return invoke("check_provider_limits", { providerId, appType });
  },

  // Session usage sync
  syncSessionUsage: async (
    target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
  ): Promise<SessionSyncResult> => {
    if (target.type === "remote") {
      return remoteApi.syncSessionUsage(target.profile, target.secret);
    }
    return invoke("sync_session_usage");
  },

  rebuildCodexUsage: async (
    target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
  ): Promise<SessionSyncResult> => {
    if (target.type === "remote") {
      return remoteApi.rebuildCodexUsage(target.profile, target.secret);
    }
    return invoke("rebuild_codex_usage");
  },

  getDataSourceBreakdown: async (
    target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
  ): Promise<DataSourceSummary[]> => {
    if (target.type === "remote") {
      return remoteApi.getDataSourceBreakdown(target.profile, target.secret);
    }
    return invoke("get_usage_data_sources");
  },
};
