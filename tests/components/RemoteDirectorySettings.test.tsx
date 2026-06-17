import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RemoteDirectorySettings } from "@/components/settings/RemoteDirectorySettings";
import type { ManagementTarget } from "@/lib/api";
import type { Settings } from "@/types";

const getAppConfigDirOverrideMock = vi.fn();
const setAppConfigDirOverrideMock = vi.fn();
const toastErrorMock = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

vi.mock("@/lib/api", () => ({
  settingsApi: {
    getAppConfigDirOverride: (...args: unknown[]) =>
      getAppConfigDirOverrideMock(...args),
    setAppConfigDirOverride: (...args: unknown[]) =>
      setAppConfigDirOverrideMock(...args),
  },
}));

const target: Extract<ManagementTarget, { type: "remote" }> = {
  type: "remote",
  profile: {
    id: "remote-1",
    name: "Remote 1",
    host: "192.168.1.20",
    port: 22,
    username: "root",
    authMethod: { type: "password" },
    helperPath: "~/.local/bin/cc-switch-remote-helper",
    createdAt: 1,
    updatedAt: 1,
  },
  secret: { password: "secret" },
};

function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    claudeConfigDir: "/srv/claude",
    codexConfigDir: "/srv/codex",
    geminiConfigDir: undefined,
    opencodeConfigDir: undefined,
    openclawConfigDir: undefined,
    hermesConfigDir: undefined,
    ...overrides,
  } as Settings;
}

describe("RemoteDirectorySettings", () => {
  beforeEach(() => {
    getAppConfigDirOverrideMock.mockReset();
    setAppConfigDirOverrideMock.mockReset();
    toastErrorMock.mockReset();
  });

  it("edits remote app config directory overrides without local browse buttons", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    getAppConfigDirOverrideMock.mockResolvedValue("/srv/cc-switch");
    setAppConfigDirOverrideMock.mockResolvedValue(true);
    render(
      <RemoteDirectorySettings
        target={target}
        settings={settings()}
        onSave={onSave}
      />,
    );

    expect(screen.queryByTitle("settings.browseDirectory")).toBeNull();
    expect(screen.getByDisplayValue("/srv/claude")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByDisplayValue("/srv/cc-switch")).toBeInTheDocument(),
    );

    const codexInput = screen.getByDisplayValue("/srv/codex");
    fireEvent.change(codexInput, { target: { value: " /remote/codex " } });

    const saveButtons = screen.getAllByTitle("common.save");
    fireEvent.click(saveButtons[2]);

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        codexConfigDir: "/remote/codex",
      }),
    );
  });

  it("shows a helper update notice instead of a low-level error for old helpers", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    getAppConfigDirOverrideMock.mockRejectedValue(
      new Error(
        "Remote app config dir task failed: unsupported_command: Supported commands: status, settings",
      ),
    );

    render(
      <RemoteDirectorySettings
        target={target}
        settings={settings()}
        onSave={onSave}
      />,
    );

    expect(
      await screen.findByText(
        "当前远程 Helper 不支持 CC Switch 配置目录管理。请更新 Helper 后再使用。",
      ),
    ).toBeInTheDocument();
    expect(toastErrorMock).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("/srv/claude")).toBeInTheDocument();
  });
});
