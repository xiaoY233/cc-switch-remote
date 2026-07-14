import { beforeEach, describe, expect, it, vi } from "vitest";
import { omoApi, omoSlimApi } from "./omo";
import type { ManagementTarget, RemoteHostProfile } from "./remote";

const invokeMock = vi.hoisted(() => vi.fn());
const remoteReadOmoLocalFileMock = vi.hoisted(() => vi.fn());
const remoteGetCurrentOmoProviderIdMock = vi.hoisted(() => vi.fn());
const remoteDisableCurrentOmoMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("./remote", async () => {
  const actual = await vi.importActual<typeof import("./remote")>("./remote");
  return {
    ...actual,
    remoteApi: {
      ...actual.remoteApi,
      readOmoLocalFile: (...args: unknown[]) =>
        remoteReadOmoLocalFileMock(...args),
      getCurrentOmoProviderId: (...args: unknown[]) =>
        remoteGetCurrentOmoProviderIdMock(...args),
      disableCurrentOmo: (...args: unknown[]) =>
        remoteDisableCurrentOmoMock(...args),
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

describe("OMO API target routing", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    remoteReadOmoLocalFileMock.mockReset();
    remoteGetCurrentOmoProviderIdMock.mockReset();
    remoteDisableCurrentOmoMock.mockReset();
  });

  it("uses local commands by default", async () => {
    invokeMock.mockResolvedValueOnce("omo-provider");

    await omoApi.getCurrentOmoProviderId();

    expect(invokeMock).toHaveBeenCalledWith("get_current_omo_provider_id");
    expect(remoteGetCurrentOmoProviderIdMock).not.toHaveBeenCalled();
  });

  it("uses the remote helper for OMO current state and disable", async () => {
    remoteGetCurrentOmoProviderIdMock.mockResolvedValueOnce("omo-provider");
    remoteDisableCurrentOmoMock.mockResolvedValueOnce(undefined);

    await omoApi.getCurrentOmoProviderId(remoteTarget);
    await omoApi.disableCurrentOmo(remoteTarget);

    expect(remoteGetCurrentOmoProviderIdMock).toHaveBeenCalledWith(
      remoteProfile,
      "omo",
      remoteTarget.secret,
    );
    expect(remoteDisableCurrentOmoMock).toHaveBeenCalledWith(
      remoteProfile,
      "omo",
      remoteTarget.secret,
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("uses the remote helper for OMO Slim current state", async () => {
    remoteReadOmoLocalFileMock.mockResolvedValueOnce({
      filePath: "/root/.config/opencode/oh-my-opencode.jsonc",
      lastModified: null,
      agents: null,
      categories: null,
      otherFields: null,
    });

    await omoSlimApi.readLocalFile(remoteTarget);

    expect(remoteReadOmoLocalFileMock).toHaveBeenCalledWith(
      remoteProfile,
      "omo-slim",
      remoteTarget.secret,
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
