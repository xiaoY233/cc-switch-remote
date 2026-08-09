import type { PropsWithChildren } from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBulkToggleSkillApp } from "@/hooks/useSkills";
import type { ManagementTarget } from "@/lib/api/remote";

const toggleAppMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/skills", () => ({
  skillsApi: { toggleApp: toggleAppMock },
}));

const remoteTarget = {
  type: "remote" as const,
  profile: { id: "server-a" },
  secret: "secret-a",
} as unknown as ManagementTarget;

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe("useBulkToggleSkillApp remote routing", () => {
  beforeEach(() => {
    toggleAppMock.mockReset();
  });

  it("keeps every bulk Skill toggle on the selected remote target and invalidates only that target", async () => {
    toggleAppMock.mockResolvedValue(undefined);
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useBulkToggleSkillApp(remoteTarget), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({
        ids: ["alpha", "beta"],
        app: "claude",
        enabled: true,
      });
    });

    expect(toggleAppMock.mock.calls).toEqual([
      ["alpha", "claude", true, remoteTarget],
      ["beta", "claude", true, remoteTarget],
    ]);
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["skills", "installed", "remote:server-a"],
    });
    expect(invalidateSpy).not.toHaveBeenCalledWith({
      queryKey: ["skills", "installed", "local"],
    });
  });

  it("continues after a remote Skill toggle fails and reports both outcomes", async () => {
    toggleAppMock
      .mockRejectedValueOnce(new Error("alpha failed"))
      .mockResolvedValueOnce(undefined);
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const { result } = renderHook(() => useBulkToggleSkillApp(remoteTarget), {
      wrapper: createWrapper(queryClient),
    });

    let outcome: Awaited<ReturnType<typeof result.current.mutateAsync>>;
    await act(async () => {
      outcome = await result.current.mutateAsync({
        ids: ["alpha", "beta"],
        app: "codex",
        enabled: false,
      });
    });

    expect(toggleAppMock.mock.calls).toEqual([
      ["alpha", "codex", false, remoteTarget],
      ["beta", "codex", false, remoteTarget],
    ]);
    expect(outcome!.succeeded).toEqual(["beta"]);
    expect(outcome!.failed).toEqual([
      {
        item: "alpha",
        error: expect.objectContaining({ message: "alpha failed" }),
      },
    ]);
  });
});
