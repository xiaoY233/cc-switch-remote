import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useApplyProfileMutation } from "@/lib/query/profiles";
import type { ManagementTarget } from "@/lib/api/remote";

const applyProfileMock = vi.hoisted(() => vi.fn());
const updateTrayMenuMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());
const toastWarningMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/profiles", () => ({
  profilesApi: {
    apply: (...args: unknown[]) => applyProfileMock(...args),
  },
}));

vi.mock("@/lib/api", () => ({
  providersApi: {
    updateTrayMenu: (...args: unknown[]) => updateTrayMenuMock(...args),
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    warning: (...args: unknown[]) => toastWarningMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const remoteTarget: ManagementTarget = {
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

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { wrapper, invalidateSpy };
}

describe("useApplyProfileMutation", () => {
  beforeEach(() => {
    applyProfileMock.mockReset();
    updateTrayMenuMock.mockReset();
    toastSuccessMock.mockReset();
    toastWarningMock.mockReset();
    toastErrorMock.mockReset();
  });

  it("invalidates remote-target provider and MCP keys after applying a remote profile", async () => {
    applyProfileMock.mockResolvedValueOnce([]);
    const { wrapper, invalidateSpy } = createWrapper();

    const { result } = renderHook(() => useApplyProfileMutation(remoteTarget), {
      wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({ id: "profile-1", scope: "codex" });
    });

    expect(applyProfileMock).toHaveBeenCalledWith(
      "profile-1",
      "codex",
      remoteTarget,
    );
    expect(updateTrayMenuMock).not.toHaveBeenCalled();
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["providers", "codex", "remote:remote-1"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["mcp", "all", "remote:remote-1"],
    });
  });
});
