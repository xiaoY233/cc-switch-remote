import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { RemoteHealthPanel } from "@/components/remote/RemoteHealthPanel";
import type { RemoteHostProfile } from "@/lib/api";
import { EXPECTED_REMOTE_CAPABILITIES } from "@/lib/remoteHealth";

const checkHealthMock = vi.fn();
const installHelperMock = vi.fn();
const allExpectedCapabilities = EXPECTED_REMOTE_CAPABILITIES.map(
  (capability) => capability.id,
);

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<any>("@/lib/api");
  return {
    ...actual,
    remoteApi: {
      ...actual.remoteApi,
      checkHealth: (...args: unknown[]) => checkHealthMock(...args),
      installHelper: (...args: unknown[]) => installHelperMock(...args),
    },
  };
});

const profile: RemoteHostProfile = {
  id: "remote-1",
  name: "Remote 1",
  host: "192.168.123.203",
  port: 22,
  username: "root",
  authMethod: { type: "password" },
  helperPath: "/root/cc-switch-current/src-tauri/target/debug/cc-switch-cli",
  createdAt: 1,
  updatedAt: 1,
};

describe("RemoteHealthPanel", () => {
  beforeEach(() => {
    checkHealthMock.mockReset();
    installHelperMock.mockReset();
  });

  it("warns when the remote helper is missing a parity capability", async () => {
    checkHealthMock.mockResolvedValueOnce({
      reachable: true,
      helperInstalled: true,
      helperVersion: "3.16.0",
      platform: "linux",
      capabilities: ["providers", "mcp", "prompts", "skills", "import-export"],
    });

    render(
      <RemoteHealthPanel
        profile={profile}
        secret={{ password: "session-secret" }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "检查" }));

    await waitFor(() => {
      expect(screen.getByText("缺少功能支持")).toBeInTheDocument();
    });
    expect(screen.getAllByText("OpenClaw").length).toBeGreaterThan(0);
    expect(screen.getByText("供应商")).toBeInTheDocument();
    expect(checkHealthMock).toHaveBeenCalledWith(profile, {
      password: "session-secret",
    });
  });

  it("shows all helper capabilities without a missing-capability warning", async () => {
    checkHealthMock.mockResolvedValueOnce({
      reachable: true,
      helperInstalled: true,
      helperVersion: "3.16.0",
      platform: "linux",
      capabilities: allExpectedCapabilities,
    });

    render(<RemoteHealthPanel profile={profile} />);

    fireEvent.click(screen.getByRole("button", { name: "检查" }));

    await waitFor(() => {
      expect(screen.getByText("OpenClaw")).toBeInTheDocument();
    });
    expect(screen.queryByText("缺少功能支持")).not.toBeInTheDocument();
  });

  it("shows an update action when the remote helper is behind the latest release", async () => {
    checkHealthMock.mockResolvedValueOnce({
      reachable: true,
      helperInstalled: true,
      helperVersion: "3.16.2",
      helperLatestVersion: "3.16.2",
      helperLatestBuild: "abcdef12",
      helperLatestAsset: "cc-switch-remote-helper-abcdef12-Linux-x86_64",
      helperUpdateAvailable: true,
      platform: "linux",
      capabilities: ["providers"],
    });

    render(<RemoteHealthPanel profile={profile} />);

    fireEvent.click(screen.getByRole("button", { name: "检查" }));

    await waitFor(() => {
      expect(screen.getByText("发现新版 Helper")).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: "更新 Helper" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/最新构建: abcdef12/)).toBeInTheDocument();
    expect(
      screen.queryByText(/cc-switch-remote-helper-abcdef12-Linux-x86_64/),
    ).not.toBeInTheDocument();
  });

  it("shows helper upgrade requirement when session capability is missing", async () => {
    checkHealthMock.mockResolvedValueOnce({
      reachable: true,
      helperInstalled: true,
      helperVersion: "3.16.3",
      helperBuild: "abc123",
      helperArch: "x86_64",
      helperUpdateAvailable: false,
      helperUpdateError:
        "远程 Helper 版本过旧，不支持持久会话；请更新 Helper。",
      platform: "linux",
      capabilities: ["providers", "settings"],
    });

    render(<RemoteHealthPanel profile={profile} />);

    fireEvent.click(screen.getByRole("button", { name: "检查" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "远程 Helper 版本过旧，不支持持久会话；请更新 Helper。",
        ),
      ).toBeInTheDocument();
    });
  });

  it("keeps the configured helper path visible after a health check", async () => {
    checkHealthMock.mockResolvedValueOnce({
      reachable: true,
      helperInstalled: true,
      helperVersion: "3.16.0",
      platform: "linux",
      capabilities: ["providers"],
    });

    render(<RemoteHealthPanel profile={profile} />);

    expect(screen.getByText(profile.helperPath)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "检查" }));

    await waitFor(() => {
      expect(screen.getByText("3.16.0")).toBeInTheDocument();
    });
    expect(screen.getByText(profile.helperPath)).toBeInTheDocument();
  });
});
