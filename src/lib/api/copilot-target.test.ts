import { beforeEach, describe, expect, it, vi } from "vitest";
import { copilotGetModelsForTarget, copilotGetUsageForTarget } from "./copilot";
import type { ManagementTarget, RemoteHostProfile } from "./remote";

const invokeMock = vi.hoisted(() => vi.fn());
const remoteFetchCopilotModelsMock = vi.hoisted(() => vi.fn());
const remoteFetchCopilotUsageMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("./remote", () => ({
  remoteApi: {
    fetchCopilotModels: (...args: unknown[]) =>
      remoteFetchCopilotModelsMock(...args),
    fetchCopilotUsage: (...args: unknown[]) =>
      remoteFetchCopilotUsageMock(...args),
  },
}));

const remoteProfile: RemoteHostProfile = {
  id: "remote-host",
  name: "Remote Host",
  host: "192.0.2.10",
  port: 22,
  username: "root",
  authMethod: { type: "sshAgent" },
  helperPath: "/root/.local/bin/cc-switch-remote-helper",
  createdAt: 1,
  updatedAt: 1,
};

const remoteTarget: ManagementTarget = {
  type: "remote",
  profile: remoteProfile,
  secret: { password: "secret" },
};

describe("copilotGetModelsForTarget", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    remoteFetchCopilotModelsMock.mockReset();
    remoteFetchCopilotUsageMock.mockReset();
  });

  it("uses the local default Copilot models command for local targets", async () => {
    invokeMock.mockResolvedValueOnce([
      {
        id: "gpt-5-copilot",
        name: "GPT-5 Copilot",
        vendor: "openai",
        model_picker_enabled: true,
      },
    ]);

    await expect(copilotGetModelsForTarget()).resolves.toHaveLength(1);

    expect(invokeMock).toHaveBeenCalledWith("copilot_get_models");
    expect(remoteFetchCopilotModelsMock).not.toHaveBeenCalled();
  });

  it("uses the local account-specific command for local account targets", async () => {
    invokeMock.mockResolvedValueOnce([]);

    await copilotGetModelsForTarget("github-1");

    expect(invokeMock).toHaveBeenCalledWith("copilot_get_models_for_account", {
      accountId: "github-1",
    });
    expect(remoteFetchCopilotModelsMock).not.toHaveBeenCalled();
  });

  it("uses the remote helper for remote targets", async () => {
    remoteFetchCopilotModelsMock.mockResolvedValueOnce([]);

    await copilotGetModelsForTarget("github-remote", remoteTarget);

    expect(remoteFetchCopilotModelsMock).toHaveBeenCalledWith(
      remoteProfile,
      "github-remote",
      remoteTarget.secret,
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe("copilotGetUsageForTarget", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    remoteFetchCopilotModelsMock.mockReset();
    remoteFetchCopilotUsageMock.mockReset();
  });

  it("uses the local default Copilot usage command for local targets", async () => {
    invokeMock.mockResolvedValueOnce({
      copilot_plan: "individual",
      quota_reset_date: "2026-01-01T00:00:00Z",
      quota_snapshots: {
        chat: { entitlement: 0, remaining: 0, percent_remaining: 0, unlimited: true },
        completions: { entitlement: 0, remaining: 0, percent_remaining: 0, unlimited: true },
        premium_interactions: {
          entitlement: 300,
          remaining: 200,
          percent_remaining: 66,
          unlimited: false,
        },
      },
    });

    await copilotGetUsageForTarget();

    expect(invokeMock).toHaveBeenCalledWith("copilot_get_usage");
    expect(remoteFetchCopilotUsageMock).not.toHaveBeenCalled();
  });

  it("uses the local account-specific command for local account targets", async () => {
    invokeMock.mockResolvedValueOnce({
      copilot_plan: "individual",
      quota_reset_date: "2026-01-01T00:00:00Z",
      quota_snapshots: {
        chat: { entitlement: 0, remaining: 0, percent_remaining: 0, unlimited: true },
        completions: { entitlement: 0, remaining: 0, percent_remaining: 0, unlimited: true },
        premium_interactions: {
          entitlement: 300,
          remaining: 200,
          percent_remaining: 66,
          unlimited: false,
        },
      },
    });

    await copilotGetUsageForTarget("github-1");

    expect(invokeMock).toHaveBeenCalledWith("copilot_get_usage_for_account", {
      accountId: "github-1",
    });
    expect(remoteFetchCopilotUsageMock).not.toHaveBeenCalled();
  });

  it("uses the remote helper for remote targets", async () => {
    remoteFetchCopilotUsageMock.mockResolvedValueOnce({
      copilot_plan: "business",
      quota_reset_date: "2026-01-01T00:00:00Z",
      quota_snapshots: {
        chat: { entitlement: 0, remaining: 0, percent_remaining: 0, unlimited: true },
        completions: { entitlement: 0, remaining: 0, percent_remaining: 0, unlimited: true },
        premium_interactions: {
          entitlement: 300,
          remaining: 250,
          percent_remaining: 83,
          unlimited: false,
        },
      },
    });

    await copilotGetUsageForTarget("github-remote", remoteTarget);

    expect(remoteFetchCopilotUsageMock).toHaveBeenCalledWith(
      remoteProfile,
      "github-remote",
      remoteTarget.secret,
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
