import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ManagementTarget, RemoteHostProfile } from "./remote";

const invokeMock = vi.fn();
const remoteGetStreamCheckConfigMock = vi.fn();
const remoteSaveStreamCheckConfigMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("./remote", () => ({
  remoteApi: {
    getStreamCheckConfig: (...args: unknown[]) =>
      remoteGetStreamCheckConfigMock(...args),
    saveStreamCheckConfig: (...args: unknown[]) =>
      remoteSaveStreamCheckConfigMock(...args),
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

describe("stream check config API", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    remoteGetStreamCheckConfigMock.mockReset();
    remoteSaveStreamCheckConfigMock.mockReset();
  });

  it("loads and saves config through remote API when target is remote", async () => {
    const { getStreamCheckConfig, saveStreamCheckConfig } = await import(
      "./connectivity-check"
    );
    const config = {
      timeoutSecs: 12,
      maxRetries: 3,
      degradedThresholdMs: 9000,
    };
    remoteGetStreamCheckConfigMock.mockResolvedValue(config);
    remoteSaveStreamCheckConfigMock.mockResolvedValue(true);

    await expect(
      (getStreamCheckConfig as (target: ManagementTarget) => Promise<unknown>)(
        remoteTarget,
      ),
    ).resolves.toEqual(config);
    await saveStreamCheckConfig(config, remoteTarget);

    expect(remoteGetStreamCheckConfigMock).toHaveBeenCalledWith(
      profile,
      remoteTarget.secret,
    );
    expect(remoteSaveStreamCheckConfigMock).toHaveBeenCalledWith(
      profile,
      config,
      remoteTarget.secret,
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
