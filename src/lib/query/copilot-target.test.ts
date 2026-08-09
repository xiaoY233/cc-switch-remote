import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { copilotGetUsageForTarget } from "@/lib/api/copilot";
import type { ManagementTarget, RemoteHostProfile } from "@/lib/api";
import { useCopilotQuota } from "./copilot";

vi.mock("@/lib/api/copilot", () => ({
  copilotGetUsageForTarget: vi.fn(),
}));

const remoteProfile: RemoteHostProfile = {
  id: "server-a",
  name: "Server A",
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

const nextRemoteTarget: ManagementTarget = {
  ...remoteTarget,
  profile: {
    ...remoteProfile,
    host: "192.0.2.11",
    updatedAt: 2,
  },
  secret: { password: "new-secret" },
};

const copilotUsage = {
  copilot_plan: "individual",
  quota_reset_date: "2026-09-01T00:00:00Z",
  quota_snapshots: {
    chat: {
      entitlement: 0,
      remaining: 0,
      percent_remaining: 0,
      unlimited: true,
    },
    completions: {
      entitlement: 0,
      remaining: 0,
      percent_remaining: 0,
      unlimited: true,
    },
    premium_interactions: {
      entitlement: 300,
      remaining: 200,
      percent_remaining: 66,
      unlimited: false,
    },
  },
};

describe("Copilot quota target isolation", () => {
  beforeEach(() => {
    vi.mocked(copilotGetUsageForTarget).mockReset();
  });

  it("reloads the remote cache and does not display the previous connection after the replacement connection fails", async () => {
    vi.mocked(copilotGetUsageForTarget)
      .mockResolvedValueOnce(copilotUsage)
      .mockRejectedValue(new Error("HTTP 503 unavailable"));
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retryDelay: 0 } },
    });
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(QueryClientProvider, { client: queryClient }, children);

    const { result, rerender } = renderHook(
      ({ target }: { target: ManagementTarget }) =>
        useCopilotQuota("copilot-account", { target }),
      { initialProps: { target: remoteTarget }, wrapper },
    );

    await waitFor(() => expect(result.current.data?.success).toBe(true));
    expect(
      queryClient.getQueryData([
        "copilot",
        "quota",
        "remote:server-a",
        "copilot-account",
      ]),
    ).toEqual(expect.objectContaining({ plan: "individual" }));

    rerender({ target: nextRemoteTarget });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(copilotGetUsageForTarget).toHaveBeenCalledWith(
      "copilot-account",
      nextRemoteTarget,
    );
  });
});
