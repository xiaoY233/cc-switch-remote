import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchCodexOauthModels, getOpenCodeModels } from "./model-fetch";
import type { ManagementTarget, RemoteHostProfile } from "./remote";

const invokeMock = vi.hoisted(() => vi.fn());
const remoteFetchCodexOauthModelsMock = vi.hoisted(() => vi.fn());
const remoteGetOpenCodeModelsMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("./remote", async () => {
  const actual = await vi.importActual<typeof import("./remote")>("./remote");
  return {
    ...actual,
    remoteApi: {
      ...actual.remoteApi,
      fetchCodexOauthModels: (...args: unknown[]) =>
        remoteFetchCodexOauthModelsMock(...args),
      getOpenCodeModels: (...args: unknown[]) =>
        remoteGetOpenCodeModelsMock(...args),
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

describe("fetchCodexOauthModels", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    remoteFetchCodexOauthModelsMock.mockReset();
    remoteGetOpenCodeModelsMock.mockReset();
  });

  it("uses the local Codex OAuth command for local targets", async () => {
    invokeMock.mockResolvedValueOnce([{ id: "gpt-5", ownedBy: null }]);

    await expect(fetchCodexOauthModels("local-account")).resolves.toEqual([
      { id: "gpt-5", ownedBy: null },
    ]);

    expect(invokeMock).toHaveBeenCalledWith("get_codex_oauth_models", {
      accountId: "local-account",
    });
    expect(remoteFetchCodexOauthModelsMock).not.toHaveBeenCalled();
  });

  it("uses the remote helper for remote targets", async () => {
    remoteFetchCodexOauthModelsMock.mockResolvedValueOnce([
      { id: "gpt-5-remote", ownedBy: null },
    ]);

    await expect(
      fetchCodexOauthModels("remote-account", remoteTarget),
    ).resolves.toEqual([{ id: "gpt-5-remote", ownedBy: null }]);

    expect(remoteFetchCodexOauthModelsMock).toHaveBeenCalledWith(
      remoteProfile,
      "remote-account",
      remoteTarget.secret,
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe("getOpenCodeModels", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    remoteGetOpenCodeModelsMock.mockReset();
  });

  it("uses the local runtime-model command for a local target", async () => {
    invokeMock.mockResolvedValueOnce([
      { providerId: "local-oauth", modelId: "gpt-5-local" },
    ]);

    await expect(getOpenCodeModels()).resolves.toEqual([
      { providerId: "local-oauth", modelId: "gpt-5-local" },
    ]);

    expect(invokeMock).toHaveBeenCalledWith("get_opencode_models");
    expect(remoteGetOpenCodeModelsMock).not.toHaveBeenCalled();
  });

  it("uses only the remote helper for a remote target", async () => {
    remoteGetOpenCodeModelsMock.mockResolvedValueOnce([
      { providerId: "remote-oauth", modelId: "gpt-5-remote" },
    ]);

    await expect(getOpenCodeModels(remoteTarget)).resolves.toEqual([
      { providerId: "remote-oauth", modelId: "gpt-5-remote" },
    ]);

    expect(remoteGetOpenCodeModelsMock).toHaveBeenCalledWith(
      remoteProfile,
      remoteTarget.secret,
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
