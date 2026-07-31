import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RemoteAppRoutingToggle } from "./RemoteAppRoutingToggle";
import type { ManagementTarget } from "@/lib/api";

const useProxyStatusMock = vi.fn();
const useAppProxyConfigMock = vi.fn();
const useRoutingAppPreflightMock = vi.fn();
const useUpdateAppProxyConfigMock = vi.fn();

vi.mock("@/hooks/useProxyStatus", () => ({
  useProxyStatus: (...args: unknown[]) => useProxyStatusMock(...args),
}));

vi.mock("@/lib/query/proxy", () => ({
  useAppProxyConfig: (...args: unknown[]) => useAppProxyConfigMock(...args),
  useRoutingAppPreflight: (...args: unknown[]) =>
    useRoutingAppPreflightMock(...args),
  useUpdateAppProxyConfig: (...args: unknown[]) =>
    useUpdateAppProxyConfigMock(...args),
}));

const remoteTarget: Extract<ManagementTarget, { type: "remote" }> = {
  type: "remote",
  profile: {
    id: "remote-routing",
    name: "Remote Routing",
    host: "192.168.1.30",
    port: 22,
    username: "root",
    authMethod: { type: "password" },
    helperPath: "~/.local/bin/cc-switch-remote-helper",
    createdAt: 1,
    updatedAt: 1,
  },
  secret: { password: "secret" },
};

describe("RemoteAppRoutingToggle", () => {
  beforeEach(() => {
    useRoutingAppPreflightMock.mockReturnValue({
      data: { appType: "claude", canEnable: true, reason: null },
      isLoading: false,
    });
  });

  it("does not show checked when app routing config is enabled but runtime is stopped", () => {
    useProxyStatusMock.mockReturnValue({
      isRunning: false,
      startProxyServer: vi.fn(),
      isStarting: false,
    });
    useAppProxyConfigMock.mockReturnValue({
      data: { appType: "claude", enabled: true },
      isLoading: false,
    });
    useUpdateAppProxyConfigMock.mockReturnValue({
      isPending: false,
      mutateAsync: vi.fn(),
    });

    render(<RemoteAppRoutingToggle activeApp="claude" target={remoteTarget} />);

    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  });

  it("shows checked when app routing config is enabled and runtime is running", () => {
    useProxyStatusMock.mockReturnValue({
      isRunning: true,
      startProxyServer: vi.fn(),
      isStarting: false,
    });
    useAppProxyConfigMock.mockReturnValue({
      data: { appType: "claude", enabled: true },
      isLoading: false,
    });
    useUpdateAppProxyConfigMock.mockReturnValue({
      isPending: false,
      mutateAsync: vi.fn(),
    });

    render(<RemoteAppRoutingToggle activeApp="claude" target={remoteTarget} />);

    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });

  it("disables enabling when remote routing preflight fails", () => {
    useProxyStatusMock.mockReturnValue({
      isRunning: true,
      startProxyServer: vi.fn(),
      isStarting: false,
    });
    useAppProxyConfigMock.mockReturnValue({
      data: { appType: "gemini", enabled: false },
      isLoading: false,
    });
    useRoutingAppPreflightMock.mockReturnValue({
      data: {
        appType: "gemini",
        canEnable: false,
        reason: "Gemini Live 配置不可用：Gemini .env 文件不存在",
      },
      isLoading: false,
    });
    useUpdateAppProxyConfigMock.mockReturnValue({
      isPending: false,
      mutateAsync: vi.fn(),
    });

    render(<RemoteAppRoutingToggle activeApp="gemini" target={remoteTarget} />);

    expect(screen.getByRole("switch")).toBeDisabled();
  });

  it("loads Grok Build routing state from the selected remote target", () => {
    useProxyStatusMock.mockReturnValue({
      isRunning: true,
      startProxyServer: vi.fn(),
      isStarting: false,
    });
    useAppProxyConfigMock.mockReturnValue({
      data: { appType: "grokbuild", enabled: true },
      isLoading: false,
    });
    useRoutingAppPreflightMock.mockReturnValue({
      data: { appType: "grokbuild", canEnable: true, reason: null },
      isLoading: false,
    });
    useUpdateAppProxyConfigMock.mockReturnValue({
      isPending: false,
      mutateAsync: vi.fn(),
    });

    render(
      <RemoteAppRoutingToggle activeApp="grokbuild" target={remoteTarget} />,
    );

    expect(useAppProxyConfigMock).toHaveBeenCalledWith(
      "grokbuild",
      remoteTarget,
    );
    expect(useRoutingAppPreflightMock).toHaveBeenCalledWith(
      "grokbuild",
      remoteTarget,
    );
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("remote-app-routing-toggle")).toHaveAttribute(
      "title",
      expect.stringContaining("Grok Build"),
    );
  });
});
