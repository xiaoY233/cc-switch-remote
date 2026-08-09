import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { describe, expect, it } from "vitest";

import { useTargetAsyncGeneration } from "@/hooks/useTargetAsyncGeneration";
import type { ManagementTarget } from "@/lib/api";

type RemoteTarget = Extract<ManagementTarget, { type: "remote" }>;

const target = (host: string, password: string): RemoteTarget => ({
  type: "remote",
  profile: {
    id: "same-profile",
    name: "Server",
    host,
    port: 22,
    username: "alice",
    authMethod: { type: "password" },
    helperPath: "~/.local/bin/cc-switch-remote-helper",
    createdAt: 1,
    updatedAt: 1,
  },
  secret: { password },
});

const wrapper = ({ children }: PropsWithChildren) => (
  <QueryClientProvider client={new QueryClient()}>
    {children}
  </QueryClientProvider>
);

describe("useTargetAsyncGeneration", () => {
  it("invalidates captured work on same-id connection changes", () => {
    const first = target("host-a", "secret-a");
    const { result, rerender } = renderHook(
      ({ currentTarget }) => useTargetAsyncGeneration(currentTarget),
      { initialProps: { currentTarget: first }, wrapper },
    );
    const oldWork = result.current.capture();
    expect(result.current.isCurrent(oldWork)).toBe(true);

    rerender({ currentTarget: target("host-b", "secret-b") });

    expect(result.current.isCurrent(oldWork)).toBe(false);
    expect(result.current.isCurrent(result.current.capture())).toBe(true);
  });

  it("keeps equivalent connection copies current and invalidates unmounted work", () => {
    const first = target("host-a", "secret-a");
    const { result, rerender, unmount } = renderHook(
      ({ currentTarget }) => useTargetAsyncGeneration(currentTarget),
      { initialProps: { currentTarget: first }, wrapper },
    );
    const work = result.current.capture();
    rerender({
      currentTarget: {
        ...first,
        profile: { ...first.profile, name: "Renamed", updatedAt: 2 },
      },
    });
    expect(result.current.isCurrent(work)).toBe(true);

    unmount();
    expect(result.current.isCurrent(work)).toBe(false);
  });
});
