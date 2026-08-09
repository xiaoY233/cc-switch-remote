import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRemoteSettings } from "@/hooks/useRemoteSettings";
import type { RemoteHostProfile } from "@/lib/api";
import type { Settings } from "@/types";

const invalidateQueriesMock = vi.fn();
const getSettingsMock = vi.fn();
const saveSettingsMock = vi.fn();
const getCurrentProviderMock = vi.fn();
const applyClaudePluginConfigMock = vi.fn();

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: invalidateQueriesMock }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? _key,
  }),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

vi.mock("@/lib/api", () => ({
  remoteApi: {
    getSettings: (...args: unknown[]) => getSettingsMock(...args),
    getInstalledSkills: vi.fn().mockResolvedValue([]),
    saveSettings: (...args: unknown[]) => saveSettingsMock(...args),
    getCurrentProvider: (...args: unknown[]) => getCurrentProviderMock(...args),
    getProviders: vi.fn(),
    applyClaudePluginConfig: (...args: unknown[]) =>
      applyClaudePluginConfigMock(...args),
    setClaudeOnboardingSkip: vi.fn(),
    migrateSkillStorage: vi.fn(),
  },
}));

const profile: RemoteHostProfile = {
  id: "remote-settings-host",
  name: "Remote Settings Host",
  host: "192.0.2.30",
  port: 22,
  username: "root",
  authMethod: { type: "sshAgent" },
  helperPath: "/root/.local/bin/cc-switch-remote-helper",
  createdAt: 1,
  updatedAt: 1,
};

const target = {
  type: "remote" as const,
  profile,
  secret: { password: "secret" },
};

describe("useRemoteSettings runtime model cache", () => {
  beforeEach(() => {
    invalidateQueriesMock.mockReset();
    getSettingsMock.mockReset();
    saveSettingsMock.mockReset();
    getCurrentProviderMock.mockReset();
    applyClaudePluginConfigMock.mockReset();
  });

  it("invalidates only the selected remote runtime-model query after save succeeds", async () => {
    const settings = {
      opencodeConfigDir: "/old/opencode",
    } as Settings;
    getSettingsMock.mockResolvedValue(settings);
    saveSettingsMock.mockResolvedValue(undefined);

    const { result } = renderHook(() => useRemoteSettings({ target }));

    await act(async () => {
      await result.current.loadSettings(false);
    });
    await act(async () => {
      expect(
        await result.current.saveSettings({
          opencodeConfigDir: "/new/opencode",
        }),
      ).toBe(true);
    });

    expect(invalidateQueriesMock).toHaveBeenCalledTimes(1);
    expect(invalidateQueriesMock).toHaveBeenCalledWith({
      queryKey: ["opencode", "runtime-models", "remote:remote-settings-host"],
    });
  });

  it("keeps the selected remote runtime-model cache when save fails", async () => {
    getSettingsMock.mockResolvedValue({
      opencodeConfigDir: "/old/opencode",
    } as Settings);
    saveSettingsMock.mockRejectedValue(new Error("save failed"));

    const { result } = renderHook(() => useRemoteSettings({ target }));
    await act(async () => {
      await result.current.loadSettings(false);
    });
    await act(async () => {
      expect(
        await result.current.saveSettings({
          opencodeConfigDir: "/new/opencode",
        }),
      ).toBe(false);
    });

    expect(invalidateQueriesMock).not.toHaveBeenCalled();
  });

  it("invalidates the selected remote runtime-model query when a post-save sync fails", async () => {
    const previousSettings = {
      opencodeConfigDir: "/old/opencode",
      enableClaudePluginIntegration: false,
    } as Settings;
    getSettingsMock.mockResolvedValue(previousSettings);
    saveSettingsMock.mockResolvedValue(undefined);
    getCurrentProviderMock.mockResolvedValue(null);
    applyClaudePluginConfigMock.mockRejectedValue(
      new Error("plugin sync failed"),
    );
    const onSettingsSaved = vi.fn();

    const { result } = renderHook(() =>
      useRemoteSettings({ target, onSettingsSaved }),
    );
    await act(async () => {
      await result.current.loadSettings(false);
    });
    await act(async () => {
      expect(
        await result.current.saveSettings({
          opencodeConfigDir: "/new/opencode",
          enableClaudePluginIntegration: true,
        }),
      ).toBe(false);
    });

    expect(saveSettingsMock).toHaveBeenCalledTimes(1);
    expect(applyClaudePluginConfigMock).toHaveBeenCalledTimes(1);
    expect(invalidateQueriesMock).toHaveBeenCalledTimes(1);
    expect(invalidateQueriesMock).toHaveBeenCalledWith({
      queryKey: ["opencode", "runtime-models", "remote:remote-settings-host"],
    });
    expect(result.current.settings).toEqual(previousSettings);
    expect(onSettingsSaved).toHaveBeenLastCalledWith(previousSettings);
  });
});
