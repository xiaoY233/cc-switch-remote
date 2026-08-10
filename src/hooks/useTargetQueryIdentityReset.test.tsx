import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { describe, expect, it } from "vitest";

import { useTargetQueryIdentityReset } from "@/hooks/useTargetQueryIdentityReset";
import type { ManagementTarget } from "@/lib/api";

type RemoteTarget = Extract<ManagementTarget, { type: "remote" }>;

const remoteTarget = (overrides: Partial<RemoteTarget> = {}): RemoteTarget => ({
  type: "remote",
  profile: {
    id: "server-1",
    name: "Server 1",
    host: "host-a.example.com",
    port: 22,
    username: "alice",
    authMethod: { type: "password" },
    helperPath: "~/.local/bin/cc-switch-remote-helper",
    createdAt: 1,
    updatedAt: 1,
  },
  secret: { password: "secret-a" },
  ...overrides,
});

const targetKey = "remote:server-1";

function wrapper(queryClient: QueryClient) {
  return ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("all-domain target identity reset", () => {
  it("clears every target-scoped domain when same-id connection identity changes", async () => {
    const queryClient = new QueryClient();
    const targetQueries = [
      ["providers", "claude", targetKey],
      ["opencodeLiveProviderIds", targetKey],
      ["openclaw", "liveProviderIds", targetKey],
      ["hermes", "modelConfig", targetKey],
      ["sessions", targetKey],
      ["usage", targetKey, "claude"],
      ["proxyStatus", targetKey],
      ["failoverQueue", targetKey, "claude"],
      ["profiles", "claude", targetKey],
      ["db-backups", targetKey],
      ["auth", "accounts", targetKey],
      ["remote-settings", targetKey],
      ["remote-health", targetKey],
      ["tools", "environment", targetKey],
      ["mcp", "all", targetKey],
      ["skills", "installed", targetKey],
    ];
    for (const key of targetQueries) queryClient.setQueryData(key, "old-host");
    queryClient.setQueryData(["providers", "claude", "local"], "local-data");

    const first = remoteTarget();
    const second: ManagementTarget = {
      ...first,
      type: "remote",
      profile: { ...first.profile, host: "host-b.example.com" },
      secret: { password: "secret-b" },
    };
    const { rerender } = renderHook(
      ({ target }) => useTargetQueryIdentityReset("all", target, targetKey),
      { initialProps: { target: first }, wrapper: wrapper(queryClient) },
    );

    rerender({ target: second });

    await waitFor(() => {
      for (const key of targetQueries) {
        expect(queryClient.getQueryData(key)).toBeUndefined();
      }
    });
    expect(queryClient.getQueryData(["providers", "claude", "local"])).toBe(
      "local-data",
    );
  });

  it("does not reset equivalent remote copies or local upstream state", async () => {
    const queryClient = new QueryClient();
    const key = ["providers", "claude", targetKey];
    const first = remoteTarget();
    const { rerender } = renderHook(
      ({ target }) => useTargetQueryIdentityReset("all", target, targetKey),
      { initialProps: { target: first }, wrapper: wrapper(queryClient) },
    );
    queryClient.setQueryData(key, "same-connection");

    rerender({
      target: {
        ...first,
        type: "remote",
        profile: { ...first.profile, name: "Renamed", updatedAt: 99 },
        secret: { ...first.secret },
      },
    });

    await act(async () => {});
    expect(queryClient.getQueryData(key)).toBe("same-connection");
  });

  it("prevents a cancelled old-connection response from repopulating cache", async () => {
    const queryClient = new QueryClient();
    const key = ["providers", "claude", targetKey];
    let resolveOld!: (value: string) => void;
    const oldRequest = new Promise<string>((resolve) => {
      resolveOld = resolve;
    });
    const pendingFetch = queryClient.fetchQuery({
      queryKey: key,
      queryFn: () => oldRequest,
    });
    const settledFetch = pendingFetch.catch(() => undefined);

    const first = remoteTarget();
    const { rerender } = renderHook(
      ({ target }) => useTargetQueryIdentityReset("all", target, targetKey),
      { initialProps: { target: first }, wrapper: wrapper(queryClient) },
    );
    rerender({
      target: {
        ...first,
        type: "remote",
        profile: { ...first.profile, username: "bob" },
      },
    });
    await act(async () => {
      resolveOld("late-old-host");
      await oldRequest;
      await settledFetch;
    });

    await waitFor(() => expect(queryClient.getQueryData(key)).toBeUndefined());
  });
});
