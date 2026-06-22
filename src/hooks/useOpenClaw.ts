import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { openclawApi } from "@/lib/api/openclaw";
import { providersApi } from "@/lib/api/providers";
import { remoteApi, type ManagementTarget } from "@/lib/api/remote";
import type {
  OpenClawEnvConfig,
  OpenClawToolsConfig,
  OpenClawAgentsDefaults,
} from "@/types";

const LOCAL_TARGET: ManagementTarget = { type: "local" };
export const getOpenClawTargetKey = (target: ManagementTarget) =>
  target.type === "remote" ? `remote:${target.profile.id}` : "local";

/**
 * Centralized query keys for all OpenClaw-related queries.
 * Import this from any file that needs to invalidate OpenClaw caches.
 */
export const openclawKeys = {
  all: ["openclaw"] as const,
  liveProviderIds: (targetKey = "local") =>
    ["openclaw", "liveProviderIds", targetKey] as const,
  defaultModel: ["openclaw", "defaultModel"] as const,
  env: ["openclaw", "env"] as const,
  tools: ["openclaw", "tools"] as const,
  agentsDefaults: ["openclaw", "agentsDefaults"] as const,
  health: ["openclaw", "health"] as const,
};

// ============================================================
// Query hooks
// ============================================================

/**
 * Query live provider IDs from openclaw.json config.
 * Used by ProviderList to show "In Config" badge.
 */
export function useOpenClawLiveProviderIds(
  enabled: boolean,
  target: ManagementTarget = LOCAL_TARGET,
) {
  const targetKey = getOpenClawTargetKey(target);
  return useQuery({
    queryKey: openclawKeys.liveProviderIds(targetKey),
    queryFn: () => providersApi.getOpenClawLiveProviderIds(target),
    enabled,
  });
}

/**
 * Query the default model from agents.defaults.model.
 * Used by ProviderList to show which provider is the default.
 */
export function useOpenClawDefaultModel(
  enabled: boolean,
  target: ManagementTarget = LOCAL_TARGET,
) {
  return useQuery({
    queryKey: [...openclawKeys.defaultModel, getOpenClawTargetKey(target)],
    queryFn: () =>
      target.type === "remote"
        ? remoteApi.getOpenClawDefaultModel(target.profile, target.secret)
        : openclawApi.getDefaultModel(),
    enabled,
  });
}

/**
 * Query env section of openclaw.json.
 */
export function useOpenClawEnv(target: ManagementTarget = LOCAL_TARGET) {
  return useQuery({
    queryKey: [...openclawKeys.env, getOpenClawTargetKey(target)],
    queryFn: () =>
      target.type === "remote"
        ? remoteApi.getOpenClawEnv(target.profile, target.secret)
        : openclawApi.getEnv(),
    staleTime: 30_000,
  });
}

/**
 * Query tools section of openclaw.json.
 */
export function useOpenClawTools(target: ManagementTarget = LOCAL_TARGET) {
  return useQuery({
    queryKey: [...openclawKeys.tools, getOpenClawTargetKey(target)],
    queryFn: () =>
      target.type === "remote"
        ? remoteApi.getOpenClawTools(target.profile, target.secret)
        : openclawApi.getTools(),
    staleTime: 30_000,
  });
}

/**
 * Query agents.defaults section of openclaw.json.
 */
export function useOpenClawAgentsDefaults(
  target: ManagementTarget = LOCAL_TARGET,
) {
  return useQuery({
    queryKey: [...openclawKeys.agentsDefaults, getOpenClawTargetKey(target)],
    queryFn: () =>
      target.type === "remote"
        ? remoteApi.getOpenClawAgentsDefaults(target.profile, target.secret)
        : openclawApi.getAgentsDefaults(),
    staleTime: 30_000,
  });
}

export function useOpenClawHealth(
  enabled: boolean,
  target: ManagementTarget = LOCAL_TARGET,
) {
  return useQuery({
    queryKey: [...openclawKeys.health, getOpenClawTargetKey(target)],
    queryFn: () =>
      target.type === "remote"
        ? remoteApi.scanOpenClawHealth(target.profile, target.secret)
        : openclawApi.scanHealth(),
    staleTime: 30_000,
    enabled,
  });
}

// ============================================================
// Mutation hooks
// ============================================================

/**
 * Save env config. Invalidates env query on success.
 * Toast notifications are handled by the component.
 */
export function useSaveOpenClawEnv(target: ManagementTarget = LOCAL_TARGET) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (env: OpenClawEnvConfig) =>
      target.type === "remote"
        ? remoteApi.setOpenClawEnv(target.profile, env, target.secret)
        : openclawApi.setEnv(env),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [...openclawKeys.env, getOpenClawTargetKey(target)],
      });
      queryClient.invalidateQueries({
        queryKey: [...openclawKeys.health, getOpenClawTargetKey(target)],
      });
    },
  });
}

/**
 * Save tools config. Invalidates tools query on success.
 * Toast notifications are handled by the component.
 */
export function useSaveOpenClawTools(target: ManagementTarget = LOCAL_TARGET) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tools: OpenClawToolsConfig) =>
      target.type === "remote"
        ? remoteApi.setOpenClawTools(target.profile, tools, target.secret)
        : openclawApi.setTools(tools),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [...openclawKeys.tools, getOpenClawTargetKey(target)],
      });
      queryClient.invalidateQueries({
        queryKey: [...openclawKeys.health, getOpenClawTargetKey(target)],
      });
    },
  });
}

/**
 * Save agents.defaults config. Invalidates both agentsDefaults and defaultModel
 * queries on success (since changing agents.defaults may affect the default model).
 * Toast notifications are handled by the component.
 */
export function useSaveOpenClawAgentsDefaults(
  target: ManagementTarget = LOCAL_TARGET,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (defaults: OpenClawAgentsDefaults) =>
      target.type === "remote"
        ? remoteApi.setOpenClawAgentsDefaults(
            target.profile,
            defaults,
            target.secret,
          )
        : openclawApi.setAgentsDefaults(defaults),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [
          ...openclawKeys.agentsDefaults,
          getOpenClawTargetKey(target),
        ],
      });
      queryClient.invalidateQueries({
        queryKey: [...openclawKeys.defaultModel, getOpenClawTargetKey(target)],
      });
      queryClient.invalidateQueries({
        queryKey: [...openclawKeys.health, getOpenClawTargetKey(target)],
      });
    },
  });
}
