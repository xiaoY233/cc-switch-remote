import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ManagementTarget, RemoteHostProfile } from "./remote";

const invokeMock = vi.fn();
const remoteGetLogConfigMock = vi.fn();
const remoteSetLogConfigMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("./remote", () => ({
  remoteApi: {
    getLogConfig: (...args: unknown[]) => remoteGetLogConfigMock(...args),
    setLogConfig: (...args: unknown[]) => remoteSetLogConfigMock(...args),
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

describe("log config API", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    remoteGetLogConfigMock.mockReset();
    remoteSetLogConfigMock.mockReset();
  });

  it("loads and saves log config through remote API when target is remote", async () => {
    const { settingsApi } = await import("./settings");
    const config = { enabled: false, level: "debug" as const };
    remoteGetLogConfigMock.mockResolvedValue(config);
    remoteSetLogConfigMock.mockResolvedValue(true);

    await expect(settingsApi.getLogConfig(remoteTarget)).resolves.toEqual(
      config,
    );
    await expect(settingsApi.setLogConfig(config, remoteTarget)).resolves.toBe(
      true,
    );

    expect(remoteGetLogConfigMock).toHaveBeenCalledWith(
      profile,
      remoteTarget.secret,
    );
    expect(remoteSetLogConfigMock).toHaveBeenCalledWith(
      profile,
      config,
      remoteTarget.secret,
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
