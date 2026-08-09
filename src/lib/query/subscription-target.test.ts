import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { subscriptionApi } from "@/lib/api/subscription";
import type { ManagementTarget, RemoteHostProfile } from "@/lib/api";
import {
  subscriptionKeys,
  useCodexOauthQuotaByAccountId,
} from "./subscription";

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

describe("Codex OAuth quota target isolation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps remote account quota requests and cache keys remote-qualified", async () => {
    const getQuotaSpy = vi
      .spyOn(subscriptionApi, "getCodexOauthQuota")
      .mockResolvedValue({
        tool: "codex_oauth",
        credentialStatus: "valid",
        credentialMessage: null,
        success: true,
        tiers: [],
        extraUsage: null,
        error: null,
        queriedAt: 1,
      });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(
      () =>
        useCodexOauthQuotaByAccountId("remote-account", {
          target: remoteTarget,
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(getQuotaSpy).toHaveBeenCalledWith("remote-account", remoteTarget);
    expect(getQuotaSpy).not.toHaveBeenCalledWith(
      "local-account",
      expect.anything(),
    );
    expect(
      queryClient.getQueryData([
        "codex_oauth",
        "quota",
        "remote:server-a",
        "remote-account",
      ]),
    ).toEqual(expect.objectContaining({ tool: "codex_oauth" }));
  });

  it("builds quota keys with the selected management target", () => {
    expect(
      subscriptionKeys.codexOauthQuota("remote-account", remoteTarget),
    ).toEqual(["codex_oauth", "quota", "remote:server-a", "remote-account"]);
    expect(subscriptionKeys.codexOauthQuota("local-account")).toEqual([
      "codex_oauth",
      "quota",
      "local",
      "local-account",
    ]);
  });

  it("reloads account quota when the same remote profile gets new connection credentials", async () => {
    const nextTarget: ManagementTarget = {
      ...remoteTarget,
      profile: {
        ...remoteTarget.profile,
        host: "192.0.2.11",
        updatedAt: 2,
      },
      secret: { password: "new-secret" },
    };
    const getQuotaSpy = vi
      .spyOn(subscriptionApi, "getCodexOauthQuota")
      .mockImplementation((_, target) =>
        Promise.resolve({
          tool: "codex_oauth",
          credentialStatus: "valid",
          credentialMessage: null,
          success: true,
          tiers: [],
          extraUsage: null,
          error: null,
          queriedAt: target === remoteTarget ? 1 : 2,
        }),
      );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(QueryClientProvider, { client: queryClient }, children);

    const { result, rerender } = renderHook(
      ({ target }: { target: ManagementTarget }) =>
        useCodexOauthQuotaByAccountId("remote-account", { target }),
      {
        initialProps: { target: remoteTarget },
        wrapper,
      },
    );

    await waitFor(() => expect(result.current.data?.queriedAt).toBe(1));

    rerender({ target: nextTarget });

    await waitFor(() => expect(getQuotaSpy).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.data?.queriedAt).toBe(2));
    expect(getQuotaSpy.mock.calls).toEqual([
      ["remote-account", remoteTarget],
      ["remote-account", nextTarget],
    ]);
  });
});
