import type { ReactNode } from "react";
import { useMemo } from "react";
import {
  AlertCircle,
  ArrowUpCircle,
  CheckCircle2,
  Download,
  Loader2,
  RefreshCw,
  Stethoscope,
  Terminal,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { APP_ICON_MAP } from "@/config/appConfig";
import type { AppId } from "@/lib/api/types";
import { isUpdateAvailable } from "@/lib/version";

export const TOOL_NAMES = [
  "claude",
  "codex",
  "gemini",
  "grok",
  "opencode",
  "openclaw",
  "hermes",
  "pi",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];
export type ToolLifecycleAction = "install" | "update";

export interface ToolVersion {
  name: string;
  version: string | null;
  latest_version: string | null;
  error: string | null;
  installed_but_broken: boolean;
  env_type: "windows" | "wsl" | "macos" | "linux" | "unknown";
  wsl_distro: string | null;
}

export type WslShellPreference = {
  wslShell?: string | null;
  wslShellFlag?: string | null;
};

export const TOOL_DISPLAY_NAMES: Record<ToolName, string> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini CLI",
  grok: "Grok Build",
  opencode: "OpenCode",
  openclaw: "OpenClaw",
  hermes: "Hermes",
  pi: "Pi",
};

const TOOL_APP_IDS: Record<ToolName, AppId> = {
  claude: "claude",
  codex: "codex",
  gemini: "gemini",
  grok: "grokbuild",
  opencode: "opencode",
  openclaw: "openclaw",
  hermes: "hermes",
  pi: "pi",
};

const ENV_BADGE_CONFIG: Record<
  string,
  { labelKey: string; className: string }
> = {
  wsl: {
    labelKey: "settings.envBadge.wsl",
    className:
      "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20",
  },
  windows: {
    labelKey: "settings.envBadge.windows",
    className:
      "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  },
  macos: {
    labelKey: "settings.envBadge.macos",
    className:
      "bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20",
  },
  linux: {
    labelKey: "settings.envBadge.linux",
    className:
      "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20",
  },
};

interface ToolEnvironmentSectionProps {
  title: string;
  description?: string;
  disabled?: boolean;
  disabledMessage?: string;
  toolVersions: ToolVersion[];
  isLoading: boolean;
  loadingTools?: Partial<Record<ToolName, boolean>>;
  toolActions: Partial<Record<ToolName, ToolLifecycleAction>>;
  batchAction: ToolLifecycleAction | null;
  updatableToolNames: readonly ToolName[];
  isAnyBusy: boolean;
  actionPrefix?: ReactNode;
  renderToolControls?: (toolName: ToolName) => ReactNode;
  renderToolDiagnostics?: (toolName: ToolName) => ReactNode;
  onRefresh: () => void | Promise<void>;
  onRunToolAction: (
    toolNames: ToolName[],
    action: ToolLifecycleAction,
  ) => void | Promise<void>;
}

export function ToolEnvironmentSection({
  title,
  description,
  disabled = false,
  disabledMessage,
  toolVersions,
  isLoading,
  loadingTools = {},
  toolActions,
  batchAction,
  updatableToolNames,
  isAnyBusy,
  actionPrefix,
  renderToolControls,
  renderToolDiagnostics,
  onRefresh,
  onRunToolAction,
}: ToolEnvironmentSectionProps) {
  const { t } = useTranslation();
  const toolVersionByName = useMemo(
    () => new Map(toolVersions.map((tool) => [tool.name, tool])),
    [toolVersions],
  );
  const busy = disabled || isAnyBusy;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 px-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">{title}</h3>
          {description ? (
            <p className="mt-1 text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {actionPrefix}
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 text-xs"
            onClick={() => void onRefresh()}
            disabled={disabled || isLoading || isAnyBusy}
          >
            <RefreshCw
              className={isLoading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"}
            />
            {isLoading ? t("common.refreshing") : t("common.refresh")}
          </Button>
          <Button
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={() =>
              void onRunToolAction([...updatableToolNames], "update")
            }
            disabled={
              disabled || isLoading || busy || updatableToolNames.length === 0
            }
          >
            {batchAction === "update" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ArrowUpCircle className="h-3.5 w-3.5" />
            )}
            {t("settings.updateAllTools", {
              count: updatableToolNames.length,
            })}
          </Button>
        </div>
      </div>

      {disabled ? (
        <div className="rounded-xl border border-border bg-gradient-to-br from-card/80 to-card/40 p-4 text-sm text-muted-foreground shadow-sm">
          {disabledMessage}
        </div>
      ) : (
        <div className="grid gap-3 px-1 sm:grid-cols-2 xl:grid-cols-3">
          {TOOL_NAMES.map((toolName) => {
            const tool = toolVersionByName.get(toolName);
            const appConfig = APP_ICON_MAP[TOOL_APP_IDS[toolName]];
            const displayName = TOOL_DISPLAY_NAMES[toolName];
            const isToolVersionLoading =
              isLoading || Boolean(loadingTools[toolName]);
            const isOutdated = isUpdateAvailable(
              tool?.version,
              tool?.latest_version,
            );
            const installedButBroken = Boolean(tool?.installed_but_broken);
            const action: ToolLifecycleAction | null =
              isToolVersionLoading || installedButBroken
                ? null
                : tool?.version
                  ? isOutdated
                    ? "update"
                    : null
                  : "install";
            const runningAction = toolActions[toolName];
            const titleText =
              tool?.version || tool?.error || t("common.unknown");

            return (
              <div
                key={toolName}
                className="flex min-h-[150px] flex-col gap-3 rounded-xl border border-border bg-gradient-to-br from-card/80 to-card/40 p-4 shadow-sm transition-colors hover:border-primary/30"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-background/80 text-muted-foreground">
                      {appConfig?.icon ?? <Terminal className="h-4 w-4" />}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        {displayName}
                      </div>
                      {tool?.env_type && ENV_BADGE_CONFIG[tool.env_type] && (
                        <span
                          className={`mt-1 inline-flex w-fit rounded-full border px-1.5 py-0.5 text-[9px] ${ENV_BADGE_CONFIG[tool.env_type].className}`}
                        >
                          {t(ENV_BADGE_CONFIG[tool.env_type].labelKey)}
                          {tool.wsl_distro ? ` · ${tool.wsl_distro}` : ""}
                        </span>
                      )}
                    </div>
                  </div>
                  {isToolVersionLoading ? (
                    <Loader2 className="mt-1 h-4 w-4 animate-spin text-muted-foreground" />
                  ) : tool?.version ? (
                    isOutdated ? (
                      <span className="mt-1 shrink-0 rounded-full border border-yellow-500/20 bg-yellow-500/10 px-1.5 py-0.5 text-[10px] text-yellow-600 dark:text-yellow-400">
                        {t("settings.updateAvailableShort")}
                      </span>
                    ) : (
                      <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-green-500" />
                    )
                  ) : (
                    <AlertCircle className="mt-1 h-4 w-4 shrink-0 text-yellow-500" />
                  )}
                </div>

                <div className="space-y-1.5 text-xs">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">
                      {t("settings.currentVersion")}
                    </span>
                    <span
                      className="min-w-0 truncate font-mono text-foreground"
                      title={titleText}
                    >
                      {isToolVersionLoading
                        ? t("common.loading")
                        : tool?.version
                          ? tool.version
                          : installedButBroken
                            ? t("settings.installedNotRunnable")
                            : t("common.notInstalled")}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">
                      {t("settings.latestVersion")}
                    </span>
                    <span className="min-w-0 truncate font-mono text-foreground">
                      {isToolVersionLoading
                        ? t("common.loading")
                        : tool?.latest_version || t("common.unknown")}
                    </span>
                  </div>
                  {!isToolVersionLoading && !tool?.version && tool?.error && (
                    <div className="truncate text-[11px] text-muted-foreground">
                      {tool.error}
                    </div>
                  )}
                </div>

                {renderToolControls?.(toolName)}
                {renderToolDiagnostics?.(toolName)}

                <div className="mt-auto flex items-center justify-end">
                  {isToolVersionLoading ? (
                    <span className="text-xs text-muted-foreground">
                      {t("common.loading")}
                    </span>
                  ) : installedButBroken ? (
                    <span className="text-xs text-yellow-600 dark:text-yellow-400">
                      {t("settings.toolCheckEnv")}
                    </span>
                  ) : action ? (
                    <Button
                      size="sm"
                      variant={action === "install" ? "outline" : "default"}
                      className="h-7 gap-1.5 text-xs"
                      onClick={() => void onRunToolAction([toolName], action)}
                      disabled={isToolVersionLoading || busy}
                    >
                      {runningAction ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : action === "install" ? (
                        <Download className="h-3.5 w-3.5" />
                      ) : (
                        <ArrowUpCircle className="h-3.5 w-3.5" />
                      )}
                      {action === "install"
                        ? t("settings.toolInstall")
                        : t("settings.toolUpdate")}
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {t("settings.toolReady")}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ToolDiagnoseButton({
  loading,
  disabled,
  onClick,
}: {
  loading: boolean;
  disabled: boolean;
  onClick: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  return (
    <Button
      size="sm"
      variant="outline"
      className="h-7 gap-1.5 text-xs"
      onClick={() => void onClick()}
      disabled={disabled || loading}
    >
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Stethoscope className="h-3.5 w-3.5" />
      )}
      {loading ? t("settings.toolDiagnosing") : t("settings.toolDiagnose")}
    </Button>
  );
}
