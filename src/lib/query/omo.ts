import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { omoApi, omoSlimApi } from "@/lib/api/omo";
import type { ManagementTarget } from "@/lib/api";
import {
  getManagementTargetKey,
  LOCAL_MANAGEMENT_TARGET,
} from "@/lib/managementTarget";

// ── Factory ────────────────────────────────────────────────────

function createOmoQueryKeys(prefix: string) {
  return {
    all: [prefix] as const,
    currentProviderId: (targetKey = "local") =>
      [prefix, "current-provider-id", targetKey] as const,
  };
}

function createOmoQueryHooks(
  variant: "omo" | "omo-slim",
  api: typeof omoApi | typeof omoSlimApi,
) {
  const keys = createOmoQueryKeys(variant);

  function invalidateAll(
    queryClient: ReturnType<typeof useQueryClient>,
    target: ManagementTarget,
  ) {
    const targetKey = getManagementTargetKey(target);
    queryClient.invalidateQueries({ queryKey: ["providers"] });
    queryClient.invalidateQueries({
      queryKey: keys.currentProviderId(targetKey),
    });
  }

  function useCurrentProviderId(
    enabled = true,
    target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
  ) {
    const targetKey = getManagementTargetKey(target);
    return useQuery({
      queryKey: keys.currentProviderId(targetKey),
      queryFn:
        "getCurrentOmoProviderId" in api
          ? () => (api as typeof omoApi).getCurrentOmoProviderId(target)
          : () => (api as typeof omoSlimApi).getCurrentProviderId(target),
      enabled,
    });
  }

  function useReadLocalFile(
    target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
  ) {
    return useMutation({
      mutationFn: () => api.readLocalFile(target),
    });
  }

  function useDisableCurrent(
    target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
  ) {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn:
        "disableCurrentOmo" in api
          ? () => (api as typeof omoApi).disableCurrentOmo(target)
          : () => (api as typeof omoSlimApi).disableCurrent(target),
      onSuccess: () => invalidateAll(queryClient, target),
    });
  }

  return {
    keys,
    useCurrentProviderId,
    useReadLocalFile,
    useDisableCurrent,
  };
}

// ── Instances ──────────────────────────────────────────────────

const omoHooks = createOmoQueryHooks("omo", omoApi);
const omoSlimHooks = createOmoQueryHooks("omo-slim", omoSlimApi);

// ── Backward-compatible exports ────────────────────────────────

export const omoKeys = omoHooks.keys;
export const omoSlimKeys = omoSlimHooks.keys;

export const useCurrentOmoProviderId = omoHooks.useCurrentProviderId;
export const useReadOmoLocalFile = omoHooks.useReadLocalFile;
export const useDisableCurrentOmo = omoHooks.useDisableCurrent;

export const useCurrentOmoSlimProviderId = omoSlimHooks.useCurrentProviderId;
export const useReadOmoSlimLocalFile = omoSlimHooks.useReadLocalFile;
export const useDisableCurrentOmoSlim = omoSlimHooks.useDisableCurrent;
