import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ManagementTarget, RemoteHostProfile } from "./remote";
import type { LogFilters } from "@/types/usage";

const invokeMock = vi.fn();
const remoteGetUsageSummaryMock = vi.fn();
const remoteGetUsageSummaryByAppMock = vi.fn();
const remoteGetUsageTrendsMock = vi.fn();
const remoteGetProviderStatsMock = vi.fn();
const remoteGetModelStatsMock = vi.fn();
const remoteQueryProviderUsageMock = vi.fn();
const remoteTestUsageScriptMock = vi.fn();
const remoteGetRequestLogsMock = vi.fn();
const remoteGetRequestDetailMock = vi.fn();
const remoteGetDataSourceBreakdownMock = vi.fn();
const remoteGetModelPricingMock = vi.fn();
const remoteUpdateModelPricingMock = vi.fn();
const remoteUpdateModelPricingBatchMock = vi.fn();
const remoteGetModelsDevSyncConfigMock = vi.fn();
const remoteSaveModelsDevSyncConfigMock = vi.fn();
const remoteRecordModelsDevSyncResultMock = vi.fn();
const remoteDeleteModelPricingMock = vi.fn();
const remoteSyncSessionUsageMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("./remote", () => ({
  remoteApi: {
    getUsageSummary: (...args: unknown[]) => remoteGetUsageSummaryMock(...args),
    getUsageSummaryByApp: (...args: unknown[]) =>
      remoteGetUsageSummaryByAppMock(...args),
    getUsageTrends: (...args: unknown[]) => remoteGetUsageTrendsMock(...args),
    getProviderStats: (...args: unknown[]) =>
      remoteGetProviderStatsMock(...args),
    getModelStats: (...args: unknown[]) => remoteGetModelStatsMock(...args),
    queryProviderUsage: (...args: unknown[]) =>
      remoteQueryProviderUsageMock(...args),
    testUsageScript: (...args: unknown[]) => remoteTestUsageScriptMock(...args),
    getRequestLogs: (...args: unknown[]) => remoteGetRequestLogsMock(...args),
    getRequestDetail: (...args: unknown[]) =>
      remoteGetRequestDetailMock(...args),
    getDataSourceBreakdown: (...args: unknown[]) =>
      remoteGetDataSourceBreakdownMock(...args),
    getModelPricing: (...args: unknown[]) => remoteGetModelPricingMock(...args),
    updateModelPricing: (...args: unknown[]) =>
      remoteUpdateModelPricingMock(...args),
    updateModelPricingBatch: (...args: unknown[]) =>
      remoteUpdateModelPricingBatchMock(...args),
    getModelsDevSyncConfig: (...args: unknown[]) =>
      remoteGetModelsDevSyncConfigMock(...args),
    saveModelsDevSyncConfig: (...args: unknown[]) =>
      remoteSaveModelsDevSyncConfigMock(...args),
    recordModelsDevSyncResult: (...args: unknown[]) =>
      remoteRecordModelsDevSyncResultMock(...args),
    deleteModelPricing: (...args: unknown[]) =>
      remoteDeleteModelPricingMock(...args),
    syncSessionUsage: (...args: unknown[]) =>
      remoteSyncSessionUsageMock(...args),
  },
}));

const profile: RemoteHostProfile = {
  id: "remote-usage",
  name: "Remote Usage",
  host: "192.168.1.20",
  port: 22,
  username: "root",
  authMethod: { type: "password" },
  helperPath: "~/.local/bin/cc-switch-remote-helper",
  createdAt: 1,
  updatedAt: 1,
};

const remoteTarget: ManagementTarget = {
  type: "remote",
  profile,
  secret: { password: "secret" },
};

describe("remote usage API", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    remoteGetUsageSummaryMock.mockReset();
    remoteGetUsageSummaryByAppMock.mockReset();
    remoteGetUsageTrendsMock.mockReset();
    remoteGetProviderStatsMock.mockReset();
    remoteGetModelStatsMock.mockReset();
    remoteQueryProviderUsageMock.mockReset();
    remoteTestUsageScriptMock.mockReset();
    remoteGetRequestLogsMock.mockReset();
    remoteGetRequestDetailMock.mockReset();
    remoteGetDataSourceBreakdownMock.mockReset();
    remoteGetModelPricingMock.mockReset();
    remoteUpdateModelPricingMock.mockReset();
    remoteUpdateModelPricingBatchMock.mockReset();
    remoteGetModelsDevSyncConfigMock.mockReset();
    remoteSaveModelsDevSyncConfigMock.mockReset();
    remoteRecordModelsDevSyncResultMock.mockReset();
    remoteDeleteModelPricingMock.mockReset();
    remoteSyncSessionUsageMock.mockReset();
  });

  it("routes dashboard read queries to the selected remote target", async () => {
    const { usageApi } = await import("./usage");
    const filters: LogFilters = {
      appType: "codex",
      providerName: "NewAPI",
      model: "gpt-5",
      startDate: 10,
      endDate: 20,
      statusCode: 200,
    };

    remoteGetUsageSummaryMock.mockResolvedValue({ totalRequests: 0 });
    remoteGetUsageSummaryByAppMock.mockResolvedValue([]);
    remoteGetUsageTrendsMock.mockResolvedValue([]);
    remoteGetProviderStatsMock.mockResolvedValue([]);
    remoteGetModelStatsMock.mockResolvedValue([]);
    remoteGetRequestLogsMock.mockResolvedValue({
      data: [],
      total: 0,
      page: 0,
      pageSize: 20,
    });
    remoteGetRequestDetailMock.mockResolvedValue(null);
    remoteGetDataSourceBreakdownMock.mockResolvedValue([]);

    await usageApi.getUsageSummary(
      10,
      20,
      "codex",
      "NewAPI",
      "gpt-5",
      remoteTarget,
    );
    await usageApi.getUsageSummaryByApp(
      10,
      20,
      "NewAPI",
      "gpt-5",
      remoteTarget,
    );
    await usageApi.getUsageTrends(
      10,
      20,
      "codex",
      "NewAPI",
      "gpt-5",
      remoteTarget,
    );
    await usageApi.getProviderStats(
      10,
      20,
      "codex",
      "NewAPI",
      "gpt-5",
      remoteTarget,
    );
    await usageApi.getModelStats(
      10,
      20,
      "codex",
      "NewAPI",
      "gpt-5",
      remoteTarget,
    );
    await usageApi.getRequestLogs(filters, 0, 20, remoteTarget);
    await usageApi.getRequestDetail("req-1", remoteTarget);
    await usageApi.getDataSourceBreakdown(remoteTarget);

    expect(remoteGetUsageSummaryMock).toHaveBeenCalledWith(
      profile,
      10,
      20,
      "codex",
      "NewAPI",
      "gpt-5",
      remoteTarget.secret,
    );
    expect(remoteGetUsageSummaryByAppMock).toHaveBeenCalledWith(
      profile,
      10,
      20,
      "NewAPI",
      "gpt-5",
      remoteTarget.secret,
    );
    expect(remoteGetUsageTrendsMock).toHaveBeenCalledWith(
      profile,
      10,
      20,
      "codex",
      "NewAPI",
      "gpt-5",
      remoteTarget.secret,
    );
    expect(remoteGetProviderStatsMock).toHaveBeenCalledWith(
      profile,
      10,
      20,
      "codex",
      "NewAPI",
      "gpt-5",
      remoteTarget.secret,
    );
    expect(remoteGetModelStatsMock).toHaveBeenCalledWith(
      profile,
      10,
      20,
      "codex",
      "NewAPI",
      "gpt-5",
      remoteTarget.secret,
    );
    expect(remoteGetRequestLogsMock).toHaveBeenCalledWith(
      profile,
      filters,
      0,
      20,
      remoteTarget.secret,
    );
    expect(remoteGetRequestDetailMock).toHaveBeenCalledWith(
      profile,
      "req-1",
      remoteTarget.secret,
    );
    expect(remoteGetDataSourceBreakdownMock).toHaveBeenCalledWith(
      profile,
      remoteTarget.secret,
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("uses the local provider usage command only for local targets", async () => {
    const { usageApi } = await import("./usage");
    invokeMock.mockResolvedValue({ success: true, data: [], error: null });

    await usageApi.query("local-provider", "opencode");

    expect(invokeMock).toHaveBeenCalledWith("queryProviderUsage", {
      providerId: "local-provider",
      app: "opencode",
    });
    expect(remoteQueryProviderUsageMock).not.toHaveBeenCalled();
  });

  it("routes provider usage script queries to the selected remote target", async () => {
    const { usageApi } = await import("./usage");
    remoteQueryProviderUsageMock.mockResolvedValue({
      success: true,
      data: [],
      error: null,
    });
    remoteTestUsageScriptMock.mockResolvedValue({
      success: true,
      data: [],
      error: null,
    });

    await usageApi.query("provider-1", "claude", remoteTarget);
    await usageApi.testScript(
      "provider-1",
      "claude",
      "({ request: {}, extractor: () => ({ remaining: 1 }) })",
      10,
      "api-key",
      "https://example.test",
      "access-token",
      "user-1",
      "custom",
      remoteTarget,
    );

    expect(remoteQueryProviderUsageMock).toHaveBeenCalledWith(
      profile,
      "claude",
      "provider-1",
      remoteTarget.secret,
    );
    expect(remoteTestUsageScriptMock).toHaveBeenCalledWith(
      profile,
      "claude",
      "provider-1",
      {
        scriptCode: "({ request: {}, extractor: () => ({ remaining: 1 }) })",
        timeout: 10,
        apiKey: "api-key",
        baseUrl: "https://example.test",
        accessToken: "access-token",
        userId: "user-1",
        templateType: "custom",
      },
      remoteTarget.secret,
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("routes pricing configuration reads and writes to the selected remote target", async () => {
    const { usageApi } = await import("./usage");

    remoteGetModelPricingMock.mockResolvedValue([]);
    remoteUpdateModelPricingMock.mockResolvedValue(undefined);
    remoteDeleteModelPricingMock.mockResolvedValue(undefined);

    await usageApi.getModelPricing(remoteTarget);
    await usageApi.updateModelPricing(
      "gpt-5",
      "GPT-5",
      "1",
      "2",
      "0.1",
      "0.2",
      remoteTarget,
    );
    await usageApi.deleteModelPricing("gpt-5", remoteTarget);

    expect(remoteGetModelPricingMock).toHaveBeenCalledWith(
      profile,
      remoteTarget.secret,
    );
    expect(remoteUpdateModelPricingMock).toHaveBeenCalledWith(
      profile,
      "gpt-5",
      "GPT-5",
      "1",
      "2",
      "0.1",
      "0.2",
      remoteTarget.secret,
    );
    expect(remoteDeleteModelPricingMock).toHaveBeenCalledWith(
      profile,
      "gpt-5",
      remoteTarget.secret,
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("routes models.dev persistence to the selected remote target", async () => {
    const { usageApi } = await import("./usage");
    const entries = [
      {
        modelId: "gpt-5",
        displayName: "GPT-5",
        inputCostPerMillion: "1",
        outputCostPerMillion: "2",
        cacheReadCostPerMillion: "0.1",
        cacheCreationCostPerMillion: "0.2",
      },
    ];
    const config = {
      autoSyncEnabled: true,
      includeCommonModels: false,
      selectedModelKeys: ["openai/gpt-5"],
      excludedCommonModelKeys: [],
      lastSyncAt: null,
      lastSyncError: null,
    };
    remoteUpdateModelPricingBatchMock.mockResolvedValue(1);
    remoteGetModelsDevSyncConfigMock.mockResolvedValue({
      config,
      configPath: "/root/.cc-switch-remote/model-pricing.json",
    });
    remoteSaveModelsDevSyncConfigMock.mockResolvedValue(undefined);
    remoteRecordModelsDevSyncResultMock.mockResolvedValue(undefined);

    await usageApi.updateModelPricingBatch(entries, remoteTarget);
    await usageApi.getModelsDevSyncConfig(remoteTarget);
    await usageApi.saveModelsDevSyncConfig(config, remoteTarget);
    await usageApi.recordModelsDevSyncResult(123, null, remoteTarget);

    expect(remoteUpdateModelPricingBatchMock).toHaveBeenCalledWith(
      profile,
      entries,
      remoteTarget.secret,
    );
    expect(remoteGetModelsDevSyncConfigMock).toHaveBeenCalledWith(
      profile,
      remoteTarget.secret,
    );
    expect(remoteSaveModelsDevSyncConfigMock).toHaveBeenCalledWith(
      profile,
      config,
      remoteTarget.secret,
    );
    expect(remoteRecordModelsDevSyncResultMock).toHaveBeenCalledWith(
      profile,
      123,
      null,
      remoteTarget.secret,
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("routes session usage sync to the selected remote target", async () => {
    const { usageApi } = await import("./usage");

    remoteSyncSessionUsageMock.mockResolvedValue({
      imported: 1,
      skipped: 2,
      filesScanned: 3,
      errors: [],
    });

    await usageApi.syncSessionUsage(remoteTarget);

    expect(remoteSyncSessionUsageMock).toHaveBeenCalledWith(
      profile,
      remoteTarget.secret,
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
