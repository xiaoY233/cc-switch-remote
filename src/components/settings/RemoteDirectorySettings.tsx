import { useEffect, useState } from "react";
import { Info, Loader2, Save, Undo2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Settings } from "@/types";
import { settingsApi, type ManagementTarget } from "@/lib/api";
import { extractErrorMessage } from "@/utils/errorUtils";
import {
  REMOTE_DIRECTORY_FIELDS,
  buildRemoteDirectoryUpdates,
  getRemoteDirectoryValue,
  type RemoteDirectoryApp,
} from "./remoteDirectorySettingsUtils";

interface RemoteDirectorySettingsProps {
  settings: Settings;
  target: Extract<ManagementTarget, { type: "remote" }>;
  supportsAppConfigDir?: boolean;
  isSaving?: boolean;
  onSave: (
    updates: Partial<Settings>,
  ) => Promise<boolean | void> | boolean | void;
}

type DirectoryDrafts = Record<RemoteDirectoryApp, string>;

function buildDrafts(settings: Settings): DirectoryDrafts {
  return Object.fromEntries(
    REMOTE_DIRECTORY_FIELDS.map((field) => [
      field.app,
      getRemoteDirectoryValue(settings, field.app),
    ]),
  ) as DirectoryDrafts;
}

export function RemoteDirectorySettings({
  settings,
  target,
  supportsAppConfigDir = true,
  isSaving = false,
  onSave,
}: RemoteDirectorySettingsProps) {
  const { t } = useTranslation();
  const [drafts, setDrafts] = useState<DirectoryDrafts>(() =>
    buildDrafts(settings),
  );
  const [appConfigDir, setAppConfigDir] = useState("");
  const [appConfigDraft, setAppConfigDraft] = useState("");
  const [isLoadingAppConfigDir, setIsLoadingAppConfigDir] = useState(false);
  const [isSavingAppConfigDir, setIsSavingAppConfigDir] = useState(false);
  const [appConfigDirUnsupported, setAppConfigDirUnsupported] =
    useState(!supportsAppConfigDir);
  const [savingApp, setSavingApp] = useState<RemoteDirectoryApp | null>(null);

  useEffect(() => {
    setDrafts(buildDrafts(settings));
  }, [settings]);

  useEffect(() => {
    setAppConfigDirUnsupported(!supportsAppConfigDir);
    if (!supportsAppConfigDir) {
      setAppConfigDir("");
      setAppConfigDraft("");
      setIsLoadingAppConfigDir(false);
      return;
    }

    let active = true;
    setIsLoadingAppConfigDir(true);
    settingsApi
      .getAppConfigDirOverride(target)
      .then((value) => {
        if (!active) return;
        const next = value ?? "";
        setAppConfigDir(next);
        setAppConfigDraft(next);
      })
      .catch((error) => {
        if (!active) return;
        if (isUnsupportedHelperCommand(error)) {
          setAppConfigDirUnsupported(true);
          setAppConfigDir("");
          setAppConfigDraft("");
          return;
        }
        toast.error(
          t("remote.settings.advanced.directory.loadAppConfigFailed", {
            defaultValue: "读取远程 CC Switch 配置目录失败",
          }),
          { description: extractErrorMessage(error) },
        );
      })
      .finally(() => {
        if (active) setIsLoadingAppConfigDir(false);
      });
    return () => {
      active = false;
    };
  }, [supportsAppConfigDir, t, target]);

  const saveAppConfigDir = async (value: string | null) => {
    setIsSavingAppConfigDir(true);
    try {
      const normalized = value?.trim() ? value.trim() : null;
      const result = await settingsApi.setAppConfigDirOverride(
        normalized,
        target,
      );
      if (result !== false) {
        const next = (await settingsApi.getAppConfigDirOverride(target)) ?? "";
        setAppConfigDir(next);
        setAppConfigDraft(next);
        toast.success(
          t("remote.settings.advanced.directory.saved", {
            defaultValue: "远程配置目录已保存",
          }),
          { closeButton: true },
        );
      }
    } catch (error) {
      if (isUnsupportedHelperCommand(error)) {
        setAppConfigDirUnsupported(true);
        return;
      }
      toast.error(
        t("remote.settings.advanced.directory.saveAppConfigFailed", {
          defaultValue: "保存远程 CC Switch 配置目录失败",
        }),
        { description: extractErrorMessage(error) },
      );
    } finally {
      setIsSavingAppConfigDir(false);
    }
  };

  const saveApp = async (app: RemoteDirectoryApp, value: string) => {
    setSavingApp(app);
    try {
      const result = await onSave(buildRemoteDirectoryUpdates(app, value));
      if (result !== false) {
        toast.success(
          t("remote.settings.advanced.directory.saved", {
            defaultValue: "远程配置目录已保存",
          }),
          { closeButton: true },
        );
      }
    } finally {
      setSavingApp(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 rounded-lg border border-border/60 bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="space-y-1">
          <p>
            {t("remote.settings.advanced.directory.description", {
              defaultValue:
                "这里保存的是当前远程主机自己的应用配置目录覆盖，不会读取或修改本机目录。",
            })}
          </p>
        </div>
      </div>

      <section className="space-y-4">
        <header className="space-y-1">
          <h3 className="text-sm font-medium">{t("settings.appConfigDir")}</h3>
          <p className="text-xs text-muted-foreground">
            {t("settings.appConfigDirDescription")}
          </p>
        </header>

        {appConfigDirUnsupported ? (
          <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-200">
            {t("remote.settings.advanced.directory.appConfigUnsupported", {
              defaultValue:
                "当前远程 Helper 不支持 CC Switch 配置目录管理。请更新 Helper 后再使用。",
            })}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Input
              value={appConfigDraft}
              placeholder="~/.cc-switch-remote"
              className="text-xs"
              disabled={isLoadingAppConfigDir || isSavingAppConfigDir}
              onChange={(event) => setAppConfigDraft(event.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={
                isLoadingAppConfigDir ||
                isSavingAppConfigDir ||
                appConfigDraft.trim() === appConfigDir
              }
              title={t("common.save")}
              onClick={() => void saveAppConfigDir(appConfigDraft)}
            >
              {isSavingAppConfigDir ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={
                isLoadingAppConfigDir || isSavingAppConfigDir || !appConfigDir
              }
              title={t("settings.resetDefault")}
              onClick={() => {
                setAppConfigDraft("");
                void saveAppConfigDir(null);
              }}
            >
              <Undo2 className="h-4 w-4" />
            </Button>
          </div>
        )}
      </section>

      <section className="space-y-4">
        <header className="space-y-1">
          <h3 className="text-sm font-medium">
            {t("settings.configDirectoryOverride")}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t("settings.configDirectoryDescription")}
          </p>
        </header>

        <div className="space-y-3">
          {REMOTE_DIRECTORY_FIELDS.map((field) => {
            const value = drafts[field.app];
            const currentValue = getRemoteDirectoryValue(settings, field.app);
            const dirty = value.trim() !== currentValue;
            const rowSaving = savingApp === field.app;
            return (
              <div key={field.app} className="space-y-1.5">
                <p className="text-xs font-medium text-foreground">
                  {t(field.labelKey)}
                </p>
                <div className="flex items-center gap-2">
                  <Input
                    value={value}
                    className="text-xs"
                    placeholder={t(field.placeholderKey, {
                      defaultValue: field.defaultPlaceholder,
                    })}
                    disabled={isSaving || rowSaving}
                    onChange={(event) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [field.app]: event.target.value,
                      }))
                    }
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    disabled={isSaving || rowSaving || !dirty}
                    title={t("common.save")}
                    onClick={() => void saveApp(field.app, value)}
                  >
                    {rowSaving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    disabled={isSaving || rowSaving || !currentValue}
                    title={t("settings.resetDefault")}
                    onClick={() => {
                      setDrafts((prev) => ({ ...prev, [field.app]: "" }));
                      void saveApp(field.app, "");
                    }}
                  >
                    <Undo2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function isUnsupportedHelperCommand(error: unknown): boolean {
  return extractErrorMessage(error).includes("unsupported_command");
}
