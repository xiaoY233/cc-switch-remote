import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  providersApi,
  sessionsApi,
  settingsApi,
  type AppId,
  type ManagementTarget,
} from "@/lib/api";
import type { DeleteSessionOptions } from "@/lib/api/sessions";
import type { SwitchResult } from "@/lib/api/providers";
import type { Provider, SessionMeta, Settings } from "@/types";
import { extractErrorMessage } from "@/utils/errorUtils";
import { generateUUID } from "@/utils/uuid";
import { openclawKeys } from "@/hooks/useOpenClaw";
import { invalidateHermesProviderCaches } from "@/hooks/useHermes";
import { usageKeys } from "@/lib/query/usage";
import { omoKeys, omoSlimKeys } from "@/lib/query/omo";
import { CODEX_OFFICIAL_PROVIDER_ID } from "@/utils/providerCapabilities";

const targetKey = (target: ManagementTarget) =>
  target.type === "remote" ? `remote:${target.profile.id}` : "local";

const providerQueryKey = (appId: AppId, target: ManagementTarget) => [
  "providers",
  appId,
  targetKey(target),
];

const invalidateOpenCodeDerivedState = async (
  queryClient: ReturnType<typeof useQueryClient>,
  target: ManagementTarget,
) => {
  const key = targetKey(target);
  await queryClient.invalidateQueries({
    queryKey: ["opencodeLiveProviderIds", key],
  });
  await queryClient.invalidateQueries({
    queryKey: omoKeys.currentProviderId(key),
  });
  await queryClient.invalidateQueries({
    queryKey: omoSlimKeys.currentProviderId(key),
  });
};

export const useAddProviderMutation = (
  appId: AppId,
  target: ManagementTarget = { type: "local" },
) => {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: async (
      providerInput: Omit<Provider, "id"> & {
        providerKey?: string;
        addToLive?: boolean;
        ensureClaudeDesktopOfficialSeed?: boolean;
        ensureCodexOfficialSeed?: boolean;
      },
    ) => {
      const {
        providerKey: _providerKey,
        addToLive,
        ensureClaudeDesktopOfficialSeed,
        ensureCodexOfficialSeed,
        ...rest
      } = providerInput;

      if (
        appId === "claude-desktop" &&
        ensureClaudeDesktopOfficialSeed &&
        target.type === "local"
      ) {
        await providersApi.ensureClaudeDesktopOfficialProvider();
        const providers = await providersApi.getAll(appId);
        const officialProvider = providers["claude-desktop-official"];
        if (!officialProvider) {
          throw new Error("Claude Desktop official provider was not created");
        }
        return officialProvider;
      }

      if (
        appId === "codex" &&
        ensureCodexOfficialSeed &&
        target.type === "local"
      ) {
        await providersApi.ensureCodexOfficialProvider();
        const providers = await providersApi.getAll(appId);
        const officialProvider = providers[CODEX_OFFICIAL_PROVIDER_ID];
        if (!officialProvider) {
          throw new Error("Codex official provider was not created");
        }
        return officialProvider;
      }

      let id: string;

      if (appId === "opencode" || appId === "openclaw" || appId === "hermes") {
        if (
          providerInput.category === "omo" ||
          providerInput.category === "omo-slim"
        ) {
          const prefix = providerInput.category === "omo" ? "omo" : "omo-slim";
          id = `${prefix}-${generateUUID()}`;
        } else {
          if (!providerInput.providerKey) {
            throw new Error(`Provider key is required for ${appId}`);
          }
          id = providerInput.providerKey;
        }
      } else {
        id = generateUUID();
      }

      const newProvider: Provider = {
        ...rest,
        id,
        createdAt: Date.now(),
      };
      delete (newProvider as any).providerKey;

      await providersApi.add(newProvider, appId, addToLive, target);
      return newProvider;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: providerQueryKey(appId, target),
      });

      if (appId === "opencode") {
        await invalidateOpenCodeDerivedState(queryClient, target);
      }

      if (appId === "openclaw") {
        await queryClient.invalidateQueries({
          queryKey: [...openclawKeys.health, targetKey(target)],
        });
      }

      if (appId === "hermes") {
        await invalidateHermesProviderCaches(queryClient);
      }

      if (target.type === "local") {
        try {
          await providersApi.updateTrayMenu();
        } catch (trayError) {
          console.error(
            "Failed to update tray menu after adding provider",
            trayError,
          );
        }
      }

      toast.success(
        t("notifications.providerAdded", {
          defaultValue: "供应商已添加",
        }),
        {
          closeButton: true,
        },
      );
    },
    onError: (error: Error) => {
      const detail = extractErrorMessage(error) || t("common.unknown");
      toast.error(
        t("notifications.addFailed", {
          defaultValue: "添加供应商失败: {{error}}",
          error: detail,
        }),
      );
    },
  });
};

export const useUpdateProviderMutation = (
  appId: AppId,
  target: ManagementTarget = { type: "local" },
) => {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: async ({
      provider,
      originalId,
    }: {
      provider: Provider;
      originalId?: string;
    }) => {
      await providersApi.update(provider, appId, originalId, target);
      return provider;
    },
    onSuccess: async (provider, variables) => {
      await queryClient.invalidateQueries({
        queryKey: providerQueryKey(appId, target),
      });
      await queryClient.invalidateQueries({
        queryKey: usageKeys.script(provider.id, appId),
      });
      if (variables.originalId && variables.originalId !== provider.id) {
        await queryClient.invalidateQueries({
          queryKey: usageKeys.script(variables.originalId, appId),
        });
      }
      if (appId === "openclaw") {
        await queryClient.invalidateQueries({
          queryKey: [...openclawKeys.health, targetKey(target)],
        });
      }
      if (appId === "hermes") {
        await invalidateHermesProviderCaches(queryClient);
      }
      toast.success(
        t("notifications.updateSuccess", {
          defaultValue: "供应商更新成功",
        }),
        {
          closeButton: true,
        },
      );
    },
    onError: (error: Error) => {
      const detail = extractErrorMessage(error) || t("common.unknown");
      toast.error(
        t("notifications.updateFailed", {
          defaultValue: "更新供应商失败: {{error}}",
          error: detail,
        }),
      );
    },
  });
};

export const useDeleteProviderMutation = (
  appId: AppId,
  target: ManagementTarget = { type: "local" },
) => {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: async (providerId: string) => {
      await providersApi.delete(providerId, appId, target);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: providerQueryKey(appId, target),
      });

      if (appId === "opencode") {
        await invalidateOpenCodeDerivedState(queryClient, target);
      }

      if (appId === "openclaw") {
        await queryClient.invalidateQueries({
          queryKey: [...openclawKeys.health, targetKey(target)],
        });
      }

      if (appId === "hermes") {
        await invalidateHermesProviderCaches(queryClient);
      }

      if (target.type === "local") {
        try {
          await providersApi.updateTrayMenu();
        } catch (trayError) {
          console.error(
            "Failed to update tray menu after deleting provider",
            trayError,
          );
        }
      }

      toast.success(
        t("notifications.deleteSuccess", {
          defaultValue: "供应商已删除",
        }),
        {
          closeButton: true,
        },
      );
    },
    onError: (error: Error) => {
      const detail = extractErrorMessage(error) || t("common.unknown");
      toast.error(
        t("notifications.deleteFailed", {
          defaultValue: "删除供应商失败: {{error}}",
          error: detail,
        }),
      );
    },
  });
};

export const useSwitchProviderMutation = (
  appId: AppId,
  target: ManagementTarget = { type: "local" },
) => {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: async (providerId: string): Promise<SwitchResult> => {
      return await providersApi.switch(providerId, appId, target);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: providerQueryKey(appId, target),
      });
      if (appId === "claude-desktop") {
        await queryClient.invalidateQueries({ queryKey: ["proxyStatus"] });
        await queryClient.invalidateQueries({
          queryKey: ["claudeDesktopStatus"],
        });
      }

      // OpenCode/OpenClaw: also invalidate live provider IDs cache to update button state
      if (appId === "opencode") {
        await invalidateOpenCodeDerivedState(queryClient, target);
      }
      if (appId === "openclaw") {
        await queryClient.invalidateQueries({
          queryKey: openclawKeys.liveProviderIds(targetKey(target)),
        });
        await queryClient.invalidateQueries({
          queryKey: [...openclawKeys.defaultModel, targetKey(target)],
        });
        await queryClient.invalidateQueries({
          queryKey: [...openclawKeys.health, targetKey(target)],
        });
      }
      if (appId === "hermes") {
        await invalidateHermesProviderCaches(queryClient, target);
      }

      if (target.type === "local") {
        try {
          await providersApi.updateTrayMenu();
        } catch (trayError) {
          console.error(
            "Failed to update tray menu after switching provider",
            trayError,
          );
        }
      }
    },
    onError: (error: Error) => {
      const detail = extractErrorMessage(error) || t("common.unknown");

      toast.error(
        t("notifications.switchFailedTitle", { defaultValue: "切换失败" }),
        {
          description: t("notifications.switchFailed", {
            defaultValue: "切换失败：{{error}}",
            error: detail,
          }),
          duration: 6000,
          action: {
            label: t("common.copy", { defaultValue: "复制" }),
            onClick: () => {
              navigator.clipboard?.writeText(detail).catch(() => undefined);
            },
          },
        },
      );
    },
  });
};

export const useDeleteSessionMutation = (
  target: ManagementTarget = { type: "local" },
) => {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: async (input: DeleteSessionOptions) => {
      await sessionsApi.delete(input, target);
      return input;
    },
    onSuccess: async (input) => {
      const sessionsKey = ["sessions", targetKey(target)];
      queryClient.setQueryData<SessionMeta[]>(sessionsKey, (current) =>
        (current ?? []).filter(
          (session) =>
            !(
              session.providerId === input.providerId &&
              session.sessionId === input.sessionId &&
              session.sourcePath === input.sourcePath
            ),
        ),
      );
      queryClient.removeQueries({
        queryKey: [
          "sessionMessages",
          targetKey(target),
          input.providerId,
          input.sourcePath,
        ],
      });

      await queryClient.invalidateQueries({ queryKey: sessionsKey });

      toast.success(
        t("sessionManager.sessionDeleted", {
          defaultValue: "会话已删除",
        }),
      );
    },
    onError: (error: Error) => {
      const detail = extractErrorMessage(error) || t("common.unknown");
      toast.error(
        t("sessionManager.deleteFailed", {
          defaultValue: "删除会话失败: {{error}}",
          error: detail,
        }),
      );
    },
  });
};

export const useSaveSettingsMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (settings: Settings) => {
      await settingsApi.save(settings);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });
};
