import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { providersApi } from "@/lib/api";
import { profilesApi } from "@/lib/api/profiles";
import type { ManagementTarget } from "@/lib/api/remote";
import type { ProfileScope } from "@/lib/api/profiles";
import { getManagementTargetKey } from "@/lib/managementTarget";
import { extractErrorMessage } from "@/utils/errorUtils";

const updateTrayMenuSafely = async (target: ManagementTarget) => {
  if (target.type !== "local") return;
  try {
    await providersApi.updateTrayMenu();
  } catch (trayError) {
    console.error("Failed to update tray menu after profile change", trayError);
  }
};

const profileQueryKey = (target: ManagementTarget) => [
  "profiles",
  getManagementTargetKey(target),
];

export const useProfilesQuery = (
  target: ManagementTarget = { type: "local" },
) => {
  return useQuery({
    queryKey: profileQueryKey(target),
    queryFn: () => profilesApi.list(target),
  });
};

export const useCreateProfileMutation = (
  target: ManagementTarget = { type: "local" },
) => {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: ({ name, scope }: { name: string; scope: ProfileScope }) =>
      profilesApi.create(name, scope, target),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: profileQueryKey(target),
      });
      await updateTrayMenuSafely(target);
      toast.success(t("profiles.createSuccess"), { closeButton: true });
    },
    onError: (error: Error) => {
      const detail = extractErrorMessage(error) || t("common.unknown");
      toast.error(t("profiles.createFailed", { detail }), {
        closeButton: true,
      });
    },
  });
};

export const useUpdateProfileMutation = (
  target: ManagementTarget = { type: "local" },
) => {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: ({
      id,
      name,
      resnapshot,
      scope,
    }: {
      id: string;
      name?: string;
      resnapshot?: boolean;
      scope?: ProfileScope;
    }) => profilesApi.update(id, { name, resnapshot, scope }, target),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: profileQueryKey(target),
      });
      await updateTrayMenuSafely(target);
      toast.success(t("profiles.updateSuccess"), { closeButton: true });
    },
    onError: (error: Error) => {
      const detail = extractErrorMessage(error) || t("common.unknown");
      toast.error(t("profiles.updateFailed", { detail }), {
        closeButton: true,
      });
    },
  });
};

export const useDeleteProfileMutation = (
  target: ManagementTarget = { type: "local" },
) => {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: (id: string) => profilesApi.delete(id, target),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: profileQueryKey(target),
      });
      await updateTrayMenuSafely(target);
      toast.success(t("profiles.deleteSuccess"), { closeButton: true });
    },
    onError: (error: Error) => {
      const detail = extractErrorMessage(error) || t("common.unknown");
      toast.error(t("profiles.deleteFailed", { detail }), {
        closeButton: true,
      });
    },
  });
};

export const useClearProfileMutation = (
  target: ManagementTarget = { type: "local" },
) => {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: (scope: ProfileScope) =>
      profilesApi.clearCurrent(scope, target),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: profileQueryKey(target),
      });
      await updateTrayMenuSafely(target);
      toast.success(t("profiles.clearSuccess"), { closeButton: true });
    },
    onError: (error: Error) => {
      const detail = extractErrorMessage(error) || t("common.unknown");
      toast.error(t("profiles.applyFailed", { detail }), {
        closeButton: true,
      });
    },
  });
};

export const useApplyProfileMutation = (
  target: ManagementTarget = { type: "local" },
) => {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: ({ id, scope }: { id: string; scope: ProfileScope }) =>
      profilesApi.apply(id, scope, target),
    onSuccess: async (warnings) => {
      await queryClient.invalidateQueries({
        queryKey: profileQueryKey(target),
      });
      await queryClient.invalidateQueries({
        queryKey: ["providers", "claude"],
      });
      await queryClient.invalidateQueries({
        queryKey: ["providers", "claude-desktop"],
      });
      await queryClient.invalidateQueries({ queryKey: ["providers", "codex"] });
      await queryClient.invalidateQueries({ queryKey: ["mcp", "all"] });
      await queryClient.invalidateQueries({ queryKey: ["skills"] });
      await updateTrayMenuSafely(target);

      if (warnings.length > 0) {
        toast.warning(
          t("profiles.applyWarnings", {
            warningCount: warnings.length,
            details: warnings.join("\n"),
          }),
          { closeButton: true, duration: 10000 },
        );
      } else {
        toast.success(t("profiles.applySuccess"), { closeButton: true });
      }
    },
    onError: (error: Error) => {
      const detail = extractErrorMessage(error) || t("common.unknown");
      toast.error(t("profiles.applyFailed", { detail }), {
        closeButton: true,
      });
    },
  });
};
