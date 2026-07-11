import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RemoteAppRoutingToggle } from "@/components/proxy/RemoteAppRoutingToggle";
import type { ManagementTarget } from "@/lib/api";

const mocks = vi.hoisted(() => ({
  startProxyServer: vi.fn(),
  updateAppConfig: vi.fn(),
  proxyRunning: false,
  preflight: {
    appType: "codex",
    canEnable: true,
    reason: null as string | null,
  },
  appConfig: {
    appType: "codex",
    enabled: false,
    autoFailoverEnabled: false,
    maxRetries: 3,
    streamingFirstByteTimeout: 60,
    streamingIdleTimeout: 120,
    nonStreamingTimeout: 600,
    circuitFailureThreshold: 5,
    circuitSuccessThreshold: 2,
    circuitTimeoutSeconds: 60,
    circuitErrorRateThreshold: 0.5,
    circuitMinRequests: 10,
  },
}));

vi.mock("@/hooks/useProxyStatus", () => ({
  useProxyStatus: () => ({
    isRunning: mocks.proxyRunning,
    startProxyServer: mocks.startProxyServer,
    isStarting: false,
  }),
}));

vi.mock("@/lib/query/proxy", () => ({
  useAppProxyConfig: () => ({
    data: mocks.appConfig,
    isLoading: false,
  }),
  useRoutingAppPreflight: () => ({
    data: mocks.preflight,
    isLoading: false,
  }),
  useUpdateAppProxyConfig: () => ({
    mutateAsync: mocks.updateAppConfig,
    isPending: false,
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? _key,
  }),
}));

const target: Extract<ManagementTarget, { type: "remote" }> = {
  type: "remote",
  profile: {
    id: "remote-1",
    name: "Remote 1",
    host: "192.168.1.20",
    port: 22,
    username: "root",
    authMethod: { type: "sshAgent" },
    helperPath: "~/.local/bin/cc-switch-remote-helper",
    createdAt: 1,
    updatedAt: 1,
  },
};

describe("RemoteAppRoutingToggle", () => {
  beforeEach(() => {
    mocks.startProxyServer.mockReset();
    mocks.updateAppConfig.mockReset();
    mocks.startProxyServer.mockResolvedValue({
      address: "127.0.0.1",
      port: 15721,
    });
    mocks.updateAppConfig.mockResolvedValue(undefined);
    mocks.proxyRunning = false;
    mocks.preflight = {
      appType: "codex",
      canEnable: true,
      reason: null,
    };
    mocks.appConfig = { ...mocks.appConfig, enabled: false };
  });

  it("starts the remote routing runtime before enabling an active app route", async () => {
    const user = userEvent.setup();

    render(<RemoteAppRoutingToggle activeApp="codex" target={target} />);

    const toggle = screen.getByRole("switch");
    expect(toggle).not.toBeDisabled();

    await user.click(toggle);

    await waitFor(() => {
      expect(mocks.startProxyServer).toHaveBeenCalledTimes(1);
      expect(mocks.updateAppConfig).toHaveBeenCalledWith({
        ...mocks.appConfig,
        enabled: true,
      });
    });
    expect(
      mocks.startProxyServer.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.updateAppConfig.mock.invocationCallOrder[0]);
  });

  it("does not stop the remote routing runtime when disabling an app route", async () => {
    const user = userEvent.setup();
    mocks.proxyRunning = true;
    mocks.appConfig = { ...mocks.appConfig, enabled: true };

    render(<RemoteAppRoutingToggle activeApp="codex" target={target} />);

    await user.click(screen.getByRole("switch"));

    await waitFor(() =>
      expect(mocks.updateAppConfig).toHaveBeenCalledWith({
        ...mocks.appConfig,
        enabled: false,
      }),
    );
    expect(mocks.startProxyServer).not.toHaveBeenCalled();
  });

  it("does not start runtime or enable routing when preflight blocks the app", async () => {
    const user = userEvent.setup();
    mocks.preflight = {
      appType: "codex",
      canEnable: false,
      reason: "请先为 Codex 选择当前供应商",
    };

    render(<RemoteAppRoutingToggle activeApp="codex" target={target} />);

    const toggle = screen.getByRole("switch");
    expect(toggle).toBeDisabled();

    await user.click(toggle);

    expect(mocks.startProxyServer).not.toHaveBeenCalled();
    expect(mocks.updateAppConfig).not.toHaveBeenCalled();
  });
});
