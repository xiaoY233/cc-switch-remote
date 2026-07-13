import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { mcpApi } from "@/lib/api/mcp";
import type { McpServer } from "@/types";
import type { AppId } from "@/lib/api/types";
import type { ManagementTarget } from "@/lib/api/remote";

const LOCAL_TARGET: ManagementTarget = { type: "local" };

const getTargetKey = (target: ManagementTarget) =>
  target.type === "remote" ? `remote:${target.profile.id}` : "local";

/**
 * 查询所有 MCP 服务器（统一管理）
 */
export function useAllMcpServers(target: ManagementTarget = LOCAL_TARGET) {
  const targetKey = getTargetKey(target);
  return useQuery({
    queryKey: ["mcp", "all", targetKey],
    queryFn: () => mcpApi.getAllServers(target),
  });
}

/**
 * 添加或更新 MCP 服务器
 */
export function useUpsertMcpServer(target: ManagementTarget = LOCAL_TARGET) {
  const queryClient = useQueryClient();
  const targetKey = getTargetKey(target);
  return useMutation({
    mutationFn: (server: McpServer) =>
      mcpApi.upsertUnifiedServer(server, target),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mcp", "all", targetKey] });
    },
  });
}

/**
 * 切换 MCP 服务器在特定应用的启用状态
 */
export function useToggleMcpApp(target: ManagementTarget = LOCAL_TARGET) {
  const queryClient = useQueryClient();
  const targetKey = getTargetKey(target);
  return useMutation({
    mutationFn: ({
      serverId,
      app,
      enabled,
    }: {
      serverId: string;
      app: AppId;
      enabled: boolean;
    }) => mcpApi.toggleApp(serverId, app, enabled, target),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mcp", "all", targetKey] });
    },
  });
}

/**
 * 删除 MCP 服务器
 */
export function useDeleteMcpServer(target: ManagementTarget = LOCAL_TARGET) {
  const queryClient = useQueryClient();
  const targetKey = getTargetKey(target);
  return useMutation({
    mutationFn: (id: string) => mcpApi.deleteUnifiedServer(id, target),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mcp", "all", targetKey] });
    },
  });
}

/**
 * 从所有应用导入 MCP 服务器
 */
export function useImportMcpFromApps(target: ManagementTarget = LOCAL_TARGET) {
  const queryClient = useQueryClient();
  const targetKey = getTargetKey(target);
  return useMutation({
    mutationFn: () => mcpApi.importFromApps(target),
    // 后端是 best-effort 导入：部分应用失败会返回错误，但其余应用的
    // 服务器已经入库，失败时也要刷新列表。
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["mcp", "all", targetKey] });
    },
  });
}
