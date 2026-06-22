import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchCodexOauthModels } from "./model-fetch";
import type { ManagementTarget, RemoteHostProfile } from "./remote";

const invokeMock = vi.hoisted(() => vi.fn());
const remoteFetchCodexOauthModelsMock = vi.hoisted(() => vi.fn());

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
    },
  };
});

const remoteProfile: RemoteHostProfile = {
  id: "pve-matx",
  name: "PVE-Matx",
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
