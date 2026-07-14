import { beforeEach, describe, expect, it, vi } from "vitest";
import { configApi } from "@/lib/api";
import type { ManagementTarget, RemoteHostProfile } from "./remote";

const invokeMock = vi.hoisted(() => vi.fn());
const remoteGetCommonConfigSnippetMock = vi.hoisted(() => vi.fn());
const remoteSetCommonConfigSnippetMock = vi.hoisted(() => vi.fn());
const remoteUpdateTomlCommonConfigSnippetMock = vi.hoisted(() => vi.fn());
const remoteExtractCommonConfigSnippetMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("./remote", async () => {
  const actual = await vi.importActual<typeof import("./remote")>("./remote");
  return {
    ...actual,
    remoteApi: {
      ...actual.remoteApi,
      getCommonConfigSnippet: (...args: unknown[]) =>
        remoteGetCommonConfigSnippetMock(...args),
      setCommonConfigSnippet: (...args: unknown[]) =>
        remoteSetCommonConfigSnippetMock(...args),
      updateTomlCommonConfigSnippet: (...args: unknown[]) =>
        remoteUpdateTomlCommonConfigSnippetMock(...args),
      extractCommonConfigSnippet: (...args: unknown[]) =>
        remoteExtractCommonConfigSnippetMock(...args),
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

describe("configApi target routing", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    remoteGetCommonConfigSnippetMock.mockReset();
    remoteSetCommonConfigSnippetMock.mockReset();
    remoteUpdateTomlCommonConfigSnippetMock.mockReset();
    remoteExtractCommonConfigSnippetMock.mockReset();
  });

  it("uses local Tauri commands by default", async () => {
    invokeMock.mockResolvedValueOnce("{}");

    await configApi.getCommonConfigSnippet("claude");

    expect(invokeMock).toHaveBeenCalledWith("get_common_config_snippet", {
      appType: "claude",
    });
    expect(remoteGetCommonConfigSnippetMock).not.toHaveBeenCalled();
  });

  it("uses the remote helper for common config reads and writes", async () => {
    remoteGetCommonConfigSnippetMock.mockResolvedValueOnce("{}");
    remoteSetCommonConfigSnippetMock.mockResolvedValueOnce(undefined);

    await configApi.getCommonConfigSnippet("codex", remoteTarget);
    await configApi.setCommonConfigSnippet(
      "codex",
      'model = "x"',
      remoteTarget,
    );

    expect(remoteGetCommonConfigSnippetMock).toHaveBeenCalledWith(
      remoteProfile,
      "codex",
      remoteTarget.secret,
    );
    expect(remoteSetCommonConfigSnippetMock).toHaveBeenCalledWith(
      remoteProfile,
      "codex",
      'model = "x"',
      remoteTarget.secret,
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("uses the remote helper for TOML merge and extraction", async () => {
    remoteUpdateTomlCommonConfigSnippetMock.mockResolvedValueOnce("[tui]");
    remoteExtractCommonConfigSnippetMock.mockResolvedValueOnce("[tui]");

    await configApi.updateTomlCommonConfigSnippet(
      "config",
      "[tui]",
      true,
      remoteTarget,
    );
    await configApi.extractCommonConfigSnippet(
      "codex",
      { settingsConfig: '{"config":"x"}' },
      remoteTarget,
    );

    expect(remoteUpdateTomlCommonConfigSnippetMock).toHaveBeenCalledWith(
      remoteProfile,
      "config",
      "[tui]",
      true,
      remoteTarget.secret,
    );
    expect(remoteExtractCommonConfigSnippetMock).toHaveBeenCalledWith(
      remoteProfile,
      "codex",
      { settingsConfig: '{"config":"x"}' },
      remoteTarget.secret,
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
