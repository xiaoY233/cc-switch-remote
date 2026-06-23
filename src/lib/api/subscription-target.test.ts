import { beforeEach, describe, expect, it, vi } from "vitest";
import { subscriptionApi } from "./subscription";
import type { ManagementTarget, RemoteHostProfile } from "./remote";

const invokeMock = vi.hoisted(() => vi.fn());
const remoteGetCodexOauthQuotaMock = vi.hoisted(() => vi.fn());
const remoteGetSubscriptionQuotaMock = vi.hoisted(() => vi.fn());
const remoteGetBalanceMock = vi.hoisted(() => vi.fn());
const remoteGetCodingPlanQuotaMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("./remote", async () => {
  const actual = await vi.importActual<typeof import("./remote")>("./remote");
  return {
    ...actual,
    remoteApi: {
      ...actual.remoteApi,
      getCodexOauthQuota: (...args: unknown[]) =>
        remoteGetCodexOauthQuotaMock(...args),
      getSubscriptionQuota: (...args: unknown[]) =>
        remoteGetSubscriptionQuotaMock(...args),
      getBalance: (...args: unknown[]) => remoteGetBalanceMock(...args),
      getCodingPlanQuota: (...args: unknown[]) =>
        remoteGetCodingPlanQuotaMock(...args),
    },
  };
});

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

describe("subscriptionApi.getCodexOauthQuota", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    remoteGetCodexOauthQuotaMock.mockReset();
    remoteGetSubscriptionQuotaMock.mockReset();
    remoteGetBalanceMock.mockReset();
    remoteGetCodingPlanQuotaMock.mockReset();
  });

  it("uses the local Codex OAuth quota command for local targets", async () => {
    invokeMock.mockResolvedValueOnce({
      success: false,
      tool: "codex_oauth",
      credentialStatus: "not_found",
    });

    await subscriptionApi.getCodexOauthQuota("local-account");

    expect(invokeMock).toHaveBeenCalledWith("get_codex_oauth_quota", {
      accountId: "local-account",
    });
    expect(remoteGetCodexOauthQuotaMock).not.toHaveBeenCalled();
  });

  it("uses the remote helper for remote targets", async () => {
    remoteGetCodexOauthQuotaMock.mockResolvedValueOnce({
      success: false,
      tool: "codex_oauth",
      credentialStatus: "not_found",
    });

    await subscriptionApi.getCodexOauthQuota("remote-account", remoteTarget);

    expect(remoteGetCodexOauthQuotaMock).toHaveBeenCalledWith(
      remoteProfile,
      "remote-account",
      remoteTarget.secret,
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe("subscriptionApi.getQuota", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    remoteGetCodexOauthQuotaMock.mockReset();
    remoteGetSubscriptionQuotaMock.mockReset();
    remoteGetBalanceMock.mockReset();
    remoteGetCodingPlanQuotaMock.mockReset();
  });

  it("uses the local official subscription quota command for local targets", async () => {
    invokeMock.mockResolvedValueOnce({
      success: false,
      tool: "claude",
      credentialStatus: "not_found",
    });

    await subscriptionApi.getQuota("claude");

    expect(invokeMock).toHaveBeenCalledWith("get_subscription_quota", {
      tool: "claude",
    });
  });

  it("uses the remote helper for remote official subscription quota", async () => {
    remoteGetSubscriptionQuotaMock.mockResolvedValueOnce({
      success: false,
      tool: "claude",
      credentialStatus: "not_found",
      credentialMessage: null,
      tiers: [],
      extraUsage: null,
      error: null,
      queriedAt: null,
    });

    await subscriptionApi.getQuota("claude", remoteTarget);

    expect(remoteGetSubscriptionQuotaMock).toHaveBeenCalledWith(
      remoteProfile,
      "claude",
      remoteTarget.secret,
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe("subscriptionApi remote usage helpers", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    remoteGetBalanceMock.mockReset();
    remoteGetCodingPlanQuotaMock.mockReset();
  });

  it("uses the remote helper for balance queries", async () => {
    remoteGetBalanceMock.mockResolvedValueOnce({
      success: true,
      data: [],
      error: null,
    });

    await subscriptionApi.getBalance(
      "https://example.test",
      "api-key",
      remoteTarget,
    );

    expect(remoteGetBalanceMock).toHaveBeenCalledWith(
      remoteProfile,
      {
        baseUrl: "https://example.test",
        apiKey: "api-key",
      },
      remoteTarget.secret,
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("uses the remote helper for coding plan quota queries", async () => {
    remoteGetCodingPlanQuotaMock.mockResolvedValueOnce({
      success: false,
      tool: "coding_plan",
      credentialStatus: "not_found",
      credentialMessage: null,
      tiers: [],
      extraUsage: null,
      error: null,
      queriedAt: null,
    });

    await subscriptionApi.getCodingPlanQuota(
      "https://example.test",
      "api-key",
      "ak",
      "sk",
      remoteTarget,
    );

    expect(remoteGetCodingPlanQuotaMock).toHaveBeenCalledWith(
      remoteProfile,
      {
        baseUrl: "https://example.test",
        apiKey: "api-key",
        accessKeyId: "ak",
        secretAccessKey: "sk",
      },
      remoteTarget.secret,
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
