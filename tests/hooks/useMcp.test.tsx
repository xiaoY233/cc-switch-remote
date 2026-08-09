import type { ReactNode } from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useAllMcpServers,
  useDeleteMcpServer,
  useImportMcpFromApps,
  useToggleMcpApp,
  useUpsertMcpServer,
} from "@/hooks/useMcp";
import type { ManagementTarget } from "@/lib/api/remote";
import type { McpServer } from "@/types";

const getAllServersMock = vi.hoisted(() => vi.fn());
const upsertUnifiedServerMock = vi.hoisted(() => vi.fn());
const deleteUnifiedServerMock = vi.hoisted(() => vi.fn());
const toggleAppMock = vi.hoisted(() => vi.fn());
const importFromAppsMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/mcp", () => ({
  mcpApi: {
    getAllServers: (...args: unknown[]) => getAllServersMock(...args),
    upsertUnifiedServer: (...args: unknown[]) =>
      upsertUnifiedServerMock(...args),
    deleteUnifiedServer: (...args: unknown[]) =>
      deleteUnifiedServerMock(...args),
    toggleApp: (...args: unknown[]) => toggleAppMock(...args),
    importFromApps: (...args: unknown[]) => importFromAppsMock(...args),
  },
}));

const remoteTarget: ManagementTarget = {
  type: "remote",
  profile: {
    id: "remote-1",
    name: "Remote 1",
    host: "192.168.1.20",
    port: 22,
    username: "root",
    authMethod: { type: "password" },
    helperPath: "~/.local/bin/cc-switch-remote-helper",
    createdAt: 1,
    updatedAt: 1,
  },
  secret: { password: "secret" },
};

const server: McpServer = {
  id: "echo",
  name: "Echo",
  enabled: true,
  server: { type: "stdio", command: "echo" },
  apps: {
    claude: true,
    codex: false,
    gemini: false,
    opencode: false,
    openclaw: false,
    hermes: false,
  },
};

interface WrapperProps {
  children: ReactNode;
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  const wrapper = ({ children }: WrapperProps) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return { queryClient, wrapper };
}

beforeEach(() => {
  getAllServersMock.mockReset();
  upsertUnifiedServerMock.mockReset();
  deleteUnifiedServerMock.mockReset();
  toggleAppMock.mockReset();
  importFromAppsMock.mockReset();
});

describe("useMcp remote target", () => {
  it("loads MCP servers from the selected remote target", async () => {
    getAllServersMock.mockResolvedValueOnce({ echo: server });
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useAllMcpServers(remoteTarget), {
      wrapper,
    });

    await waitFor(() => expect(result.current.data).toEqual({ echo: server }));
    expect(getAllServersMock).toHaveBeenCalledWith(remoteTarget);
  });

  it("reloads a same-profile target identity and ignores the old MCP response", async () => {
    const nextTarget: ManagementTarget = {
      ...remoteTarget,
      profile: {
        ...remoteTarget.profile,
        host: "192.168.1.21",
        updatedAt: 2,
      },
      secret: { password: "new-secret" },
    };
    const nextServer = { ...server, id: "next", name: "Next" };
    let resolveOld!: (value: Record<string, McpServer>) => void;
    let resolveNext!: (value: Record<string, McpServer>) => void;
    const oldRequest = new Promise<Record<string, McpServer>>((resolve) => {
      resolveOld = resolve;
    });
    const nextRequest = new Promise<Record<string, McpServer>>((resolve) => {
      resolveNext = resolve;
    });
    getAllServersMock.mockImplementation((target: ManagementTarget) =>
      target === remoteTarget ? oldRequest : nextRequest,
    );
    const { wrapper } = createWrapper();
    const { result, rerender } = renderHook(
      ({ target }: { target: ManagementTarget }) => useAllMcpServers(target),
      {
        initialProps: { target: remoteTarget },
        wrapper,
      },
    );

    await waitFor(() => expect(getAllServersMock).toHaveBeenCalledTimes(1));
    rerender({ target: nextTarget });
    await waitFor(() => expect(getAllServersMock).toHaveBeenCalledTimes(2));

    resolveNext({ next: nextServer });
    await waitFor(() =>
      expect(result.current.data).toEqual({ next: nextServer }),
    );
    resolveOld({ echo: server });
    await act(async () => {
      await oldRequest;
    });

    expect(result.current.data).toEqual({ next: nextServer });
    expect(getAllServersMock.mock.calls).toEqual([
      [remoteTarget],
      [nextTarget],
    ]);
  });

  it("upserts remote MCP servers and invalidates only the remote MCP cache", async () => {
    upsertUnifiedServerMock.mockResolvedValueOnce(undefined);
    const { queryClient, wrapper } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useUpsertMcpServer(remoteTarget), {
      wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync(server);
    });

    expect(upsertUnifiedServerMock).toHaveBeenCalledWith(server, remoteTarget);
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["mcp", "all", "remote:remote-1"],
    });
    expect(invalidateSpy).not.toHaveBeenCalledWith({
      queryKey: ["mcp", "all", "local"],
    });
  });

  it("routes toggle, delete, and import mutations through the remote target", async () => {
    toggleAppMock.mockResolvedValueOnce(undefined);
    deleteUnifiedServerMock.mockResolvedValueOnce(true);
    importFromAppsMock.mockResolvedValueOnce(2);
    const { wrapper } = createWrapper();

    const toggle = renderHook(() => useToggleMcpApp(remoteTarget), {
      wrapper,
    });
    const remove = renderHook(() => useDeleteMcpServer(remoteTarget), {
      wrapper,
    });
    const importFromApps = renderHook(
      () => useImportMcpFromApps(remoteTarget),
      {
        wrapper,
      },
    );

    await act(async () => {
      await toggle.result.current.mutateAsync({
        serverId: "echo",
        app: "codex",
        enabled: true,
      });
      await remove.result.current.mutateAsync("echo");
      await importFromApps.result.current.mutateAsync();
    });

    expect(toggleAppMock).toHaveBeenCalledWith(
      "echo",
      "codex",
      true,
      remoteTarget,
    );
    expect(deleteUnifiedServerMock).toHaveBeenCalledWith("echo", remoteTarget);
    expect(importFromAppsMock).toHaveBeenCalledWith(remoteTarget);
  });
});
