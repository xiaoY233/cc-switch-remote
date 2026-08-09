import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RemoteSettingsPage } from "@/components/settings/RemoteSettingsPage";
import type { RemoteHostProfile } from "@/lib/api";
import type { Settings } from "@/types";

const checkHealthMock = vi.fn();
const getSettingsMock = vi.fn();
const saveSettingsMock = vi.fn();
const getInstalledSkillsMock = vi.fn();
const migrateSkillStorageMock = vi.fn();
const startProxyServerMock = vi.fn();
const stopWithRestoreMock = vi.fn();
const hasCodexUnifyHistoryBackupMock = vi.fn();
const restoreCodexUnifiedHistoryMock = vi.fn();
let proxyRunning = false;

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  };
});

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<any>("@/lib/api");
  return {
    ...actual,
    settingsApi: {
      ...actual.settingsApi,
      hasCodexUnifyHistoryBackup: (...args: unknown[]) =>
        hasCodexUnifyHistoryBackupMock(...args),
      restoreCodexUnifiedHistory: (...args: unknown[]) =>
        restoreCodexUnifiedHistoryMock(...args),
    },
    remoteApi: {
      ...actual.remoteApi,
      checkHealth: (...args: unknown[]) => checkHealthMock(...args),
      getSettings: (...args: unknown[]) => getSettingsMock(...args),
      saveSettings: (...args: unknown[]) => saveSettingsMock(...args),
      getInstalledSkills: (...args: unknown[]) =>
        getInstalledSkillsMock(...args),
      migrateSkillStorage: (...args: unknown[]) =>
        migrateSkillStorageMock(...args),
    },
  };
});

vi.mock("@/hooks/useProxyStatus", () => ({
  useProxyStatus: () => ({
    isRunning: proxyRunning,
    status: null,
    takeoverStatus: {},
    startProxyServer: startProxyServerMock,
    stopWithRestore: stopWithRestoreMock,
    isStarting: false,
    isStopping: false,
    isPending: false,
  }),
}));

vi.mock("@/lib/query/proxy", () => ({
  useAppProxyConfig: () => ({
    data: {
      appType: "claude",
      enabled: false,
      targetUrl: "http://127.0.0.1:15721",
    },
  }),
  useUpdateAppProxyConfig: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useGlobalProxyConfig: () => ({
    data: {
      listenAddress: "127.0.0.1",
      listenPort: 15721,
      enableLogging: true,
    },
  }),
  useUpdateGlobalProxyConfig: () => ({ mutateAsync: vi.fn() }),
  useProxyTakeoverStatus: () => ({ data: {} }),
  useSetProxyTakeoverForApp: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/components/proxy/FailoverQueueManager", () => ({
  FailoverQueueManager: () => <div data-testid="failover-queue-manager" />,
}));

vi.mock("@/components/proxy/AutoFailoverConfigPanel", () => ({
  AutoFailoverConfigPanel: () => (
    <div data-testid="auto-failover-config-panel" />
  ),
}));

vi.mock("@/components/proxy/ProxyPanel", () => ({
  ProxyPanel: () => <div data-testid="proxy-panel" />,
}));

vi.mock("@/components/settings/RectifierConfigPanel", () => ({
  RectifierConfigPanel: () => <div data-testid="rectifier-config-panel" />,
}));

vi.mock("@/components/settings/GlobalProxySettings", () => ({
  GlobalProxySettings: () => <div data-testid="global-proxy-settings" />,
}));

vi.mock("@/components/settings/AuthCenterPanel", () => ({
  AuthCenterPanel: ({ onBusyChange }: any) => (
    <div data-testid="auth-center-panel">
      <button onClick={() => onBusyChange?.(true)}>auth-busy</button>
      <button onClick={() => onBusyChange?.(false)}>auth-idle</button>
    </div>
  ),
}));

const profile: RemoteHostProfile = {
  id: "remote-1",
  name: "Swarm01",
  host: "192.168.123.203",
  port: 22,
  username: "root",
  authMethod: { type: "password" },
  helperPath: "~/.local/bin/cc-switch-remote-helper",
  createdAt: 1,
  updatedAt: 1,
};

const settings: Settings = {
  showInTray: true,
  minimizeToTrayOnClose: true,
  useAppWindowControls: false,
  enableClaudePluginIntegration: false,
  skipClaudeOnboarding: false,
  launchOnStartup: false,
  silentStartup: false,
  enableLocalProxy: false,
  visibleApps: {
    claude: true,
    "claude-desktop": true,
    codex: true,
    gemini: true,
    grokbuild: true,
    opencode: true,
    openclaw: true,
    hermes: true,
  },
  skillSyncMethod: "auto",
  skillStorageLocation: "cc_switch",
};

describe("RemoteSettingsPage", () => {
  beforeEach(() => {
    checkHealthMock.mockReset();
    getSettingsMock.mockReset();
    saveSettingsMock.mockReset();
    getInstalledSkillsMock.mockReset();
    migrateSkillStorageMock.mockReset();
    startProxyServerMock.mockReset();
    stopWithRestoreMock.mockReset();
    hasCodexUnifyHistoryBackupMock.mockReset();
    restoreCodexUnifiedHistoryMock.mockReset();
    proxyRunning = false;

    checkHealthMock.mockResolvedValue({
      reachable: true,
      helperInstalled: true,
      helperVersion: "3.16.2",
      platform: "linux",
      capabilities: [
        "settings",
        "plugin",
        "skills",
        "tools",
        "routing-config",
        "routing-runtime",
      ],
    });
    getSettingsMock.mockResolvedValue(settings);
    saveSettingsMock.mockResolvedValue(true);
    getInstalledSkillsMock.mockResolvedValue([]);
  });

  it("aligns remote settings tab order with local settings modules", async () => {
    render(
      <RemoteSettingsPage
        open
        onOpenChange={vi.fn()}
        target={{ type: "remote", profile, secret: { password: "secret" } }}
      />,
    );

    await waitFor(() => {
      expect(getSettingsMock).toHaveBeenCalled();
    });

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "远程",
      "通用",
      "代理",
      "认证",
      "高级",
      "usage.title",
    ]);
  });

  it("reports managed authentication activity as a blocked interaction", async () => {
    const user = userEvent.setup();
    const onInteractionBlockedChange = vi.fn();
    checkHealthMock.mockResolvedValueOnce({
      reachable: true,
      helperInstalled: true,
      helperVersion: "3.19.2",
      platform: "linux",
      capabilities: ["settings", "auth"],
    });

    render(
      <RemoteSettingsPage
        open
        onOpenChange={vi.fn()}
        defaultTab="auth"
        onInteractionBlockedChange={onInteractionBlockedChange}
        target={{ type: "remote", profile, secret: { password: "secret" } }}
      />,
    );

    await screen.findByTestId("auth-center-panel");
    await user.click(screen.getByRole("button", { name: "auth-busy" }));
    await waitFor(() =>
      expect(onInteractionBlockedChange).toHaveBeenLastCalledWith(true),
    );

    await user.click(screen.getByRole("button", { name: "auth-idle" }));
    await waitFor(() =>
      expect(onInteractionBlockedChange).toHaveBeenLastCalledWith(false),
    );
  });

  it("maps the legacy remote data tab to the advanced tab", async () => {
    render(
      <RemoteSettingsPage
        open
        onOpenChange={vi.fn()}
        defaultTab="data"
        target={{ type: "remote", profile, secret: { password: "secret" } }}
      />,
    );

    await waitFor(() => {
      expect(getSettingsMock).toHaveBeenCalled();
    });

    expect(screen.getByRole("tab", { name: "高级" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("keeps remote homepage routing display settings in the routing tab", async () => {
    const user = userEvent.setup();
    const saveDeferred = createDeferred<boolean>();
    saveSettingsMock.mockReturnValue(saveDeferred.promise);

    render(
      <RemoteSettingsPage
        open
        onOpenChange={vi.fn()}
        defaultTab="general"
        target={{ type: "remote", profile, secret: { password: "secret" } }}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /gemini/i }),
      ).toBeInTheDocument();
    });

    expect(screen.queryByText("远程通用设置")).not.toBeInTheDocument();
    expect(
      screen.queryByText("这些设置保存到当前远程主机自己的配置目录。"),
    ).not.toBeInTheDocument();

    expect(
      screen.queryByText("在主页面显示远程路由开关"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("在主页面显示远程故障转移开关"),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "代理" }));
    expect(
      screen.queryByRole("button", { name: /远程路由/ }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: /settings\.advanced\.proxy\.title/ }),
    );

    await waitFor(() => {
      expect(screen.getByText("在主页面显示远程路由开关")).toBeInTheDocument();
    });

    expect(
      screen.queryByRole("button", { name: /远程自动故障转移/ }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", {
        name: /settings\.advanced\.failover\.title/,
      }),
    );

    expect(screen.getByRole("tab", { name: "Grok Build" })).toBeInTheDocument();
    expect(
      screen.getByText("在主页面显示远程故障转移开关"),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("switch", {
        name: "在主页面显示远程路由开关",
      }),
    );

    expect(
      screen.getByRole("switch", {
        name: "在主页面显示远程路由开关",
      }),
    ).toBeChecked();

    await waitFor(() => {
      expect(saveSettingsMock).toHaveBeenCalledWith(
        profile,
        expect.objectContaining({
          enableRemoteRoutingToggle: true,
        }),
        { password: "secret" },
      );
    });

    await act(async () => {
      saveDeferred.resolve(true);
      await saveDeferred.promise;
    });
  });

  it("uses the window-aware heartbeat for the running routing badge", async () => {
    const user = userEvent.setup();
    proxyRunning = true;

    render(
      <RemoteSettingsPage
        open
        onOpenChange={vi.fn()}
        defaultTab="proxy"
        target={{ type: "remote", profile, secret: { password: "secret" } }}
      />,
    );

    const proxySection = await screen.findByRole("button", {
      name: /settings\.advanced\.proxy\.title/,
    });
    await user.click(proxySection);

    const runningMarker = proxySection.querySelector("svg.h-3.w-3");
    expect(runningMarker).toHaveClass("status-heartbeat");
    expect(runningMarker).not.toHaveClass("animate-pulse");
  });

  it("loads remote general settings and saves per-host app visibility", async () => {
    const user = userEvent.setup();

    render(
      <RemoteSettingsPage
        open
        onOpenChange={vi.fn()}
        target={{ type: "remote", profile, secret: { password: "secret" } }}
      />,
    );

    expect(screen.getByRole("tab", { name: "远程" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await user.click(screen.getByRole("tab", { name: "通用" }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /gemini/i }),
      ).toBeInTheDocument();
    });

    expect(screen.queryByText("远程通用设置")).not.toBeInTheDocument();
    expect(
      screen.queryByText("这些设置保存到当前远程主机自己的配置目录。"),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /gemini/i }));

    await waitFor(() => {
      expect(saveSettingsMock).toHaveBeenCalledWith(
        profile,
        expect.objectContaining({
          visibleApps: expect.objectContaining({ gemini: false }),
        }),
        { password: "secret" },
      );
    });
  });

  it("does not run local Codex history backup actions from remote general settings", async () => {
    const user = userEvent.setup();
    getSettingsMock.mockResolvedValueOnce({
      ...settings,
      unifyCodexSessionHistory: true,
      unifyCodexMigrateExisting: true,
    });

    render(
      <RemoteSettingsPage
        open
        onOpenChange={vi.fn()}
        defaultTab="general"
        target={{ type: "remote", profile, secret: { password: "secret" } }}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("switch", {
          name: /unifyCodexSessionHistory|统一/,
        }),
      ).toBeChecked();
    });

    await user.click(
      screen.getByRole("switch", {
        name: /unifyCodexSessionHistory|统一/,
      }),
    );

    expect(hasCodexUnifyHistoryBackupMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/恢复/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /confirm|确认/ }));

    await waitFor(() => {
      expect(saveSettingsMock).toHaveBeenCalledWith(
        profile,
        expect.objectContaining({
          unifyCodexSessionHistory: false,
          unifyCodexMigrateExisting: false,
        }),
        { password: "secret" },
      );
    });
    expect(restoreCodexUnifiedHistoryMock).not.toHaveBeenCalled();
  });

  it("gates remote import/export when the helper lacks the capability", async () => {
    checkHealthMock.mockResolvedValueOnce({
      reachable: true,
      helperInstalled: true,
      helperVersion: "3.16.2",
      platform: "linux",
      capabilities: ["settings", "plugin", "skills", "tools"],
    });

    render(
      <RemoteSettingsPage
        open
        onOpenChange={vi.fn()}
        defaultTab="advanced"
        target={{ type: "remote", profile, secret: { password: "secret" } }}
      />,
    );

    await waitFor(() => {
      expect(getSettingsMock).toHaveBeenCalled();
    });

    expect(
      screen.getByText(
        "当前远程 Helper 不支持导入导出。请更新到包含 import-export capability 的新版 Helper。",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("settings.importExport")).not.toBeInTheDocument();
  });

  it("keeps the selected remote settings tab after async health refresh", async () => {
    const user = userEvent.setup();
    const health =
      createDeferred<Awaited<ReturnType<typeof checkHealthMock>>>();
    checkHealthMock.mockReturnValueOnce(health.promise);

    render(
      <RemoteSettingsPage
        open
        onOpenChange={vi.fn()}
        defaultTab="general"
        target={{ type: "remote", profile, secret: { password: "secret" } }}
      />,
    );

    await user.click(screen.getByRole("tab", { name: "远程" }));
    expect(screen.getByRole("tab", { name: "远程" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    health.resolve({
      reachable: true,
      helperInstalled: true,
      helperVersion: "3.16.2",
      platform: "linux",
      capabilities: ["settings", "plugin", "skills", "tools"],
    });

    await waitFor(() => {
      expect(getSettingsMock).toHaveBeenCalled();
    });

    expect(screen.getByRole("tab", { name: "远程" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "通用" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });
});
