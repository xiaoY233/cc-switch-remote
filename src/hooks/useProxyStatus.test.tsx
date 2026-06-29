import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useProxyStatus } from "@/hooks/useProxyStatus";
import { getManagementTargetKey } from "@/lib/managementTarget";
import type { ManagementTarget } from "@/lib/api";

const getProxyStatusMock = vi.fn();
const startProxyServerMock = vi.fn();
const stopProxyWithRestoreMock = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    proxyApi: {
      getProxyStatus: (...args: unknown[]) => getProxyStatusMock(...args),
      startProxyServer: (...args: unknown[]) => startProxyServerMock(...args),
      stopProxyWithRestore: (...args: unknown[]) =>
        stopProxyWithRestoreMock(...args),
    },
  };
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const remoteTarget: ManagementTarget = {
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

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe("useProxyStatus remote routing cache", () => {
  beforeEach(() => {
    getProxyStatusMock.mockResolvedValue({
      running: false,
      address: "127.0.0.1",
      port: 15721,
      active_connections: 0,
      total_requests: 0,
      success_rate: 100,
      uptime_seconds: 0,
      active_targets: [],
    });
    startProxyServerMock.mockResolvedValue({
      address: "127.0.0.1",
      port: 15721,
    });
    stopProxyWithRestoreMock.mockResolvedValue(undefined);
  });

  it("invalidates remote app routing configs after stopping the remote runtime", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const targetKey = getManagementTargetKey(remoteTarget);

    for (const appType of ["claude", "codex", "gemini"] as const) {
      queryClient.setQueryData(["appProxyConfig", targetKey, appType], {
        appType,
        enabled: true,
      });
    }

    const { result } = renderHook(() => useProxyStatus(remoteTarget), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.stopWithRestore();
    });

    expect(stopProxyWithRestoreMock).toHaveBeenCalledWith(remoteTarget);
    for (const appType of ["claude", "codex", "gemini"] as const) {
      expect(
        queryClient.getQueryState(["appProxyConfig", targetKey, appType])
          ?.isInvalidated,
      ).toBe(true);
    }
  });

  it("invalidates remote app routing configs after the server stop path", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const targetKey = getManagementTargetKey(remoteTarget);

    for (const appType of ["claude", "codex", "gemini"] as const) {
      queryClient.setQueryData(["appProxyConfig", targetKey, appType], {
        appType,
        enabled: true,
      });
    }

    const { result } = renderHook(() => useProxyStatus(remoteTarget), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.stopProxyServer();
    });

    expect(stopProxyWithRestoreMock).toHaveBeenCalledWith(remoteTarget);
    for (const appType of ["claude", "codex", "gemini"] as const) {
      expect(
        queryClient.getQueryState(["appProxyConfig", targetKey, appType])
          ?.isInvalidated,
      ).toBe(true);
    }
  });
});
