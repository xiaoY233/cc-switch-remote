import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { remoteApi, type ManagementTarget } from "@/lib/api";
import type { MigrationResult } from "@/lib/api/skills";
import type { Settings, SkillStorageLocation } from "@/types";
import { extractErrorMessage } from "@/utils/errorUtils";

type RemoteTarget = Extract<ManagementTarget, { type: "remote" }>;

interface UseRemoteSettingsOptions {
  target: RemoteTarget;
  onSettingsSaved?: (settings: Settings) => void;
}

export function useRemoteSettings({
  target,
  onSettingsSaved,
}: UseRemoteSettingsOptions) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [installedSkillCount, setInstalledSkillCount] = useState(0);
  const [activeTask, setActiveTask] = useState<string | null>(null);

  const loadSettings = useCallback(
    async (canLoadSkills: boolean) => {
      setIsLoading(true);
      setActiveTask(
        t("remote.settings.tasks.loadSettings", {
          defaultValue: "正在读取远程设置...",
        }),
      );
      try {
        const [nextSettings, installedSkills] = await Promise.all([
          remoteApi.getSettings(target.profile, target.secret),
          canLoadSkills
            ? remoteApi.getInstalledSkills(target.profile, target.secret)
            : Promise.resolve([]),
        ]);
        setSettings(nextSettings);
        setInstalledSkillCount(installedSkills.length);
        return nextSettings;
      } catch (error) {
        console.error("[useRemoteSettings] Failed to load settings", error);
        setSettings(null);
        toast.error(
          t("remote.settings.general.loadFailed", {
            defaultValue: "远程设置加载失败",
          }),
          { description: extractErrorMessage(error) },
        );
        return null;
      } finally {
        setIsLoading(false);
        setActiveTask(null);
      }
    },
    [t, target.profile, target.secret],
  );

  const clearSettings = useCallback(() => {
    setSettings(null);
    setInstalledSkillCount(0);
  }, []);

  const syncClaudePluginIfChanged = useCallback(
    async (nextSettings: Settings, previousSettings: Settings) => {
      const nextEnabled = nextSettings.enableClaudePluginIntegration ?? false;
      const previousEnabled =
        previousSettings.enableClaudePluginIntegration ?? false;
      if (nextEnabled === previousEnabled) return;

      let official = true;
      if (nextEnabled) {
        const currentId = await remoteApi.getCurrentProvider(
          target.profile,
          "claude",
          target.secret,
        );
        if (currentId) {
          const providers = await remoteApi.getProviders(
            target.profile,
            "claude",
            target.secret,
          );
          official = providers[currentId]?.category === "official";
        }
      }

      await remoteApi.applyClaudePluginConfig(
        target.profile,
        official,
        target.secret,
      );
    },
    [target.profile, target.secret],
  );

  const syncClaudeOnboardingIfChanged = useCallback(
    async (nextSettings: Settings, previousSettings: Settings) => {
      const nextEnabled = nextSettings.skipClaudeOnboarding ?? false;
      const previousEnabled = previousSettings.skipClaudeOnboarding ?? false;
      if (nextEnabled === previousEnabled) return;
      await remoteApi.setClaudeOnboardingSkip(
        target.profile,
        nextEnabled,
        target.secret,
      );
    },
    [target.profile, target.secret],
  );

  const saveSettings = useCallback(
    async (updates: Partial<Settings>) => {
      if (!settings) return false;
      const nextSettings: Settings = { ...settings, ...updates };
      const previousSettings = settings;
      setSettings(nextSettings);
      onSettingsSaved?.(nextSettings);
      setIsSaving(true);
      setActiveTask(
        t("remote.settings.tasks.saveSettings", {
          defaultValue: "正在保存远程设置...",
        }),
      );
      try {
        await remoteApi.saveSettings(
          target.profile,
          nextSettings,
          target.secret,
        );
        await syncClaudePluginIfChanged(nextSettings, settings);
        await syncClaudeOnboardingIfChanged(nextSettings, settings);
        return true;
      } catch (error) {
        setSettings(previousSettings);
        onSettingsSaved?.(previousSettings);
        console.error("[useRemoteSettings] Failed to save settings", error);
        toast.error(
          t("remote.settings.general.saveFailed", {
            defaultValue: "远程设置保存失败",
          }),
          { description: extractErrorMessage(error) },
        );
        return false;
      } finally {
        setIsSaving(false);
        setActiveTask(null);
      }
    },
    [
      onSettingsSaved,
      settings,
      syncClaudeOnboardingIfChanged,
      syncClaudePluginIfChanged,
      t,
      target.profile,
      target.secret,
    ],
  );

  const migrateSkillStorage = useCallback(
    async (targetLocation: SkillStorageLocation): Promise<MigrationResult> => {
      const result = await remoteApi.migrateSkillStorage(
        target.profile,
        targetLocation,
        target.secret,
      );
      setSettings((prev) =>
        prev ? { ...prev, skillStorageLocation: targetLocation } : prev,
      );
      return result;
    },
    [target.profile, target.secret],
  );

  return {
    settings,
    isLoading,
    isSaving,
    installedSkillCount,
    activeTask,
    loadSettings,
    clearSettings,
    saveSettings,
    migrateSkillStorage,
  };
}
