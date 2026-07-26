import { beforeEach, describe, expect, it, vi } from "vitest";
import { providersApi } from "./providers";
import type { ManagementTarget, RemoteHostProfile } from "./remote";

const invokeMock = vi.hoisted(() => vi.fn());
const remoteEnsureOfficialProviderMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("./remote", async () => {
  const actual = await vi.importActual<typeof import("./remote")>("./remote");
  return {
    ...actual,
    remoteApi: {
      ...actual.remoteApi,
      ensureOfficialProvider: (...args: unknown[]) =>
        remoteEnsureOfficialProviderMock(...args),
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

describe("providers API official seed target routing", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    remoteEnsureOfficialProviderMock.mockReset();
  });

  it("uses the local Grok Build official seed command by default", async () => {
    invokeMock.mockResolvedValueOnce(true);

    await providersApi.ensureGrokBuildOfficialProvider();

    expect(invokeMock).toHaveBeenCalledWith(
      "ensure_grokbuild_official_provider",
    );
    expect(remoteEnsureOfficialProviderMock).not.toHaveBeenCalled();
  });

  it("uses the remote helper for remote Grok Build official seed restore", async () => {
    remoteEnsureOfficialProviderMock.mockResolvedValueOnce(true);

    await providersApi.ensureGrokBuildOfficialProvider(remoteTarget);

    expect(remoteEnsureOfficialProviderMock).toHaveBeenCalledWith(
      remoteProfile,
      "grokbuild",
      remoteTarget.secret,
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
