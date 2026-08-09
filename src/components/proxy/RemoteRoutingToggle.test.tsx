import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RemoteRoutingToggle } from "./RemoteRoutingToggle";
import type { ManagementTarget } from "@/lib/api";

vi.mock("@/hooks/useProxyStatus", () => ({
  useProxyStatus: () => ({
    status: { address: "127.0.0.1", port: 15721 },
    isRunning: true,
    startProxyServer: vi.fn(),
    stopWithRestore: vi.fn(),
    isStarting: false,
    isStopping: false,
    isLoading: false,
  }),
}));

const remoteTarget: Extract<ManagementTarget, { type: "remote" }> = {
  type: "remote",
  profile: {
    id: "remote-routing",
    name: "Remote Routing",
    host: "192.168.1.30",
    port: 22,
    username: "root",
    authMethod: { type: "sshAgent" },
    helperPath: "~/.local/bin/cc-switch-remote-helper",
    createdAt: 1,
    updatedAt: 1,
  },
};

describe("RemoteRoutingToggle", () => {
  it("uses the window-aware heartbeat for its running marker", () => {
    const { container } = render(<RemoteRoutingToggle target={remoteTarget} />);

    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    expect(container.querySelector("svg")).toHaveClass("status-heartbeat");
    expect(container.querySelector("svg")).not.toHaveClass("animate-pulse");
  });
});
