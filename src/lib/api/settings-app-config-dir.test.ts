import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ManagementTarget, RemoteHostProfile } from "./remote";

const invokeMock = vi.fn();
const remoteGetAppConfigDirMock = vi.fn();
const remoteSetAppConfigDirMock = vi.fn();
const remoteApplyClaudePluginConfigMock = vi.fn();
const remoteGetSettingsMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("./remote", () => ({
  remoteApi: {
    getAppConfigDir: (...args: unknown[]) => remoteGetAppConfigDirMock(...args),
    setAppConfigDir: (...args: unknown[]) => remoteSetAppConfigDirMock(...args),
    applyClaudePluginConfig: (...args: unknown[]) =>
      remoteApplyClaudePluginConfigMock(...args),
    getSettings: (...args: unknown[]) => remoteGetSettingsMock(...args),
  },
}));

const profile: RemoteHostProfile = {
  id: "remote-1",
  name: "Remote 1",
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

describe("app config dir API", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    remoteGetAppConfigDirMock.mockReset();
    remoteSetAppConfigDirMock.mockReset();
    remoteApplyClaudePluginConfigMock.mockReset();
    remoteGetSettingsMock.mockReset();
  });

  it("loads and saves the remote app config dir through remote API", async () => {
    const { settingsApi } = await import("./settings");
    remoteGetAppConfigDirMock.mockResolvedValue("/srv/cc-switch");
    remoteSetAppConfigDirMock.mockResolvedValue(true);

    await expect(
      settingsApi.getAppConfigDirOverride(remoteTarget),
    ).resolves.toBe("/srv/cc-switch");
    await expect(
      settingsApi.setAppConfigDirOverride("/srv/cc-switch", remoteTarget),
    ).resolves.toBe(true);

    expect(remoteGetAppConfigDirMock).toHaveBeenCalledWith(
      profile,
      remoteTarget.secret,
    );
    expect(remoteSetAppConfigDirMock).toHaveBeenCalledWith(
      profile,
      "/srv/cc-switch",
      remoteTarget.secret,
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("loads settings through the selected remote target", async () => {
    const { settingsApi } = await import("./settings");
    remoteGetSettingsMock.mockResolvedValue({
      language: "zh",
      theme: "dark",
    });

    await expect(settingsApi.get(remoteTarget)).resolves.toEqual({
      language: "zh",
      theme: "dark",
    });

    expect(remoteGetSettingsMock).toHaveBeenCalledWith(
      profile,
      remoteTarget.secret,
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("applies Claude plugin config through the selected remote target", async () => {
    const { settingsApi } = await import("./settings");
    remoteApplyClaudePluginConfigMock.mockResolvedValue(true);

    await expect(
      settingsApi.applyClaudePluginConfig({ official: false }, remoteTarget),
    ).resolves.toBe(true);

    expect(remoteApplyClaudePluginConfigMock).toHaveBeenCalledWith(
      profile,
      false,
      remoteTarget.secret,
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
