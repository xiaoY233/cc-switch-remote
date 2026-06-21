import { invoke } from "@tauri-apps/api/core";
import type {
  Settings,
  WebDavSyncSettings,
  S3SyncSettings,
  RemoteSnapshotInfo,
} from "@/types";
import type { AppId } from "./types";
import {
  remoteApi,
  type ManagementTarget,
  type RestoreMode,
  type RestorePreflightReport,
} from "./remote";

export interface ConfigTransferResult {
  success: boolean;
  message: string;
  filePath?: string;
  backupId?: string;
}

export interface WebDavTestResult {
  success: boolean;
  message?: string;
}

export interface CodexUnifyHistoryRestoreResult {
  restoredJsonlFiles: number;
  restoredStateRows: number;
  /** 还原被跳过的原因（如当前目录没有账本）；存在时不应报成功 */
  skippedReason?: string;
}

export interface WebDavSyncResult {
  status: string;
}

export const settingsApi = {
  async get(): Promise<Settings> {
    return await invoke("get_settings");
  },

  async save(settings: Settings): Promise<boolean> {
    return await invoke("save_settings", { settings });
  },

  /** 是否存在统一 Codex 会话历史的迁移备份（关闭弹窗据此显示"恢复备份"勾选） */
  async hasCodexUnifyHistoryBackup(): Promise<boolean> {
    return await invoke("has_codex_unify_history_backup");
  },

  /** 按迁移备份账本把当时迁入共享桶的官方会话还原回 openai 桶（幂等） */
  async restoreCodexUnifiedHistory(): Promise<CodexUnifyHistoryRestoreResult> {
    return await invoke("restore_codex_unified_history");
  },

  async restart(): Promise<boolean> {
    return await invoke("restart_app");
  },

  async installUpdateAndRestart(): Promise<boolean> {
    return await invoke("install_update_and_restart");
  },

  async checkUpdates(): Promise<void> {
    await invoke("check_for_updates");
  },

  async isPortable(): Promise<boolean> {
    return await invoke("is_portable_mode");
  },

  async getConfigDir(appId: AppId): Promise<string> {
    return await invoke("get_config_dir", { app: appId });
  },

  async openConfigFolder(appId: AppId): Promise<void> {
    await invoke("open_config_folder", { app: appId });
  },

  async pickDirectory(defaultPath?: string): Promise<string | null> {
    return await invoke("pick_directory", { defaultPath });
  },

  async selectConfigDirectory(defaultPath?: string): Promise<string | null> {
    return await invoke("pick_directory", { defaultPath });
  },

  async getClaudeCodeConfigPath(): Promise<string> {
    return await invoke("get_claude_code_config_path");
  },

  async getAppConfigPath(): Promise<string> {
    return await invoke("get_app_config_path");
  },

  async openAppConfigFolder(): Promise<void> {
    await invoke("open_app_config_folder");
  },

  async getAppConfigDirOverride(
    target?: ManagementTarget,
  ): Promise<string | null> {
    if (target?.type === "remote") {
      return await remoteApi.getAppConfigDir(target.profile, target.secret);
    }
    return await invoke("get_app_config_dir_override");
  },

  async setAppConfigDirOverride(
    path: string | null,
    target?: ManagementTarget,
  ): Promise<boolean> {
    if (target?.type === "remote") {
      return await remoteApi.setAppConfigDir(
        target.profile,
        path,
        target.secret,
      );
    }
    return await invoke("set_app_config_dir_override", { path });
  },

  async applyClaudePluginConfig(options: {
    official: boolean;
  }): Promise<boolean> {
    const { official } = options;
    return await invoke("apply_claude_plugin_config", { official });
  },

  async applyClaudeOnboardingSkip(): Promise<boolean> {
    return await invoke("apply_claude_onboarding_skip");
  },

  async clearClaudeOnboardingSkip(): Promise<boolean> {
    return await invoke("clear_claude_onboarding_skip");
  },

  async saveFileDialog(defaultName: string): Promise<string | null> {
    return await invoke("save_file_dialog", { defaultName });
  },

  async openFileDialog(): Promise<string | null> {
    return await invoke("open_file_dialog");
  },

  async exportConfigToFile(filePath: string): Promise<ConfigTransferResult> {
    return await invoke("export_config_to_file", { filePath });
  },

  async importConfigFromFile(filePath: string): Promise<ConfigTransferResult> {
    return await invoke("import_config_from_file", { filePath });
  },

  // ─── WebDAV sync ──────────────────────────────────────────

  async webdavTestConnection(
    settings: WebDavSyncSettings,
    preserveEmptyPassword = true,
    target?: ManagementTarget,
  ): Promise<WebDavTestResult> {
    if (target?.type === "remote") {
      return await remoteApi.webdavTestConnection(
        target.profile,
        settings,
        preserveEmptyPassword,
        target.secret,
      );
    }
    return await invoke("webdav_test_connection", {
      settings,
      preserveEmptyPassword,
    });
  },

  async webdavSyncUpload(target?: ManagementTarget): Promise<WebDavSyncResult> {
    if (target?.type === "remote") {
      return await remoteApi.webdavSyncUpload(target.profile, target.secret);
    }
    return await invoke("webdav_sync_upload");
  },

  async webdavSyncDownload(
    target?: ManagementTarget,
    options?: { restoreMode?: RestoreMode },
  ): Promise<WebDavSyncResult> {
    if (target?.type === "remote") {
      if (options) {
        return await remoteApi.webdavSyncDownload(
          target.profile,
          target.secret,
          options,
        );
      }
      return await remoteApi.webdavSyncDownload(target.profile, target.secret);
    }
    return await invoke("webdav_sync_download");
  },

  async webdavSyncDownloadPreflight(
    target?: ManagementTarget,
  ): Promise<RestorePreflightReport | null> {
    if (target?.type !== "remote") return null;
    return await remoteApi.webdavSyncDownloadPreflight(
      target.profile,
      target.secret,
    );
  },

  async webdavSyncSaveSettings(
    settings: WebDavSyncSettings,
    passwordTouched = false,
    target?: ManagementTarget,
  ): Promise<{ success: boolean }> {
    if (target?.type === "remote") {
      return await remoteApi.webdavSyncSaveSettings(
        target.profile,
        settings,
        passwordTouched,
        target.secret,
      );
    }
    return await invoke("webdav_sync_save_settings", {
      settings,
      passwordTouched,
    });
  },

  async webdavSyncFetchRemoteInfo(
    target?: ManagementTarget,
  ): Promise<RemoteSnapshotInfo | { empty: true }> {
    if (target?.type === "remote") {
      return await remoteApi.webdavSyncFetchRemoteInfo(
        target.profile,
        target.secret,
      );
    }
    return await invoke("webdav_sync_fetch_remote_info");
  },

  // ===== S3 Sync API =====

  async s3TestConnection(
    settings: S3SyncSettings,
    preserveEmptyPassword = true,
    target?: ManagementTarget,
  ): Promise<WebDavTestResult> {
    if (target?.type === "remote") {
      return await remoteApi.s3TestConnection(
        target.profile,
        settings,
        preserveEmptyPassword,
        target.secret,
      );
    }
    return await invoke("s3_test_connection", {
      settings,
      preserveEmptyPassword,
    });
  },

  async s3SyncUpload(target?: ManagementTarget): Promise<WebDavSyncResult> {
    if (target?.type === "remote") {
      return await remoteApi.s3SyncUpload(target.profile, target.secret);
    }
    return await invoke("s3_sync_upload");
  },

  async s3SyncDownload(
    target?: ManagementTarget,
    options?: { restoreMode?: RestoreMode },
  ): Promise<WebDavSyncResult> {
    if (target?.type === "remote") {
      if (options) {
        return await remoteApi.s3SyncDownload(
          target.profile,
          target.secret,
          options,
        );
      }
      return await remoteApi.s3SyncDownload(target.profile, target.secret);
    }
    return await invoke("s3_sync_download");
  },

  async s3SyncDownloadPreflight(
    target?: ManagementTarget,
  ): Promise<RestorePreflightReport | null> {
    if (target?.type !== "remote") return null;
    return await remoteApi.s3SyncDownloadPreflight(
      target.profile,
      target.secret,
    );
  },

  async s3SyncSaveSettings(
    settings: S3SyncSettings,
    passwordTouched: boolean,
    target?: ManagementTarget,
  ): Promise<{ success: boolean }> {
    if (target?.type === "remote") {
      return await remoteApi.s3SyncSaveSettings(
        target.profile,
        settings,
        passwordTouched,
        target.secret,
      );
    }
    return await invoke("s3_sync_save_settings", {
      settings,
      passwordTouched,
    });
  },

  async s3SyncFetchRemoteInfo(
    target?: ManagementTarget,
  ): Promise<RemoteSnapshotInfo | { empty: true }> {
    if (target?.type === "remote") {
      return await remoteApi.s3SyncFetchRemoteInfo(
        target.profile,
        target.secret,
      );
    }
    return await invoke("s3_sync_fetch_remote_info");
  },

  async syncCurrentProvidersLive(): Promise<void> {
    const result = (await invoke("sync_current_providers_live")) as {
      success?: boolean;
      message?: string;
    };
    if (!result?.success) {
      throw new Error(result?.message || "Sync current providers failed");
    }
  },

  async openExternal(url: string): Promise<void> {
    try {
      const u = new URL(url);
      const scheme = u.protocol.replace(":", "").toLowerCase();
      if (scheme !== "http" && scheme !== "https") {
        throw new Error("Unsupported URL scheme");
      }
    } catch {
      throw new Error("Invalid URL");
    }
    await invoke("open_external", { url });
  },

  async setAutoLaunch(enabled: boolean): Promise<boolean> {
    return await invoke("set_auto_launch", { enabled });
  },

  async getAutoLaunchStatus(): Promise<boolean> {
    return await invoke("get_auto_launch_status");
  },

  async getToolVersions(
    tools?: string[],
    wslShellByTool?: Record<
      string,
      { wslShell?: string | null; wslShellFlag?: string | null }
    >,
  ): Promise<
    Array<{
      name: string;
      version: string | null;
      latest_version: string | null;
      error: string | null;
      installed_but_broken: boolean;
      env_type: "windows" | "wsl" | "macos" | "linux" | "unknown";
      wsl_distro: string | null;
    }>
  > {
    return await invoke("get_tool_versions", { tools, wslShellByTool });
  },

  async runToolLifecycleAction(
    tools: string[],
    action: "install" | "update",
    wslShellByTool?: Record<
      string,
      { wslShell?: string | null; wslShellFlag?: string | null }
    >,
  ): Promise<void> {
    await invoke("run_tool_lifecycle_action", {
      tools,
      action,
      wslShellByTool,
    });
  },

  /** 探测各工具安装分布：枚举所有安装、标记冲突、生成锚定升级命令。
   *  诊断按钮、升级前确认、升级后补诊共用此命令，各取所需字段。 */
  async probeToolInstallations(
    tools: string[],
  ): Promise<ToolInstallationReport[]> {
    return await invoke("probe_tool_installations", { tools });
  },

  async getRectifierConfig(): Promise<RectifierConfig> {
    return await invoke("get_rectifier_config");
  },

  async setRectifierConfig(config: RectifierConfig): Promise<boolean> {
    return await invoke("set_rectifier_config", { config });
  },

  async getOptimizerConfig(): Promise<OptimizerConfig> {
    return await invoke("get_optimizer_config");
  },

  async setOptimizerConfig(config: OptimizerConfig): Promise<boolean> {
    return await invoke("set_optimizer_config", { config });
  },

  async getLogConfig(target?: ManagementTarget): Promise<LogConfig> {
    if (target?.type === "remote") {
      return await remoteApi.getLogConfig(target.profile, target.secret);
    }
    return await invoke("get_log_config");
  },

  async setLogConfig(
    config: LogConfig,
    target?: ManagementTarget,
  ): Promise<boolean> {
    if (target?.type === "remote") {
      return await remoteApi.setLogConfig(
        target.profile,
        config,
        target.secret,
      );
    }
    return await invoke("set_log_config", { config });
  },
};

/** 单处工具安装的诊断信息（多处安装冲突检测）。字段对应后端 ToolInstallation。 */
export interface ToolInstallation {
  path: string;
  version: string | null;
  runnable: boolean;
  error: string | null;
  source: string;
  is_path_default: boolean;
}

/** 一次"探测工具安装分布"的结果。字段对应后端 ToolInstallationReport。 */
export interface ToolInstallationReport {
  tool: string;
  installs: ToolInstallation[];
  is_conflict: boolean;
  needs_confirmation: boolean;
  command: string;
  anchored: boolean;
}

export interface RectifierConfig {
  enabled: boolean;
  requestThinkingSignature: boolean;
  requestThinkingBudget: boolean;
  requestMediaFallback: boolean;
  requestMediaHeuristic: boolean;
}

export interface OptimizerConfig {
  enabled: boolean;
  thinkingOptimizer: boolean;
  cacheInjection: boolean;
  cacheTtl: string;
}

export interface LogConfig {
  enabled: boolean;
  level: "error" | "warn" | "info" | "debug" | "trace";
}

export interface BackupEntry {
  filename: string;
  sizeBytes: number;
  createdAt: string;
}

export const backupsApi = {
  async createDbBackup(target?: ManagementTarget): Promise<string> {
    if (target?.type === "remote") {
      return await remoteApi.createDbBackup(target.profile, target.secret);
    }
    return await invoke("create_db_backup");
  },

  async listDbBackups(target?: ManagementTarget): Promise<BackupEntry[]> {
    if (target?.type === "remote") {
      return await remoteApi.listDbBackups(target.profile, target.secret);
    }
    return await invoke("list_db_backups");
  },

  async restoreDbBackup(
    filename: string,
    target?: ManagementTarget,
  ): Promise<string> {
    if (target?.type === "remote") {
      return await remoteApi.restoreDbBackup(
        target.profile,
        filename,
        target.secret,
      );
    }
    return await invoke("restore_db_backup", { filename });
  },

  async renameDbBackup(
    oldFilename: string,
    newName: string,
    target?: ManagementTarget,
  ): Promise<string> {
    if (target?.type === "remote") {
      return await remoteApi.renameDbBackup(
        target.profile,
        oldFilename,
        newName,
        target.secret,
      );
    }
    return await invoke("rename_db_backup", { oldFilename, newName });
  },

  async deleteDbBackup(
    filename: string,
    target?: ManagementTarget,
  ): Promise<boolean | void> {
    if (target?.type === "remote") {
      return await remoteApi.deleteDbBackup(
        target.profile,
        filename,
        target.secret,
      );
    }
    await invoke("delete_db_backup", { filename });
  },
};
