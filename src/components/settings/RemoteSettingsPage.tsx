import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  Copy,
  Download,
  Globe,
  Loader2,
  RefreshCw,
  Server,
  ShieldAlert,
  Zap,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleRow } from "@/components/ui/toggle-row";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { AppVisibilitySettings } from "@/components/settings/AppVisibilitySettings";
import { AuthCenterPanel } from "@/components/settings/AuthCenterPanel";
import { CodexAuthSettings } from "@/components/settings/CodexAuthSettings";
import { ImportExportSection } from "@/components/settings/ImportExportSection";
import { BackupListSection } from "@/components/settings/BackupListSection";
import { SkillStorageLocationSettings } from "@/components/settings/SkillStorageLocationSettings";
import { SkillSyncMethodSettings } from "@/components/settings/SkillSyncMethodSettings";
import { WindowSettings } from "@/components/settings/WindowSettings";
import { AdvancedSettingsAccordion } from "@/components/settings/AdvancedSettingsAccordion";
import { RemoteDirectorySettings } from "@/components/settings/RemoteDirectorySettings";
import { WebdavSyncSection } from "@/components/settings/WebdavSyncSection";
import { LogConfigPanel } from "@/components/settings/LogConfigPanel";
import { ModelTestConfigPanel } from "@/components/usage/ModelTestConfigPanel";
import { UsageDashboard } from "@/components/usage/UsageDashboard";
import { AutoFailoverConfigPanel } from "@/components/proxy/AutoFailoverConfigPanel";
import { FailoverQueueManager } from "@/components/proxy/FailoverQueueManager";
import { ProxyPanel } from "@/components/proxy/ProxyPanel";
import { GlobalProxySettings } from "@/components/settings/GlobalProxySettings";
import { RectifierConfigPanel } from "@/components/settings/RectifierConfigPanel";
import {
  TOOL_DISPLAY_NAMES,
  TOOL_NAMES,
  ToolEnvironmentSection,
  ToolDiagnoseButton,
  type ToolLifecycleAction,
  type ToolName,
} from "@/components/settings/ToolEnvironmentSection";
import { ToolInstallRow } from "@/components/settings/ToolInstallRow";
import { useImportExport } from "@/hooks/useImportExport";
import { useProxyStatus } from "@/hooks/useProxyStatus";
import { useRemoteSettings } from "@/hooks/useRemoteSettings";
import { useAppProxyConfig } from "@/lib/query/proxy";
import { remoteApi } from "@/lib/api";
import type {
  ManagementTarget,
  RemoteHealth,
  RemoteToolVersion,
} from "@/lib/api";
import { isUpdateAvailable } from "@/lib/version";
import {
  formatRemoteCapabilitySummary,
  formatRemoteHelperBuild,
  formatRemoteHelperLatest,
  formatRemoteHelperLatestBuild,
  formatRemoteHelperUpdateError,
  formatRemoteHelperVersion,
  formatRemotePlatform,
} from "@/lib/remoteHealth";
import { extractErrorMessage } from "@/utils/errorUtils";
import type { Settings, SkillStorageLocation } from "@/types";
import type { MigrationResult } from "@/lib/api/skills";
import type { ToolInstallation } from "@/lib/api/settings";
import { POSIX_ONE_CLICK_INSTALL_COMMANDS } from "@/lib/toolInstallCommands";
import {
  shouldConfirmRemoteFailoverToggle,
  shouldConfirmRemoteRoutingStart,
} from "@/components/settings/remoteRoutingGuards";

interface RemoteSettingsPageProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImportSuccess?: () => void | Promise<void>;
  onSettingsSaved?: (settings: Settings) => void;
  defaultTab?: string;
  target: Extract<ManagementTarget, { type: "remote" }>;
}

function coerceRemoteTab(tab: string | undefined): string {
  if (tab === "proxy") return "routing";
  if (tab === "data") return "advanced";
  if (tab === "about") return "environment";
  return tab === "general" ||
    tab === "advanced" ||
    tab === "environment" ||
    tab === "auth" ||
    tab === "routing" ||
    tab === "usage"
    ? tab
    : "environment";
}

export function RemoteSettingsPage({
  open,
  onImportSuccess,
  onSettingsSaved,
  defaultTab = "environment",
  target,
}: RemoteSettingsPageProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState(coerceRemoteTab(defaultTab));

  const [health, setHealth] = useState<RemoteHealth | null>(null);
  const [isCheckingHealth, setIsCheckingHealth] = useState(false);
  const [isInstallingHelper, setIsInstallingHelper] = useState(false);
  const [toolVersions, setToolVersions] = useState<RemoteToolVersion[]>([]);
  const [isLoadingTools, setIsLoadingTools] = useState(false);
  const [toolActions, setToolActions] = useState<
    Partial<Record<ToolName, ToolLifecycleAction>>
  >({});
  const [batchAction, setBatchAction] = useState<ToolLifecycleAction | null>(
    null,
  );
  const [activeRemoteTask, setActiveRemoteTask] = useState<string | null>(null);
  const [toolDiagnostics, setToolDiagnostics] = useState<
    Partial<Record<ToolName, ToolInstallation[]>>
  >({});
  const [isDiagnosingTools, setIsDiagnosingTools] = useState(false);
  const [showInstallCommands, setShowInstallCommands] = useState(false);

  const importExport = useImportExport({ onImportSuccess, target });
  const {
    settings: remoteSettings,
    isLoading: isLoadingRemoteSettings,
    isSaving: isSavingRemoteSettings,
    installedSkillCount: remoteInstalledSkillCount,
    activeTask: remoteSettingsTask,
    loadSettings: loadRemoteSettings,
    clearSettings: clearRemoteSettings,
    saveSettings: saveRemoteSettings,
    migrateSkillStorage: migrateRemoteSkillStorage,
  } = useRemoteSettings({ target, onSettingsSaved });

  const toolsCapability = health?.capabilities.includes("tools") ?? false;
  const settingsCapability = health?.capabilities.includes("settings") ?? false;
  const appConfigDirCapability =
    health?.capabilities.includes("settings-app-config-dir") ?? false;
  const pluginCapability = health?.capabilities.includes("plugin") ?? false;
  const skillsCapability = health?.capabilities.includes("skills") ?? false;
  const importExportCapability =
    health?.capabilities.includes("import-export") ?? false;
  const cloudSyncCapability =
    health?.capabilities.includes("cloud-sync") ?? false;
  const streamCheckCapability =
    health?.capabilities.includes("stream-check") ?? false;
  const usageCapability = health?.capabilities.includes("usage") ?? false;
  const authCapability = health?.capabilities.includes("auth") ?? false;
  const routingCapability =
    health?.capabilities.includes("routing-config") ?? false;
  const routingRuntimeCapability =
    health?.capabilities.includes("routing-runtime") ?? false;
  const helperReady = Boolean(health?.reachable && health.helperInstalled);
  const toolsDisabled = !helperReady || !toolsCapability;
  const toolsDisabledMessage = !helperReady
    ? t("remote.settings.environment.helperRequired", {
        defaultValue: "请先完成健康检查并安装可用的远程 Helper。",
      })
    : t("remote.settings.environment.helperUnsupported", {
        defaultValue:
          "当前远程 Helper 不支持环境检查更新。请安装包含 tools capability 的新版 Helper。",
      });

  const toolVersionByName = useMemo(
    () => new Map(toolVersions.map((tool) => [tool.name, tool])),
    [toolVersions],
  );

  const updatableTools = useMemo(
    () =>
      TOOL_NAMES.filter((name) => {
        const tool = toolVersionByName.get(name);
        return Boolean(
          tool?.version &&
            tool.latest_version &&
            isUpdateAvailable(tool.version, tool.latest_version),
        );
      }),
    [toolVersionByName],
  );

  const loadHealth = useCallback(async () => {
    setIsCheckingHealth(true);
    setActiveRemoteTask(
      t("remote.settings.tasks.checkHealth", {
        defaultValue: "正在通过 SSH 检查远程 Helper 状态...",
      }),
    );
    try {
      const result = await remoteApi.checkHealth(target.profile, target.secret);
      setHealth(result);
      return result;
    } catch (error) {
      console.error("[RemoteSettingsPage] Failed to check health", error);
      setHealth({
        reachable: false,
        helperInstalled: false,
        capabilities: [],
        lastError: extractErrorMessage(error),
      });
      return null;
    } finally {
      setIsCheckingHealth(false);
      setActiveRemoteTask(null);
    }
  }, [t, target.profile, target.secret]);

  const loadToolVersions = useCallback(async () => {
    setIsLoadingTools(true);
    setActiveRemoteTask(
      t("remote.settings.tasks.loadTools", {
        defaultValue: "正在读取远程工具版本和更新信息...",
      }),
    );
    try {
      const result = await remoteApi.getToolVersions(
        target.profile,
        [...TOOL_NAMES],
        target.secret,
      );
      setToolVersions(result);
      return result;
    } catch (error) {
      console.error("[RemoteSettingsPage] Failed to load tools", error);
      toast.error(
        t("remote.settings.environment.loadToolsFailed", {
          defaultValue: "远程环境检查失败",
        }),
        { description: extractErrorMessage(error) },
      );
      return [];
    } finally {
      setIsLoadingTools(false);
      setActiveRemoteTask(null);
    }
  }, [t, target.profile, target.secret]);

  const refreshRemoteState = useCallback(async () => {
    const result = await loadHealth();
    const canLoadSettings =
      result?.reachable &&
      result.helperInstalled &&
      result.capabilities.includes("settings");
    if (canLoadSettings) {
      await loadRemoteSettings(result.capabilities.includes("skills"));
    } else {
      clearRemoteSettings();
    }
  }, [clearRemoteSettings, loadHealth, loadRemoteSettings]);

  useEffect(() => {
    if (!open) return;
    setActiveTab(coerceRemoteTab(defaultTab));
  }, [defaultTab, open]);

  useEffect(() => {
    if (!open) return;
    void refreshRemoteState();
  }, [open, refreshRemoteState]);

  const installHelper = async () => {
    setIsInstallingHelper(true);
    setActiveRemoteTask(
      t("remote.settings.tasks.installHelper", {
        defaultValue: "正在安装远程 Helper：连接 SSH、下载二进制并验证能力...",
      }),
    );
    try {
      const result = await remoteApi.installHelper(
        target.profile,
        target.secret,
      );
      setHealth(result);
      toast.success(
        t("remote.health.installSuccess", {
          defaultValue: "远程 Helper 已安装",
        }),
      );
    } catch (error) {
      console.error("[RemoteSettingsPage] Failed to install helper", error);
      toast.error(
        t("remote.health.installFailed", {
          defaultValue: "安装远程 Helper 失败: {{error}}",
          error: extractErrorMessage(error),
        }),
      );
    } finally {
      setIsInstallingHelper(false);
      setActiveRemoteTask(null);
    }
  };

  const runToolAction = async (
    toolNames: ToolName[],
    action: ToolLifecycleAction,
  ) => {
    if (toolNames.length === 0) return;
    const isBatch = toolNames.length > 1;
    if (isBatch) setBatchAction(action);

    const failures: string[] = [];
    let succeeded = 0;
    for (const toolName of toolNames) {
      setActiveRemoteTask(
        t("remote.settings.tasks.runToolAction", {
          defaultValue: "正在远程{{action}}{{tool}}...",
          action:
            action === "install"
              ? t("settings.toolInstall")
              : t("settings.toolUpdate"),
          tool: TOOL_DISPLAY_NAMES[toolName],
        }),
      );
      setToolActions((prev) => ({ ...prev, [toolName]: action }));
      try {
        await remoteApi.runToolLifecycleAction(
          target.profile,
          [toolName],
          action,
          target.secret,
        );
        succeeded += 1;
        await loadToolVersions();
      } catch (error) {
        console.error(
          `[RemoteSettingsPage] Failed to ${action} ${toolName}`,
          error,
        );
        failures.push(
          `${TOOL_DISPLAY_NAMES[toolName]}: ${extractErrorMessage(error)}`,
        );
      } finally {
        setToolActions((prev) => {
          const next = { ...prev };
          delete next[toolName];
          return next;
        });
      }
    }

    if (isBatch) setBatchAction(null);
    setActiveRemoteTask(null);
    const actionLabel =
      action === "install"
        ? t("settings.toolInstall")
        : t("settings.toolUpdate");
    if (failures.length === 0) {
      toast.success(
        t("settings.toolActionDone", {
          count: succeeded,
          action: actionLabel,
        }),
      );
    } else if (succeeded === 0) {
      toast.error(t("settings.toolActionFailed"), {
        description: failures.join("\n"),
      });
    } else {
      toast.warning(
        t("settings.toolActionPartial", {
          succeeded,
          failed: failures.length,
        }),
        { description: failures.join("\n") },
      );
    }
  };

  const diagnoseToolInstallations = async () => {
    if (toolsDisabled || isDiagnosingTools) return;
    setIsDiagnosingTools(true);
    setActiveRemoteTask(
      t("remote.settings.tasks.diagnoseTools", {
        defaultValue: "正在诊断远程工具安装冲突...",
      }),
    );
    try {
      const reports = await remoteApi.probeToolInstallations(
        target.profile,
        [...TOOL_NAMES],
        target.secret,
      );
      const next: Partial<Record<ToolName, ToolInstallation[]>> = {};
      let conflicts = 0;
      for (const report of reports) {
        if (report.is_conflict) {
          next[report.tool as ToolName] = report.installs;
          conflicts += 1;
        }
      }
      setToolDiagnostics(next);
      if (conflicts === 0) {
        toast.info(
          t("settings.toolNoConflicts", {
            defaultValue: "未发现安装冲突",
          }),
        );
      }
    } catch (error) {
      console.error("[RemoteSettingsPage] Failed to diagnose tools", error);
      toast.error(
        t("settings.toolDiagnoseFailed", {
          defaultValue: "诊断安装冲突失败",
        }),
        { description: extractErrorMessage(error) },
      );
    } finally {
      setIsDiagnosingTools(false);
      setActiveRemoteTask(null);
    }
  };

  const copyRemoteInstallCommands = async () => {
    try {
      await navigator.clipboard.writeText(POSIX_ONE_CLICK_INSTALL_COMMANDS);
      toast.success(t("settings.installCommandsCopied"), {
        closeButton: true,
      });
    } catch (error) {
      console.error(
        "[RemoteSettingsPage] Failed to copy install commands",
        error,
      );
      toast.error(t("settings.installCommandsCopyFailed"));
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden px-6">
      <span data-testid="settings-target" className="sr-only">
        remote
      </span>
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex flex-col h-full"
      >
        <TabsList className="grid w-full grid-cols-6 mb-6 glass rounded-lg">
          <TabsTrigger value="environment">
            {t("remote.settings.tabs.remote", { defaultValue: "远程" })}
          </TabsTrigger>
          <TabsTrigger value="general">
            {t("settings.tabGeneral", { defaultValue: "通用" })}
          </TabsTrigger>
          <TabsTrigger value="routing">
            {t("settings.tabProxy", { defaultValue: "代理" })}
          </TabsTrigger>
          <TabsTrigger value="auth">
            {t("settings.tabAuth", { defaultValue: "认证" })}
          </TabsTrigger>
          <TabsTrigger value="advanced">
            {t("settings.tabAdvanced", { defaultValue: "高级" })}
          </TabsTrigger>
          <TabsTrigger value="usage">{t("usage.title")}</TabsTrigger>
        </TabsList>

        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden pr-2">
          <TabsContent value="environment" className="space-y-4 mt-0 pb-4">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="space-y-4"
            >
              <RemoteHealthSection
                health={health}
                isChecking={isCheckingHealth}
                isInstalling={isInstallingHelper}
                onRefresh={() => {
                  void loadHealth();
                }}
                onInstallHelper={installHelper}
                profileName={target.profile.name || target.profile.host}
              />
              <RemoteTaskBanner
                message={activeRemoteTask ?? remoteSettingsTask}
              />
              <ToolEnvironmentSection
                title={t("remote.settings.environment.toolsTitle", {
                  defaultValue: "远程环境检查更新",
                })}
                description={t("remote.settings.environment.toolsDescription", {
                  defaultValue:
                    "检查远程服务器上的 Claude Code、Codex、Gemini、OpenCode、OpenClaw 和 Hermes",
                })}
                disabled={toolsDisabled}
                disabledMessage={toolsDisabledMessage}
                toolVersions={toolVersions}
                isLoading={isLoadingTools}
                toolActions={toolActions}
                batchAction={batchAction}
                updatableToolNames={updatableTools}
                isAnyBusy={
                  Boolean(batchAction) || Object.keys(toolActions).length > 0
                }
                actionPrefix={
                  <ToolDiagnoseButton
                    loading={isDiagnosingTools}
                    disabled={toolsDisabled || isLoadingTools}
                    onClick={diagnoseToolInstallations}
                  />
                }
                onRefresh={() => {
                  void loadToolVersions();
                }}
                onRunToolAction={runToolAction}
                renderToolDiagnostics={(toolName) => {
                  const conflicts = toolDiagnostics[toolName];
                  if (!conflicts || conflicts.length === 0) return null;
                  return (
                    <div className="space-y-1.5 rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-2.5">
                      <div className="text-[11px] font-medium text-yellow-600 dark:text-yellow-400">
                        {t("settings.toolConflictTitle")}
                      </div>
                      <p className="text-[10px] leading-snug text-muted-foreground">
                        {t("settings.toolConflictHint")}
                      </p>
                      <ul className="space-y-1.5">
                        {conflicts.map((inst) => (
                          <li key={inst.path}>
                            <ToolInstallRow inst={inst} />
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                }}
              />
              <div className="space-y-3 px-1">
                <button
                  type="button"
                  onClick={() => setShowInstallCommands((value) => !value)}
                  aria-expanded={showInstallCommands}
                  className="flex w-full items-center gap-1.5 text-sm font-medium text-foreground transition-colors hover:text-primary"
                >
                  <ChevronDown
                    className={`h-3.5 w-3.5 transition-transform ${
                      showInstallCommands ? "" : "-rotate-90"
                    }`}
                  />
                  {t("settings.manualInstallCommands")}
                </button>
                {showInstallCommands ? (
                  <div className="rounded-xl border border-border bg-gradient-to-br from-card/80 to-card/40 p-4 space-y-3 shadow-sm">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs text-muted-foreground">
                        {t("settings.oneClickInstallHint")}
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={copyRemoteInstallCommands}
                        className="h-7 gap-1.5 text-xs"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        {t("common.copy")}
                      </Button>
                    </div>
                    <pre className="text-xs font-mono bg-background/80 px-3 py-2.5 rounded-lg border border-border/60 overflow-x-auto">
                      {POSIX_ONE_CLICK_INSTALL_COMMANDS}
                    </pre>
                  </div>
                ) : null}
              </div>
            </motion.div>
          </TabsContent>

          <TabsContent value="general" className="space-y-4 mt-0 pb-4">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="space-y-6"
            >
              <RemoteGeneralSettingsSection
                helperReady={helperReady}
                settingsCapability={settingsCapability}
                pluginCapability={pluginCapability}
                skillsCapability={skillsCapability}
                settings={remoteSettings}
                installedSkillCount={remoteInstalledSkillCount}
                isLoading={isLoadingRemoteSettings}
                isSaving={isSavingRemoteSettings}
                onSave={(updates) => {
                  void saveRemoteSettings(updates);
                }}
                onMigrateSkillStorage={migrateRemoteSkillStorage}
              />
            </motion.div>
          </TabsContent>

          <TabsContent value="routing" className="space-y-4 mt-0 pb-4">
            <RemoteRoutingSettingsSection
              helperReady={helperReady}
              routingCapability={routingCapability}
              routingRuntimeCapability={routingRuntimeCapability}
              settings={remoteSettings}
              isSavingSettings={isSavingRemoteSettings}
              onSaveSettings={saveRemoteSettings}
              target={target}
            />
          </TabsContent>

          <TabsContent value="auth" className="space-y-4 mt-0 pb-4">
            {!helperReady || !authCapability ? (
              <div className="rounded-xl border border-border bg-card/50 px-4 py-3 text-sm text-muted-foreground">
                {!helperReady
                  ? t("remote.settings.environment.helperRequired", {
                      defaultValue: "请先完成健康检查并安装可用的远程 Helper。",
                    })
                  : t("remote.settings.auth.unsupported", {
                      defaultValue:
                        "当前远程 Helper 不支持认证管理。请更新到包含 auth capability 的新版 Helper。",
                    })}
              </div>
            ) : (
              <AuthCenterPanel target={target} />
            )}
          </TabsContent>

          <TabsContent value="usage" className="mt-0 pb-4">
            {!helperReady || !usageCapability ? (
              <div className="rounded-xl border border-border bg-card/50 px-4 py-3 text-sm text-muted-foreground">
                {!helperReady
                  ? t("remote.settings.environment.helperRequired", {
                      defaultValue: "请先完成健康检查并安装可用的远程 Helper。",
                    })
                  : t("remote.settings.usage.unsupported", {
                      defaultValue:
                        "当前远程 Helper 不支持使用统计。请更新到包含 usage capability 的新版 Helper。",
                    })}
              </div>
            ) : (
              <UsageDashboard target={target} />
            )}
          </TabsContent>

          <TabsContent value="advanced" className="space-y-4 mt-0 pb-4">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="space-y-4"
            >
              <AdvancedSettingsAccordion
                targetMode="remote"
                defaultValue={["data"]}
                descriptions={{
                  data: t("remote.settings.data.description", {
                    defaultValue:
                      "导入或导出当前远程服务器自己的 CC Switch 数据",
                  }),
                }}
                childrenBySection={{
                  directory:
                    !helperReady || !settingsCapability ? (
                      <div className="rounded-xl border border-border bg-card/50 px-4 py-3 text-sm text-muted-foreground">
                        {!helperReady
                          ? t("remote.settings.environment.helperRequired", {
                              defaultValue:
                                "请先完成健康检查并安装可用的远程 Helper。",
                            })
                          : t("remote.settings.general.unsupported", {
                              defaultValue:
                                "当前远程 Helper 不支持通用设置管理。请更新到包含 settings capability 的新版 Helper。",
                            })}
                      </div>
                    ) : isLoadingRemoteSettings || !remoteSettings ? (
                      <div className="flex items-center gap-2 rounded-xl border border-border bg-card/50 px-4 py-3 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {t("remote.settings.general.loading", {
                          defaultValue: "正在加载远程设置...",
                        })}
                      </div>
                    ) : (
                      <RemoteDirectorySettings
                        target={target}
                        supportsAppConfigDir={appConfigDirCapability}
                        settings={remoteSettings}
                        isSaving={isSavingRemoteSettings}
                        onSave={saveRemoteSettings}
                      />
                    ),
                  data:
                    !helperReady || !importExportCapability ? (
                      <div className="rounded-xl border border-border bg-card/50 px-4 py-3 text-sm text-muted-foreground">
                        {!helperReady
                          ? t("remote.settings.environment.helperRequired", {
                              defaultValue:
                                "请先完成健康检查并安装可用的远程 Helper。",
                            })
                          : t(
                              "remote.settings.advanced.unsupported.importExport",
                              {
                                defaultValue:
                                  "当前远程 Helper 不支持导入导出。请更新到包含 import-export capability 的新版 Helper。",
                              },
                            )}
                      </div>
                    ) : (
                      <ImportExportSection
                        status={importExport.status}
                        selectedFile={importExport.selectedFile}
                        errorMessage={importExport.errorMessage}
                        backupId={importExport.backupId}
                        isImporting={importExport.isImporting}
                        restorePreflightReport={
                          importExport.restorePreflightReport
                        }
                        isRestorePreflightOpen={
                          importExport.isRestorePreflightOpen
                        }
                        onSelectFile={importExport.selectImportFile}
                        onImport={importExport.importConfig}
                        onImportWithRestoreMode={
                          importExport.importWithRestoreMode
                        }
                        onCancelRestorePreflight={
                          importExport.cancelRestorePreflight
                        }
                        onExport={importExport.exportConfig}
                        onClear={importExport.clearSelection}
                      />
                    ),
                  backup:
                    !helperReady ||
                    !importExportCapability ||
                    !settingsCapability ? (
                      <div className="rounded-xl border border-border bg-card/50 px-4 py-3 text-sm text-muted-foreground">
                        {!helperReady
                          ? t("remote.settings.environment.helperRequired", {
                              defaultValue:
                                "请先完成健康检查并安装可用的远程 Helper。",
                            })
                          : !importExportCapability
                            ? t("remote.settings.advanced.unsupported.backup", {
                                defaultValue:
                                  "当前远程 Helper 不支持备份与恢复。请更新到包含 import-export capability 的新版 Helper。",
                              })
                            : t("remote.settings.general.unsupported", {
                                defaultValue:
                                  "当前远程 Helper 不支持通用设置管理。请更新到包含 settings capability 的新版 Helper。",
                              })}
                      </div>
                    ) : isLoadingRemoteSettings || !remoteSettings ? (
                      <div className="flex items-center gap-2 rounded-xl border border-border bg-card/50 px-4 py-3 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {t("remote.settings.general.loading", {
                          defaultValue: "正在加载远程设置...",
                        })}
                      </div>
                    ) : (
                      <BackupListSection
                        target={target}
                        backupIntervalHours={remoteSettings.backupIntervalHours}
                        backupRetainCount={remoteSettings.backupRetainCount}
                        onSettingsChange={(updates) => {
                          void saveRemoteSettings(updates);
                        }}
                      />
                    ),
                  cloudSync:
                    !helperReady ||
                    !settingsCapability ||
                    !cloudSyncCapability ? (
                      <div className="rounded-xl border border-border bg-card/50 px-4 py-3 text-sm text-muted-foreground">
                        {!helperReady
                          ? t("remote.settings.environment.helperRequired", {
                              defaultValue:
                                "请先完成健康检查并安装可用的远程 Helper。",
                            })
                          : !settingsCapability
                            ? t("remote.settings.general.unsupported", {
                                defaultValue:
                                  "当前远程 Helper 不支持通用设置管理。请更新到包含 settings capability 的新版 Helper。",
                              })
                            : t(
                                "remote.settings.advanced.unsupported.cloudSync",
                                {
                                  defaultValue:
                                    "当前远程 Helper 不支持云同步。请更新到包含 cloud-sync capability 的新版 Helper。",
                                },
                              )}
                      </div>
                    ) : isLoadingRemoteSettings || !remoteSettings ? (
                      <div className="flex items-center gap-2 rounded-xl border border-border bg-card/50 px-4 py-3 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {t("remote.settings.general.loading", {
                          defaultValue: "正在加载远程设置...",
                        })}
                      </div>
                    ) : (
                      <WebdavSyncSection
                        target={target}
                        config={remoteSettings.webdavSync}
                        s3Config={remoteSettings.s3Sync}
                        settings={remoteSettings}
                        onAutoSave={async (updates) => {
                          await saveRemoteSettings(updates);
                        }}
                      />
                    ),
                  test:
                    !helperReady || !streamCheckCapability ? (
                      <div className="rounded-xl border border-border bg-card/50 px-4 py-3 text-sm text-muted-foreground">
                        {!helperReady
                          ? t("remote.settings.environment.helperRequired", {
                              defaultValue:
                                "请先完成健康检查并安装可用的远程 Helper。",
                            })
                          : t("remote.settings.advanced.unsupported.test", {
                              defaultValue:
                                "当前远程 Helper 不支持模型测试配置。请更新到包含 stream-check capability 的新版 Helper。",
                            })}
                      </div>
                    ) : (
                      <ModelTestConfigPanel target={target} />
                    ),
                  logConfig:
                    !helperReady || !settingsCapability ? (
                      <div className="rounded-xl border border-border bg-card/50 px-4 py-3 text-sm text-muted-foreground">
                        {!helperReady
                          ? t("remote.settings.environment.helperRequired", {
                              defaultValue:
                                "请先完成健康检查并安装可用的远程 Helper。",
                            })
                          : t(
                              "remote.settings.advanced.unsupported.logConfig",
                              {
                                defaultValue:
                                  "当前远程 Helper 不支持日志配置。请更新到包含 settings capability 的新版 Helper。",
                              },
                            )}
                      </div>
                    ) : (
                      <LogConfigPanel target={target} />
                    ),
                }}
              />
            </motion.div>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

interface RemoteRoutingRuntimePanelProps {
  target: Extract<ManagementTarget, { type: "remote" }>;
  enabled: boolean;
  settings: Settings | null;
  isSavingSettings: boolean;
  onSaveSettings: (
    updates: Partial<Settings>,
  ) => boolean | void | Promise<boolean | void>;
}

function RemoteRoutingRuntimePanel({
  target,
  enabled,
  settings,
  isSavingSettings,
  onSaveSettings,
}: RemoteRoutingRuntimePanelProps) {
  const { t } = useTranslation();
  const [showProxyConfirm, setShowProxyConfirm] = useState(false);
  const { startProxyServer, stopWithRestore, isStarting, isStopping } =
    useProxyStatus(target);

  const handleToggleProxy = async (checked: boolean) => {
    if (!enabled || isStarting || isStopping) return;
    try {
      if (checked) {
        if (settings && shouldConfirmRemoteRoutingStart(settings)) {
          setShowProxyConfirm(true);
          return;
        }
        await startProxyServer();
      } else {
        await stopWithRestore();
      }
    } catch (error) {
      console.error(
        "[RemoteRoutingRuntimePanel] Failed to toggle remote runtime",
        error,
      );
      toast.error(
        checked
          ? t("remote.settings.routing.runtimeStartFailed", {
              defaultValue: "远程路由启动失败",
            })
          : t("remote.settings.routing.runtimeStopFailed", {
              defaultValue: "远程路由停止失败",
            }),
        { description: extractErrorMessage(error) },
      );
    }
  };

  const handleProxyConfirm = async () => {
    setShowProxyConfirm(false);
    try {
      await onSaveSettings({ proxyConfirmed: true });
      await startProxyServer();
    } catch (error) {
      console.error(
        "[RemoteRoutingRuntimePanel] Failed to confirm remote routing",
        error,
      );
      toast.error(
        t("remote.settings.routing.runtimeStartFailed", {
          defaultValue: "远程路由启动失败",
        }),
        { description: extractErrorMessage(error) },
      );
    }
  };

  if (!enabled) {
    return (
      <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-4 py-3 text-sm text-yellow-700 dark:text-yellow-300">
        {t("remote.settings.routing.runtimeUnsupported", {
          defaultValue:
            "当前远程 Helper 仅支持远程路由配置读写；启动、停止和运行状态需要包含 routing-runtime capability 的新版 Helper。",
        })}
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4">
        {settings ? (
          <ToggleRow
            icon={<Server className="h-4 w-4 text-green-500" />}
            title={t("remote.settings.routing.showRemoteRoutingToggle", {
              defaultValue: "在主页面显示远程路由开关",
            })}
            description={t(
              "remote.settings.routing.showRemoteRoutingToggleDescription",
              {
                defaultValue:
                  "开启后，主页面顶部显示当前应用的远程路由开关；开启应用路由时远程路由服务会自动启动。",
              },
            )}
            checked={!!settings.enableRemoteRoutingToggle}
            disabled={isSavingSettings}
            onCheckedChange={(value) =>
              onSaveSettings({ enableRemoteRoutingToggle: value })
            }
          />
        ) : null}
        <ProxyPanel
          target={target}
          enableLocalProxy={false}
          onEnableLocalProxyChange={() => undefined}
          onToggleProxy={handleToggleProxy}
          isProxyPending={isStarting || isStopping}
        />
      </div>
      <ConfirmDialog
        isOpen={showProxyConfirm}
        variant="info"
        title={t("confirm.proxy.title")}
        message={t("confirm.proxy.message")}
        confirmText={t("confirm.proxy.confirm")}
        onConfirm={() => void handleProxyConfirm()}
        onCancel={() => setShowProxyConfirm(false)}
      />
    </>
  );
}

interface RemoteRoutingSettingsSectionProps {
  helperReady: boolean;
  routingCapability: boolean;
  routingRuntimeCapability: boolean;
  settings: Settings | null;
  isSavingSettings: boolean;
  onSaveSettings: (
    updates: Partial<Settings>,
  ) => boolean | void | Promise<boolean | void>;
  target: Extract<ManagementTarget, { type: "remote" }>;
}

function RemoteRoutingSettingsSection({
  helperReady,
  routingCapability,
  routingRuntimeCapability,
  settings,
  isSavingSettings,
  onSaveSettings,
  target,
}: RemoteRoutingSettingsSectionProps) {
  const { t } = useTranslation();
  const [showFailoverConfirm, setShowFailoverConfirm] = useState(false);
  const { isRunning } = useProxyStatus(target);
  const { data: claudeAppConfig } = useAppProxyConfig("claude", target);
  const { data: codexAppConfig } = useAppProxyConfig("codex", target);
  const { data: geminiAppConfig } = useAppProxyConfig("gemini", target);
  const appConfigs = {
    claude: claudeAppConfig,
    codex: codexAppConfig,
    gemini: geminiAppConfig,
  };
  const disabledMessage = !helperReady
    ? t("remote.settings.environment.helperRequired", {
        defaultValue: "请先完成健康检查并安装可用的远程 Helper。",
      })
    : t("remote.settings.routing.unsupported", {
        defaultValue:
          "当前远程 Helper 不支持路由配置。请安装包含 routing-config capability 的新版 Helper。",
      });

  if (!helperReady || !routingCapability) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/20 p-6 text-sm text-muted-foreground">
        {disabledMessage}
      </div>
    );
  }

  const handleRemoteFailoverToggleChange = (checked: boolean) => {
    if (shouldConfirmRemoteFailoverToggle(settings, checked)) {
      setShowFailoverConfirm(true);
      return;
    }
    void onSaveSettings({ enableRemoteFailoverToggle: checked });
  };

  const handleFailoverConfirm = async () => {
    setShowFailoverConfirm(false);
    await onSaveSettings({
      failoverConfirmed: true,
      enableRemoteFailoverToggle: true,
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-4"
    >
      <Accordion type="multiple" defaultValue={[]} className="w-full space-y-4">
        <AccordionItem
          value="proxy"
          className="rounded-xl glass-card overflow-hidden"
        >
          <AccordionTrigger className="px-6 py-4 hover:no-underline hover:bg-muted/50 data-[state=open]:bg-muted/50">
            <div className="flex items-center gap-3">
              <Server className="h-5 w-5 text-green-500" />
              <div className="text-left">
                <h3 className="text-base font-semibold">
                  {t("settings.advanced.proxy.title")}
                </h3>
                <p className="text-sm text-muted-foreground font-normal">
                  {t("settings.advanced.proxy.description")}
                </p>
              </div>
              <Badge
                variant={isRunning ? "default" : "secondary"}
                className="gap-1.5 h-6 ml-auto mr-2"
              >
                <Activity
                  className={`h-3 w-3 ${isRunning ? "animate-pulse" : ""}`}
                />
                {isRunning
                  ? t("settings.advanced.proxy.running")
                  : t("settings.advanced.proxy.stopped")}
              </Badge>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-6 pb-6 pt-4 border-t border-border/50">
            <RemoteRoutingRuntimePanel
              target={target}
              enabled={routingRuntimeCapability}
              settings={settings}
              isSavingSettings={isSavingSettings}
              onSaveSettings={onSaveSettings}
            />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem
          value="failover"
          className="rounded-xl glass-card overflow-hidden"
        >
          <AccordionTrigger className="px-6 py-4 hover:no-underline hover:bg-muted/50 data-[state=open]:bg-muted/50">
            <div className="flex items-center gap-3">
              <Activity className="h-5 w-5 text-orange-500" />
              <div className="text-left">
                <h3 className="text-base font-semibold">
                  {t("settings.advanced.failover.title")}
                </h3>
                <p className="text-sm text-muted-foreground font-normal">
                  {t("settings.advanced.failover.description")}
                </p>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-6 pb-6 pt-4 border-t border-border/50">
            <div className="space-y-5">
              {settings ? (
                <ToggleRow
                  icon={<ShieldAlert className="h-4 w-4 text-orange-500" />}
                  title={t("remote.settings.routing.showRemoteFailoverToggle", {
                    defaultValue: "在主页面显示远程故障转移开关",
                  })}
                  description={t(
                    "remote.settings.routing.showRemoteFailoverToggleDescription",
                    {
                      defaultValue:
                        "开启后，主页面顶部显示当前应用的远程故障转移开关；需要当前应用已启用远程路由。",
                    },
                  )}
                  checked={!!settings.enableRemoteFailoverToggle}
                  disabled={isSavingSettings}
                  onCheckedChange={handleRemoteFailoverToggleChange}
                />
              ) : null}
              <div className="flex items-start gap-3 rounded-lg border border-border/60 bg-muted/20 p-3 text-sm text-muted-foreground">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" />
                <span>
                  {t("remote.settings.routing.failoverRemoteHint", {
                    defaultValue:
                      "这里管理的是远程主机的故障转移队列和自动故障转移参数，不会修改本机路由配置。",
                  })}
                </span>
              </div>
              <Tabs defaultValue="claude" className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="claude">Claude</TabsTrigger>
                  <TabsTrigger value="codex">Codex</TabsTrigger>
                  <TabsTrigger value="gemini">Gemini</TabsTrigger>
                </TabsList>
                {(["claude", "codex", "gemini"] as const).map((appType) => {
                  const failoverDisabled =
                    !routingRuntimeCapability ||
                    !isRunning ||
                    !(appConfigs[appType]?.enabled ?? false);
                  return (
                    <TabsContent key={appType} value={appType} className="mt-4">
                      <div className="space-y-4">
                        {failoverDisabled ? (
                          <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-4 py-3 text-sm text-yellow-700 dark:text-yellow-300">
                            {t("remote.settings.routing.failoverRequired", {
                              app: appType,
                              defaultValue:
                                "需要先启动远程路由，并启用当前应用的远程路由后才能配置故障转移。",
                            })}
                          </div>
                        ) : null}
                        <FailoverQueueManager
                          appType={appType}
                          target={target}
                          autoSwitchDisabled={failoverDisabled}
                        />
                        <AutoFailoverConfigPanel
                          appType={appType}
                          target={target}
                          disabled={failoverDisabled}
                        />
                      </div>
                    </TabsContent>
                  );
                })}
              </Tabs>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem
          value="rectifier"
          className="rounded-xl glass-card overflow-hidden"
        >
          <AccordionTrigger className="px-6 py-4 hover:no-underline hover:bg-muted/50 data-[state=open]:bg-muted/50">
            <div className="flex items-center gap-3">
              <Zap className="h-5 w-5 text-purple-500" />
              <div className="text-left">
                <h3 className="text-base font-semibold">
                  {t("settings.advanced.rectifier.title")}
                </h3>
                <p className="text-sm text-muted-foreground font-normal">
                  {t("settings.advanced.rectifier.description")}
                </p>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-6 pb-6 pt-4 border-t border-border/50">
            <RectifierConfigPanel target={target} />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem
          value="globalProxy"
          className="rounded-xl glass-card overflow-hidden"
        >
          <AccordionTrigger className="px-6 py-4 hover:no-underline hover:bg-muted/50 data-[state=open]:bg-muted/50">
            <div className="flex items-center gap-3">
              <Globe className="h-5 w-5 text-cyan-500" />
              <div className="text-left">
                <h3 className="text-base font-semibold">
                  {t("settings.advanced.globalProxy.title")}
                </h3>
                <p className="text-sm text-muted-foreground font-normal">
                  {t("settings.advanced.globalProxy.description")}
                </p>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-6 pb-6 pt-4 border-t border-border/50">
            <GlobalProxySettings target={target} />
          </AccordionContent>
        </AccordionItem>
      </Accordion>
      <ConfirmDialog
        isOpen={showFailoverConfirm}
        variant="info"
        title={t("confirm.failover.title")}
        message={t("confirm.failover.message")}
        confirmText={t("confirm.failover.confirm")}
        onConfirm={() => void handleFailoverConfirm()}
        onCancel={() => setShowFailoverConfirm(false)}
      />
    </motion.div>
  );
}

interface RemoteHealthSectionProps {
  health: RemoteHealth | null;
  isChecking: boolean;
  isInstalling: boolean;
  profileName: string;
  onRefresh: () => void | Promise<void>;
  onInstallHelper: () => void | Promise<void>;
}

interface RemoteGeneralSettingsSectionProps {
  helperReady: boolean;
  settingsCapability: boolean;
  pluginCapability: boolean;
  skillsCapability: boolean;
  settings: Settings | null;
  installedSkillCount: number;
  isLoading: boolean;
  isSaving: boolean;
  onSave: (updates: Partial<Settings>) => void | Promise<void>;
  onMigrateSkillStorage: (
    target: SkillStorageLocation,
  ) => Promise<MigrationResult>;
}

function RemoteGeneralSettingsSection({
  helperReady,
  settingsCapability,
  pluginCapability,
  skillsCapability,
  settings,
  installedSkillCount,
  isLoading,
  isSaving,
  onSave,
  onMigrateSkillStorage,
}: RemoteGeneralSettingsSectionProps) {
  const { t } = useTranslation();
  const unavailableMessage = !helperReady
    ? t("remote.settings.environment.helperRequired", {
        defaultValue: "请先完成健康检查并安装可用的远程 Helper。",
      })
    : t("remote.settings.general.unsupported", {
        defaultValue:
          "当前远程 Helper 不支持通用设置管理。请更新到包含 settings capability 的新版 Helper。",
      });

  if (!helperReady || !settingsCapability) {
    return (
      <div className="rounded-xl border border-border bg-card/50 px-4 py-3 text-sm text-muted-foreground">
        {unavailableMessage}
      </div>
    );
  }

  if (isLoading || !settings) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-card/50 px-4 py-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("remote.settings.general.loading", {
          defaultValue: "正在加载远程设置...",
        })}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AppVisibilitySettings
        settings={settings}
        onChange={(updates) => void onSave(updates)}
      />

      <SkillStorageLocationSettings
        value={settings.skillStorageLocation ?? "cc_switch"}
        installedCount={installedSkillCount}
        onMigrated={(location) =>
          void onSave({ skillStorageLocation: location })
        }
        onMigrate={
          skillsCapability
            ? onMigrateSkillStorage
            : async () => {
                throw new Error(
                  t("remote.settings.general.skillsUnsupported", {
                    defaultValue:
                      "当前远程 Helper 不支持 Skills 存储位置迁移。",
                  }),
                );
              }
        }
      />

      <SkillSyncMethodSettings
        value={settings.skillSyncMethod ?? "auto"}
        onChange={(method) => void onSave({ skillSyncMethod: method })}
      />

      <CodexAuthSettings
        settings={settings}
        onChange={(updates) => void onSave(updates)}
      />

      <WindowSettings
        settings={settings}
        mode="remote"
        disabled={!pluginCapability || isSaving}
        onChange={(updates) => void onSave(updates)}
      />
    </div>
  );
}

function RemoteHealthSection({
  health,
  isChecking,
  isInstalling,
  profileName,
  onRefresh,
  onInstallHelper,
}: RemoteHealthSectionProps) {
  const { t } = useTranslation();
  const helperReady = Boolean(health?.reachable && health.helperInstalled);
  const capabilitySummary = formatRemoteCapabilitySummary(health, t);
  const helperBuildText = formatRemoteHelperBuild(health);
  const helperLatestBuildText = formatRemoteHelperLatestBuild(health);
  const helperActionLabel = health?.helperUpdateAvailable
    ? t("remote.health.updateHelper", { defaultValue: "更新 Helper" })
    : health?.helperInstalled
      ? t("remote.health.reinstallHelper", {
          defaultValue: "重新安装 Helper",
        })
      : t("remote.health.installHelper", {
          defaultValue: "安装 Helper",
        });
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 px-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <Server className="h-5 w-5 text-primary shrink-0" />
          <div className="min-w-0">
            <h3 className="text-base font-semibold truncate">
              {t("remote.settings.environment.host", {
                defaultValue: "远程主机",
              })}
            </h3>
            <p className="text-sm text-muted-foreground truncate">
              {profileName}
            </p>
          </div>
          <Badge variant={helperReady ? "default" : "destructive"}>
            {helperReady
              ? t("remote.status.connected", { defaultValue: "已连接" })
              : t("remote.status.unavailable", { defaultValue: "不可用" })}
          </Badge>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void onRefresh()}
            disabled={isChecking || isInstalling}
          >
            {isChecking ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            {t("common.refresh")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void onInstallHelper()}
            disabled={isInstalling || isChecking}
          >
            {isInstalling ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            {helperActionLabel}
          </Button>
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-gradient-to-br from-card/80 to-card/40 shadow-sm">
        <div className="grid gap-px bg-border/50 sm:grid-cols-2 lg:grid-cols-4">
          <InfoCell
            label={t("remote.health.helperVersion", {
              defaultValue: "Helper 版本",
            })}
            value={formatRemoteHelperVersion(health)}
            description={
              helperBuildText
                ? t("remote.health.helperBuild", {
                    defaultValue: "构建: {{build}}",
                    build: helperBuildText,
                  })
                : undefined
            }
          />
          <InfoCell
            label={t("remote.health.helperLatestVersion", {
              defaultValue: "最新 Helper",
            })}
            value={formatRemoteHelperLatest(health)}
            description={
              helperLatestBuildText
                ? t("remote.health.helperLatestBuild", {
                    defaultValue: "最新构建: {{build}}",
                    build: helperLatestBuildText,
                  })
                : undefined
            }
          />
          <InfoCell
            label={t("remote.health.platform", { defaultValue: "系统" })}
            value={formatRemotePlatform(health)}
          />
          <InfoCell
            label={t("remote.health.capabilities", {
              defaultValue: "远程功能支持",
            })}
            value={capabilitySummary}
          />
        </div>
        {health?.helperUpdateAvailable ? (
          <div className="border-t border-border/50 px-4 py-3">
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div className="min-w-0">
                <div className="font-medium">
                  {t("remote.health.helperUpdateAvailable", {
                    defaultValue: "发现新版 Helper",
                  })}
                </div>
                <div className="mt-0.5 break-all">
                  {t("remote.health.helperUpdateDescription", {
                    defaultValue:
                      "远程 Helper 有新版可安装。建议更新后再使用远程管理功能。",
                  })}
                </div>
              </div>
            </div>
          </div>
        ) : null}
        {health?.helperUpdateError ? (
          <div className="border-t border-border/50 px-4 py-3 text-xs text-muted-foreground">
            {formatRemoteHelperUpdateError(health.helperUpdateError, t)}
          </div>
        ) : null}
        {health?.lastError ? (
          <div className="border-t border-border/50 px-4 py-3 text-sm text-destructive">
            {health.lastError}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function InfoCell({
  label,
  value,
  description,
}: {
  label: string;
  value: string;
  description?: string;
}) {
  return (
    <div className="bg-background/70 px-4 py-3 min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm font-medium">
        <span>{value}</span>
        {description ? (
          <span className="ml-1 text-xs font-normal text-muted-foreground">
            · {description}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function RemoteTaskBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/10 px-4 py-3 text-sm text-primary">
      <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
      <span className="min-w-0 truncate">{message}</span>
    </div>
  );
}
