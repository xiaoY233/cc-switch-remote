import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deletePreviewRemoteProfile,
  loadPreviewRemoteProfiles,
  remoteApi,
  savePreviewRemoteProfile,
  validateRemoteProfile,
  type RemoteConnectionSecret,
  type RemoteHostProfile,
} from "./remote";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

function profile(
  overrides: Partial<RemoteHostProfile> = {},
): RemoteHostProfile {
  return {
    id: "remote-1",
    name: "Remote 1",
    host: "192.0.2.10",
    port: 22,
    username: "root",
    authMethod: { type: "password" },
    helperPath: "~/.local/bin/cc-switch-remote-helper",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

class MemoryStorage
  implements Pick<Storage, "getItem" | "setItem" | "removeItem">
{
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

beforeEach(() => {
  invokeMock.mockReset();
});

describe("remote preview profile store", () => {
  it("saves updates and deletes remote profiles without requiring Tauri invoke", () => {
    const storage = new MemoryStorage();
    const saved = savePreviewRemoteProfile(profile(), storage);
    const updated = savePreviewRemoteProfile(
      profile({ name: "Remote Renamed", updatedAt: 2 }),
      storage,
    );

    expect(saved.id).toBe("remote-1");
    expect(updated.name).toBe("Remote Renamed");
    expect(loadPreviewRemoteProfiles(storage)).toEqual([updated]);
    expect(deletePreviewRemoteProfile("remote-1", storage)).toBe(true);
    expect(loadPreviewRemoteProfiles(storage)).toEqual([]);
  });

  it("keeps password secrets out of browser preview profile storage", () => {
    const storage = new MemoryStorage();
    savePreviewRemoteProfile(profile(), storage);

    const raw = storage.getItem("cc-switch-preview-remote-hosts");

    expect(raw).toContain('"authMethod":{"type":"password"}');
    expect(raw).not.toContain("preview-only-password");
    expect(raw).not.toContain('password":"');
  });

  it("validates required profile fields before preview save", () => {
    expect(() => validateRemoteProfile(profile({ host: "" }))).toThrow(
      "Remote host is required",
    );
    expect(() =>
      validateRemoteProfile(
        profile({ authMethod: { type: "keyFile", path: "" } }),
      ),
    ).toThrow("Remote SSH key path is required");
  });
});

describe("remote project profile API", () => {
  const remoteProfile = profile();
  const secret: RemoteConnectionSecret = { password: "secret" };

  it("invokes remote project profile read command with profile and secret", async () => {
    invokeMock.mockResolvedValueOnce({ profiles: [], currentIds: {} });

    await remoteApi.listProjectProfiles(remoteProfile, secret);

    expect(invokeMock).toHaveBeenCalledWith("remote_list_project_profiles", {
      profile: remoteProfile,
      secret,
    });
  });

  it("invokes remote project profile mutation commands with target data", async () => {
    invokeMock.mockResolvedValueOnce({
      id: "project-1",
      name: "Project",
      payload: {},
    });
    invokeMock.mockResolvedValueOnce([]);

    await remoteApi.createProjectProfile(
      remoteProfile,
      "Project",
      "codex",
      secret,
    );
    await remoteApi.applyProjectProfile(
      remoteProfile,
      "project-1",
      "codex",
      secret,
    );

    expect(invokeMock).toHaveBeenNthCalledWith(
      1,
      "remote_create_project_profile",
      {
        profile: remoteProfile,
        name: "Project",
        scope: "codex",
        secret,
      },
    );
    expect(invokeMock).toHaveBeenNthCalledWith(
      2,
      "remote_apply_project_profile",
      {
        profile: remoteProfile,
        id: "project-1",
        scope: "codex",
        secret,
      },
    );
  });
});

describe("remote OMO API", () => {
  const remoteProfile = profile();
  const secret: RemoteConnectionSecret = { password: "secret" };

  it("invokes remote OMO commands with variant and target secret", async () => {
    invokeMock.mockResolvedValueOnce("omo-provider");
    invokeMock.mockResolvedValueOnce(undefined);

    await remoteApi.getCurrentOmoProviderId(remoteProfile, "omo", secret);
    await remoteApi.disableCurrentOmo(remoteProfile, "omo-slim", secret);

    expect(invokeMock).toHaveBeenNthCalledWith(
      1,
      "remote_get_current_omo_provider_id",
      {
        profile: remoteProfile,
        variant: "omo",
        secret,
      },
    );
    expect(invokeMock).toHaveBeenNthCalledWith(
      2,
      "remote_disable_current_omo",
      {
        profile: remoteProfile,
        variant: "omo-slim",
        secret,
      },
    );
  });
});

describe("remote API invoke mappings", () => {
  it("restores an official provider seed through the remote helper command", async () => {
    const remoteProfile = profile();
    const secret: RemoteConnectionSecret = { password: "secret" };
    invokeMock.mockResolvedValueOnce(true);

    const result = await remoteApi.ensureOfficialProvider(
      remoteProfile,
      "grokbuild",
      secret,
    );

    expect(result).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("remote_ensure_official_provider", {
      profile: remoteProfile,
      app: "grokbuild",
      secret,
    });
  });

  it("fetches Codex OAuth models through the remote helper command", async () => {
    const remoteProfile = profile();
    const secret: RemoteConnectionSecret = { password: "secret" };
    invokeMock.mockResolvedValueOnce([{ id: "gpt-5", ownedBy: null }]);

    const result = await remoteApi.fetchCodexOauthModels(
      remoteProfile,
      "chatgpt-1",
      secret,
    );

    expect(result).toEqual([{ id: "gpt-5", ownedBy: null }]);
    expect(invokeMock).toHaveBeenCalledWith("remote_fetch_codex_oauth_models", {
      profile: remoteProfile,
      accountId: "chatgpt-1",
      secret,
    });
  });

  it("fetches Copilot models through the remote helper command", async () => {
    const remoteProfile = profile();
    const secret: RemoteConnectionSecret = { password: "secret" };
    invokeMock.mockResolvedValueOnce([
      {
        id: "gpt-5-copilot",
        name: "GPT-5 Copilot",
        vendor: "openai",
        model_picker_enabled: true,
      },
    ]);

    const result = await remoteApi.fetchCopilotModels(
      remoteProfile,
      "github-1",
      secret,
    );

    expect(result).toEqual([
      {
        id: "gpt-5-copilot",
        name: "GPT-5 Copilot",
        vendor: "openai",
        model_picker_enabled: true,
      },
    ]);
    expect(invokeMock).toHaveBeenCalledWith("remote_fetch_copilot_models", {
      profile: remoteProfile,
      accountId: "github-1",
      secret,
    });
  });

  it("fetches Copilot usage through the remote helper command", async () => {
    const remoteProfile = profile();
    const secret: RemoteConnectionSecret = { password: "secret" };
    invokeMock.mockResolvedValueOnce({
      copilot_plan: "individual",
      quota_reset_date: "2026-01-01T00:00:00Z",
      quota_snapshots: {
        chat: {
          entitlement: 0,
          remaining: 0,
          percent_remaining: 0,
          unlimited: true,
        },
        completions: {
          entitlement: 0,
          remaining: 0,
          percent_remaining: 0,
          unlimited: true,
        },
        premium_interactions: {
          entitlement: 300,
          remaining: 200,
          percent_remaining: 66,
          unlimited: false,
        },
      },
    });

    const result = await remoteApi.fetchCopilotUsage(
      remoteProfile,
      "github-1",
      secret,
    );

    expect(result.copilot_plan).toBe("individual");
    expect(invokeMock).toHaveBeenCalledWith("remote_fetch_copilot_usage", {
      profile: remoteProfile,
      accountId: "github-1",
      secret,
    });
  });

  it("gets Codex OAuth quota through the remote helper command", async () => {
    const remoteProfile = profile();
    const secret: RemoteConnectionSecret = { password: "secret" };
    invokeMock.mockResolvedValueOnce({
      success: false,
      tool: "codex_oauth",
      credentialStatus: "not_found",
    });

    const result = await remoteApi.getCodexOauthQuota(
      remoteProfile,
      "chatgpt-1",
      secret,
    );

    expect(result).toEqual({
      success: false,
      tool: "codex_oauth",
      credentialStatus: "not_found",
    });
    expect(invokeMock).toHaveBeenCalledWith("remote_get_codex_oauth_quota", {
      profile: remoteProfile,
      accountId: "chatgpt-1",
      secret,
    });
  });

  it("gets xAI OAuth quota through the remote helper command", async () => {
    const remoteProfile = profile();
    const secret: RemoteConnectionSecret = { password: "secret" };
    invokeMock.mockResolvedValueOnce({
      success: false,
      tool: "xai_oauth",
      credentialStatus: "not_found",
    });

    const result = await remoteApi.getXaiOauthQuota(
      remoteProfile,
      "xai-1",
      secret,
    );

    expect(result).toEqual({
      success: false,
      tool: "xai_oauth",
      credentialStatus: "not_found",
    });
    expect(invokeMock).toHaveBeenCalledWith("remote_get_xai_oauth_quota", {
      profile: remoteProfile,
      accountId: "xai-1",
      secret,
    });
  });

  it("gets official subscription quota through the remote helper command", async () => {
    const remoteProfile = profile();
    const secret: RemoteConnectionSecret = { password: "secret" };
    invokeMock.mockResolvedValueOnce({
      success: false,
      tool: "claude",
      credentialStatus: "not_found",
    });

    const result = await remoteApi.getSubscriptionQuota(
      remoteProfile,
      "claude",
      secret,
    );

    expect(result).toEqual({
      success: false,
      tool: "claude",
      credentialStatus: "not_found",
    });
    expect(invokeMock).toHaveBeenCalledWith("remote_get_subscription_quota", {
      profile: remoteProfile,
      tool: "claude",
      secret,
    });
  });

  it("maps models.dev persistence commands to the remote helper", async () => {
    const remoteProfile = profile();
    const secret: RemoteConnectionSecret = { password: "secret" };
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

    invokeMock
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce({
        config,
        configPath: "/root/.cc-switch-remote/model-pricing.json",
      })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    await remoteApi.updateModelPricingBatch(remoteProfile, entries, secret);
    await remoteApi.getModelsDevSyncConfig(remoteProfile, secret);
    await remoteApi.saveModelsDevSyncConfig(remoteProfile, config, secret);
    await remoteApi.recordModelsDevSyncResult(remoteProfile, 123, null, secret);

    expect(invokeMock).toHaveBeenNthCalledWith(
      1,
      "remote_update_model_pricing_batch",
      { profile: remoteProfile, entries, secret },
    );
    expect(invokeMock).toHaveBeenNthCalledWith(
      2,
      "remote_get_models_dev_sync_config",
      { profile: remoteProfile, secret },
    );
    expect(invokeMock).toHaveBeenNthCalledWith(
      3,
      "remote_save_models_dev_sync_config",
      { profile: remoteProfile, config, secret },
    );
    expect(invokeMock).toHaveBeenNthCalledWith(
      4,
      "remote_record_models_dev_sync_result",
      {
        profile: remoteProfile,
        syncedAt: 123,
        error: null,
        secret,
      },
    );
  });

  it("queries provider usage through the remote helper command", async () => {
    const remoteProfile = profile();
    const secret: RemoteConnectionSecret = { password: "secret" };
    invokeMock.mockResolvedValueOnce({ success: true, data: [], error: null });

    const result = await remoteApi.queryProviderUsage(
      remoteProfile,
      "claude",
      "provider-1",
      secret,
    );

    expect(result).toEqual({ success: true, data: [], error: null });
    expect(invokeMock).toHaveBeenCalledWith("remote_query_provider_usage", {
      profile: remoteProfile,
      app: "claude",
      providerId: "provider-1",
      secret,
    });
  });

  it("tests provider usage scripts through the remote helper command", async () => {
    const remoteProfile = profile();
    const secret: RemoteConnectionSecret = { password: "secret" };
    invokeMock.mockResolvedValueOnce({ success: true, data: [], error: null });

    const options = {
      scriptCode: "({ request: {}, extractor: () => ({ remaining: 1 }) })",
      timeout: 10,
      apiKey: "api-key",
      baseUrl: "https://example.test",
      accessToken: "access-token",
      userId: "user-1",
      templateType: "custom",
    };
    const result = await remoteApi.testUsageScript(
      remoteProfile,
      "claude",
      "provider-1",
      options,
      secret,
    );

    expect(result).toEqual({ success: true, data: [], error: null });
    expect(invokeMock).toHaveBeenCalledWith("remote_test_usage_script", {
      profile: remoteProfile,
      app: "claude",
      providerId: "provider-1",
      options,
      secret,
    });
  });

  it("gets balance through the remote helper command", async () => {
    const remoteProfile = profile();
    const secret: RemoteConnectionSecret = { password: "secret" };
    invokeMock.mockResolvedValueOnce({ success: true, data: [], error: null });

    const options = {
      baseUrl: "https://example.test",
      apiKey: "api-key",
    };
    const result = await remoteApi.getBalance(remoteProfile, options, secret);

    expect(result).toEqual({ success: true, data: [], error: null });
    expect(invokeMock).toHaveBeenCalledWith("remote_get_balance", {
      profile: remoteProfile,
      options,
      secret,
    });
  });

  it("gets coding plan quota through the remote helper command", async () => {
    const remoteProfile = profile();
    const secret: RemoteConnectionSecret = { password: "secret" };
    invokeMock.mockResolvedValueOnce({
      success: false,
      tool: "coding_plan",
      credentialStatus: "not_found",
    });

    const options = {
      baseUrl: "https://example.test",
      apiKey: "api-key",
      accessKeyId: "ak",
      secretAccessKey: "sk",
    };
    const result = await remoteApi.getCodingPlanQuota(
      remoteProfile,
      options,
      secret,
    );

    expect(result).toEqual({
      success: false,
      tool: "coding_plan",
      credentialStatus: "not_found",
    });
    expect(invokeMock).toHaveBeenCalledWith("remote_get_coding_plan_quota", {
      profile: remoteProfile,
      options,
      secret,
    });
  });

  it("scans OpenClaw health through the remote helper command", async () => {
    const remoteProfile = profile();
    const secret: RemoteConnectionSecret = { password: "secret" };
    invokeMock.mockResolvedValueOnce([
      {
        code: "openclaw.config.missing",
        message: "Remote config missing",
      },
    ]);

    const result = await remoteApi.scanOpenClawHealth(remoteProfile, secret);

    expect(result).toEqual([
      {
        code: "openclaw.config.missing",
        message: "Remote config missing",
      },
    ]);
    expect(invokeMock).toHaveBeenCalledWith("remote_scan_openclaw_health", {
      profile: remoteProfile,
      secret,
    });
  });
});
