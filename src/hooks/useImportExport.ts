import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { remoteApi, settingsApi } from "@/lib/api";
import type {
  ManagementTarget,
  RestoreMode,
  RestorePreflightReport,
} from "@/lib/api";
import { syncCurrentProvidersLiveSafe } from "@/utils/postChangeSync";

export type ImportStatus =
  | "idle"
  | "importing"
  | "success"
  | "partial-success"
  | "error";

export interface UseImportExportOptions {
  onImportSuccess?: () => void | Promise<void>;
  target?: ManagementTarget;
}

export interface UseImportExportResult {
  selectedFile: string;
  status: ImportStatus;
  errorMessage: string | null;
  backupId: string | null;
  isImporting: boolean;
  restorePreflightReport: RestorePreflightReport | null;
  isRestorePreflightOpen: boolean;
  selectImportFile: () => Promise<void>;
  clearSelection: () => void;
  importConfig: () => Promise<void>;
  importWithRestoreMode: (mode: RestoreMode) => Promise<void>;
  cancelRestorePreflight: () => void;
  exportConfig: () => Promise<void>;
  resetStatus: () => void;
}

export function useImportExport(
  options: UseImportExportOptions = {},
): UseImportExportResult {
  const { t } = useTranslation();
  const { onImportSuccess, target = { type: "local" } } = options;

  const [selectedFile, setSelectedFile] = useState("");
  const [status, setStatus] = useState<ImportStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [backupId, setBackupId] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [restorePreflightReport, setRestorePreflightReport] =
    useState<RestorePreflightReport | null>(null);
  const [isRestorePreflightOpen, setIsRestorePreflightOpen] = useState(false);

  const clearSelection = useCallback(() => {
    setSelectedFile("");
    setStatus("idle");
    setErrorMessage(null);
    setBackupId(null);
    setRestorePreflightReport(null);
    setIsRestorePreflightOpen(false);
  }, []);

  const selectImportFile = useCallback(async () => {
    try {
      const filePath = await settingsApi.openFileDialog();
      if (filePath) {
        setSelectedFile(filePath);
        setStatus("idle");
        setErrorMessage(null);
        setRestorePreflightReport(null);
        setIsRestorePreflightOpen(false);
      }
    } catch (error) {
      console.error("[useImportExport] Failed to open file dialog", error);
      toast.error(
        t("settings.selectFileFailed", {
          defaultValue: "选择文件失败",
        }),
      );
    }
  }, [t]);

  const handleImportResult = useCallback(
    async (result: {
      success: boolean;
      message: string;
      backupId?: string;
      warning?: string;
    }) => {
      if (!result.success) {
        setStatus("error");
        const message =
          result.message ||
          t("settings.configCorrupted", {
            defaultValue: "SQL 文件已损坏或格式不正确",
          });
        setErrorMessage(message);
        toast.error(message);
        return;
      }

      setBackupId(result.backupId ?? null);
      void onImportSuccess?.();

      const syncResult =
        target.type === "remote"
          ? { ok: true as const }
          : await syncCurrentProvidersLiveSafe();
      if (syncResult.ok) {
        setStatus("success");
        toast.success(
          t("settings.importSuccess", {
            defaultValue: "配置导入成功",
          }),
          { closeButton: true },
        );
      } else {
        console.error(
          "[useImportExport] Failed to sync live config",
          syncResult.error,
        );
        setStatus("partial-success");
        toast.warning(
          t("settings.importPartialSuccess", {
            defaultValue:
              "配置已导入，但同步到当前供应商失败。请手动重新选择一次供应商。",
          }),
        );
      }
    },
    [onImportSuccess, t, target.type],
  );

  const executeImport = useCallback(
    async (restoreMode: RestoreMode) => {
      const result =
        target.type === "remote"
          ? await remoteApi.importConfigFromFile(
              target.profile,
              selectedFile,
              target.secret,
              { restoreMode },
            )
          : await settingsApi.importConfigFromFile(selectedFile);
      await handleImportResult(result);
    },
    [handleImportResult, selectedFile, target],
  );

  const importConfig = useCallback(async () => {
    if (!selectedFile) {
      toast.error(
        t("settings.selectFileFailed", {
          defaultValue: "请选择有效的 SQL 备份文件",
        }),
      );
      return;
    }

    if (isImporting) return;

    setIsImporting(true);
    setStatus("importing");
    setErrorMessage(null);

    try {
      if (target.type === "remote") {
        const report = await remoteApi.preflightConfigFile(
          target.profile,
          selectedFile,
          target.secret,
        );
        setRestorePreflightReport(report);
        if (report.hasBlockingRisks) {
          setStatus("idle");
          setIsRestorePreflightOpen(true);
          toast.warning(
            t("settings.remoteRestorePreflight.riskToast", {
              defaultValue: "检测到跨平台恢复风险，请选择精确恢复或便携恢复。",
            }),
          );
          return;
        }
      }

      await executeImport("exact");
    } catch (error) {
      console.error("[useImportExport] Failed to import config", error);
      setStatus("error");
      const message =
        error instanceof Error ? error.message : String(error ?? "");
      setErrorMessage(message);
      toast.error(
        t("settings.importFailedError", {
          defaultValue: "导入配置失败: {{message}}",
          message,
        }),
      );
    } finally {
      setIsImporting(false);
    }
  }, [executeImport, isImporting, selectedFile, t, target]);

  const importWithRestoreMode = useCallback(
    async (mode: RestoreMode) => {
      if (!selectedFile || isImporting) return;

      setIsRestorePreflightOpen(false);
      setIsImporting(true);
      setStatus("importing");
      setErrorMessage(null);

      try {
        await executeImport(mode);
      } catch (error) {
        console.error("[useImportExport] Failed to import config", error);
        setStatus("error");
        const message =
          error instanceof Error ? error.message : String(error ?? "");
        setErrorMessage(message);
        toast.error(
          t("settings.importFailedError", {
            defaultValue: "导入配置失败: {{message}}",
            message,
          }),
        );
      } finally {
        setIsImporting(false);
      }
    },
    [executeImport, isImporting, selectedFile, t],
  );

  const cancelRestorePreflight = useCallback(() => {
    setIsRestorePreflightOpen(false);
    setStatus("idle");
  }, []);

  const exportConfig = useCallback(async () => {
    try {
      const now = new Date();
      const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
      const defaultName = `cc-switch-export-${stamp}.sql`;
      const destination = await settingsApi.saveFileDialog(defaultName);
      if (!destination) {
        toast.error(
          t("settings.selectFileFailed", {
            defaultValue: "请选择 SQL 备份保存路径",
          }),
        );
        return;
      }

      const result =
        target.type === "remote"
          ? await remoteApi.exportConfigToFile(
              target.profile,
              destination,
              target.secret,
            )
          : await settingsApi.exportConfigToFile(destination);
      if (result.success) {
        const displayPath = result.filePath ?? destination;
        toast.success(
          t("settings.configExported", {
            defaultValue: "配置已导出",
          }) + `\n${displayPath}`,
          { closeButton: true },
        );
      } else {
        toast.error(
          t("settings.exportFailed", {
            defaultValue: "导出配置失败",
          }) + (result.message ? `: ${result.message}` : ""),
        );
      }
    } catch (error) {
      console.error("[useImportExport] Failed to export config", error);
      toast.error(
        t("settings.exportFailedError", {
          defaultValue: "导出配置失败: {{message}}",
          message: error instanceof Error ? error.message : String(error ?? ""),
        }),
      );
    }
  }, [t, target]);

  const resetStatus = useCallback(() => {
    setStatus("idle");
    setErrorMessage(null);
    setBackupId(null);
    setRestorePreflightReport(null);
    setIsRestorePreflightOpen(false);
  }, []);

  return {
    selectedFile,
    status,
    errorMessage,
    backupId,
    isImporting,
    restorePreflightReport,
    isRestorePreflightOpen,
    selectImportFile,
    clearSelection,
    importConfig,
    importWithRestoreMode,
    cancelRestorePreflight,
    exportConfig,
    resetStatus,
  };
}
