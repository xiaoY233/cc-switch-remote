import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ManagementTarget, RemoteHostProfile } from "./remote";

const invokeMock = vi.fn();
const remoteAuthGetStatusMock = vi.fn();
const remoteAuthStartLoginMock = vi.fn();
const remoteAuthPollForAccountMock = vi.fn();
const remoteAuthCancelLoginMock = vi.fn();
const remoteAuthRemoveAccountMock = vi.fn();
const remoteAuthSetDefaultAccountMock = vi.fn();
const remoteAuthLogoutMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("./remote", () => ({
  remoteApi: {
    authGetStatus: (...args: unknown[]) => remoteAuthGetStatusMock(...args),
    authStartLogin: (...args: unknown[]) => remoteAuthStartLoginMock(...args),
    authPollForAccount: (...args: unknown[]) =>
      remoteAuthPollForAccountMock(...args),
    authCancelLogin: (...args: unknown[]) => remoteAuthCancelLoginMock(...args),
    authRemoveAccount: (...args: unknown[]) =>
      remoteAuthRemoveAccountMock(...args),
    authSetDefaultAccount: (...args: unknown[]) =>
      remoteAuthSetDefaultAccountMock(...args),
    authLogout: (...args: unknown[]) => remoteAuthLogoutMock(...args),
  },
}));

const profile: RemoteHostProfile = {
  id: "remote-auth",
  name: "Remote Auth",
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

describe("managed auth API", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    remoteAuthGetStatusMock.mockReset();
    remoteAuthStartLoginMock.mockReset();
    remoteAuthPollForAccountMock.mockReset();
    remoteAuthCancelLoginMock.mockReset();
    remoteAuthRemoveAccountMock.mockReset();
    remoteAuthSetDefaultAccountMock.mockReset();
    remoteAuthLogoutMock.mockReset();
  });

  it("routes managed auth operations to the selected remote target", async () => {
    const { authApi } = await import("./auth");
    const status = {
      provider: "github_copilot",
      authenticated: false,
      default_account_id: null,
      accounts: [],
    };
    const deviceCode = {
      provider: "github_copilot",
      device_code: "device",
      user_code: "ABCD-1234",
      verification_uri: "https://github.com/login/device",
      expires_in: 900,
      interval: 5,
    };
    remoteAuthGetStatusMock.mockResolvedValue(status);
    remoteAuthStartLoginMock.mockResolvedValue(deviceCode);
    remoteAuthPollForAccountMock.mockResolvedValue(null);
    remoteAuthCancelLoginMock.mockResolvedValue(true);
    remoteAuthRemoveAccountMock.mockResolvedValue(undefined);
    remoteAuthSetDefaultAccountMock.mockResolvedValue(undefined);
    remoteAuthLogoutMock.mockResolvedValue(undefined);

    await expect(
      authApi.authGetStatus("github_copilot", remoteTarget),
    ).resolves.toEqual(status);
    await expect(
      authApi.authStartLogin("github_copilot", "github.com", remoteTarget),
    ).resolves.toEqual(deviceCode);
    await expect(
      authApi.authStartLogin(
        "codex_oauth",
        undefined,
        remoteTarget,
        "account-1",
      ),
    ).resolves.toEqual(deviceCode);
    await expect(
      authApi.authPollForAccount(
        "github_copilot",
        "device",
        "github.com",
        remoteTarget,
      ),
    ).resolves.toBeNull();
    await expect(
      authApi.authCancelLogin("codex_oauth", "device", remoteTarget),
    ).resolves.toBe(true);
    await expect(
      authApi.authRemoveAccount("github_copilot", "account-1", remoteTarget),
    ).resolves.toBeUndefined();
    await expect(
      authApi.authSetDefaultAccount(
        "github_copilot",
        "account-1",
        remoteTarget,
      ),
    ).resolves.toBeUndefined();
    await expect(
      authApi.authLogout("github_copilot", remoteTarget),
    ).resolves.toBeUndefined();

    expect(remoteAuthGetStatusMock).toHaveBeenCalledWith(
      profile,
      "github_copilot",
      remoteTarget.secret,
    );
    expect(remoteAuthStartLoginMock).toHaveBeenCalledWith(
      profile,
      "github_copilot",
      "github.com",
      undefined,
      remoteTarget.secret,
    );
    expect(remoteAuthStartLoginMock).toHaveBeenCalledWith(
      profile,
      "codex_oauth",
      undefined,
      "account-1",
      remoteTarget.secret,
    );
    expect(remoteAuthPollForAccountMock).toHaveBeenCalledWith(
      profile,
      "github_copilot",
      "device",
      "github.com",
      remoteTarget.secret,
    );
    expect(remoteAuthCancelLoginMock).toHaveBeenCalledWith(
      profile,
      "codex_oauth",
      "device",
      remoteTarget.secret,
    );
    expect(remoteAuthRemoveAccountMock).toHaveBeenCalledWith(
      profile,
      "github_copilot",
      "account-1",
      remoteTarget.secret,
    );
    expect(remoteAuthSetDefaultAccountMock).toHaveBeenCalledWith(
      profile,
      "github_copilot",
      "account-1",
      remoteTarget.secret,
    );
    expect(remoteAuthLogoutMock).toHaveBeenCalledWith(
      profile,
      "github_copilot",
      remoteTarget.secret,
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("keeps targeted reauthentication and cancellation on the local Tauri target", async () => {
    const { authApi } = await import("./auth");
    invokeMock.mockResolvedValueOnce({ device_code: "device" });
    invokeMock.mockResolvedValueOnce(true);

    await authApi.authStartLogin(
      "codex_oauth",
      undefined,
      { type: "local" },
      "account-1",
    );
    await authApi.authCancelLogin("codex_oauth", "device", { type: "local" });

    expect(invokeMock).toHaveBeenNthCalledWith(1, "auth_start_login", {
      authProvider: "codex_oauth",
      githubDomain: null,
      targetAccountId: "account-1",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "auth_cancel_login", {
      authProvider: "codex_oauth",
      deviceCode: "device",
    });
    expect(remoteAuthStartLoginMock).not.toHaveBeenCalled();
    expect(remoteAuthCancelLoginMock).not.toHaveBeenCalled();
  });
});
