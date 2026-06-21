import { useMemo } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  FolderOpen,
  Loader2,
  Save,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTranslation } from "react-i18next";
import type { ImportStatus } from "@/hooks/useImportExport";
import type {
  RestoreMode,
  RestorePreflightReport,
  RestoreRiskKind,
} from "@/lib/api";

interface ImportExportSectionProps {
  status: ImportStatus;
  selectedFile: string;
  errorMessage: string | null;
  backupId: string | null;
  isImporting: boolean;
  restorePreflightReport?: RestorePreflightReport | null;
  isRestorePreflightOpen?: boolean;
  onSelectFile: () => Promise<void>;
  onImport: () => Promise<void>;
  onImportWithRestoreMode?: (mode: RestoreMode) => Promise<void>;
  onCancelRestorePreflight?: () => void;
  onExport: () => Promise<void>;
  onClear: () => void;
}

export function ImportExportSection({
  status,
  selectedFile,
  errorMessage,
  backupId,
  isImporting,
  restorePreflightReport,
  isRestorePreflightOpen = false,
  onSelectFile,
  onImport,
  onImportWithRestoreMode,
  onCancelRestorePreflight,
  onExport,
  onClear,
}: ImportExportSectionProps) {
  const { t } = useTranslation();

  const selectedFileName = useMemo(() => {
    if (!selectedFile) return "";
    const segments = selectedFile.split(/[\\/]/);
    return segments[segments.length - 1] || selectedFile;
  }, [selectedFile]);

  return (
    <section className="space-y-4">
      <header className="space-y-2">
        <h3 className="text-base font-semibold text-foreground">
          {t("settings.importExport")}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t("settings.importExportHint")}
        </p>
      </header>

      <div className="space-y-4 rounded-lg border border-border bg-muted/40 p-6">
        {/* Import and Export Buttons Side by Side */}
        <div className="grid grid-cols-2 gap-4 items-stretch">
          {/* Import Button */}
          <div className="relative">
            <Button
              type="button"
              className={`w-full h-auto py-3 px-4 bg-blue-500 hover:bg-blue-600 dark:bg-blue-600 dark:hover:bg-blue-700 text-white ${selectedFile && !isImporting ? "flex-col items-start" : "items-center"}`}
              onClick={!selectedFile ? onSelectFile : onImport}
              disabled={isImporting}
            >
              <div className="flex items-center gap-2 w-full justify-center">
                {isImporting ? (
                  <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" />
                ) : selectedFile ? (
                  <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                ) : (
                  <FolderOpen className="h-4 w-4 flex-shrink-0" />
                )}
                <span className="font-medium">
                  {isImporting
                    ? t("settings.importing")
                    : selectedFile
                      ? t("settings.import")
                      : t("settings.selectConfigFile")}
                </span>
              </div>
              {selectedFile && !isImporting && (
                <div className="mt-2 w-full text-left">
                  <p className="text-xs font-mono text-white/80 truncate">
                    📄 {selectedFileName}
                  </p>
                </div>
              )}
            </Button>
            {selectedFile && (
              <button
                type="button"
                onClick={onClear}
                className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center shadow-lg transition-colors z-10"
                aria-label={t("common.clear")}
              >
                <XCircle className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Export Button */}
          <div>
            <Button
              type="button"
              className="w-full h-full py-3 px-4 bg-blue-500 hover:bg-blue-600 dark:bg-blue-600 dark:hover:bg-blue-700 text-white items-center"
              onClick={onExport}
            >
              <Save className="mr-2 h-4 w-4" />
              {t("settings.exportConfig")}
            </Button>
          </div>
        </div>

        <ImportStatusMessage
          status={status}
          errorMessage={errorMessage}
          backupId={backupId}
        />
      </div>

      <RemoteRestorePreflightDialog
        open={isRestorePreflightOpen}
        report={restorePreflightReport ?? null}
        isImporting={isImporting}
        onCancel={onCancelRestorePreflight}
        onImport={onImportWithRestoreMode}
      />
    </section>
  );
}

interface RemoteRestorePreflightDialogProps {
  open: boolean;
  report: RestorePreflightReport | null;
  isImporting: boolean;
  onCancel?: () => void;
  onImport?: (mode: RestoreMode) => Promise<void>;
}

function RemoteRestorePreflightDialog({
  open,
  report,
  isImporting,
  onCancel,
  onImport,
}: RemoteRestorePreflightDialogProps) {
  const { t } = useTranslation();
  const risks = report?.risks ?? [];

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel?.()}>
      <DialogContent className="max-w-2xl" zIndex="top">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            {t("settings.remoteRestorePreflight.title")}
          </DialogTitle>
          <DialogDescription>
            {t("settings.remoteRestorePreflight.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[50vh] space-y-3 overflow-y-auto px-6 py-4">
          <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
            {t("settings.remoteRestorePreflight.modeHint")}
          </div>

          {risks.length > 0 ? (
            <div className="space-y-2">
              {risks.slice(0, 12).map((risk, index) => (
                <div
                  key={`${risk.providerId}-${risk.tomlPath}-${index}`}
                  className="rounded-lg border border-border bg-background p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">
                      {risk.providerId || risk.appType}
                    </Badge>
                    <Badge variant="outline">
                      {restoreRiskKindLabel(t, risk.kind)}
                    </Badge>
                    <code className="text-xs text-muted-foreground">
                      {risk.tomlPath}
                    </code>
                  </div>
                  {risk.valuePreview ? (
                    <p className="mt-2 break-all text-xs text-muted-foreground">
                      {risk.valuePreview}
                    </p>
                  ) : null}
                </div>
              ))}
              {risks.length > 12 ? (
                <p className="text-xs text-muted-foreground">
                  {t("settings.remoteRestorePreflight.moreRisks", {
                    count: risks.length - 12,
                  })}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("settings.remoteRestorePreflight.noRisks")}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={isImporting || !onImport}
            onClick={() => void onImport?.("exact")}
          >
            {t("settings.remoteRestorePreflight.exactRestore")}
          </Button>
          <Button
            type="button"
            disabled={isImporting || !onImport}
            onClick={() => void onImport?.("portable-provider")}
          >
            {isImporting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            {t("settings.remoteRestorePreflight.portableRestore")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function restoreRiskKindLabel(
  t: ReturnType<typeof useTranslation>["t"],
  kind: RestoreRiskKind,
): string {
  return t(`settings.remoteRestorePreflight.riskKinds.${kind}`, {
    defaultValue: kind,
  });
}

interface ImportStatusMessageProps {
  status: ImportStatus;
  errorMessage: string | null;
  backupId: string | null;
}

function ImportStatusMessage({
  status,
  errorMessage,
  backupId,
}: ImportStatusMessageProps) {
  const { t } = useTranslation();

  if (status === "idle") {
    return null;
  }

  const baseClass =
    "flex items-start gap-3 rounded-xl border p-4 text-sm leading-relaxed backdrop-blur-sm";

  if (status === "importing") {
    return (
      <div
        className={`${baseClass} border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400`}
      >
        <Loader2 className="mt-0.5 h-5 w-5 flex-shrink-0 animate-spin" />
        <div>
          <p className="font-semibold">{t("settings.importing")}</p>
          <p className="text-blue-600/80 dark:text-blue-400/80">
            {t("common.loading")}
          </p>
        </div>
      </div>
    );
  }

  if (status === "success") {
    return (
      <div
        className={`${baseClass} border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400`}
      >
        <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0" />
        <div className="space-y-1.5">
          <p className="font-semibold">{t("settings.importSuccess")}</p>
          {backupId ? (
            <p className="text-xs text-green-600/80 dark:text-green-400/80">
              {t("settings.backupId")}: {backupId}
            </p>
          ) : null}
          <p className="text-green-600/80 dark:text-green-400/80">
            {t("settings.autoReload")}
          </p>
        </div>
      </div>
    );
  }

  if (status === "partial-success") {
    return (
      <div
        className={`${baseClass} border-yellow-500/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400`}
      >
        <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0" />
        <div className="space-y-1.5">
          <p className="font-semibold">{t("settings.importPartialSuccess")}</p>
          <p className="text-yellow-600/80 dark:text-yellow-400/80">
            {t("settings.importPartialHint")}
          </p>
        </div>
      </div>
    );
  }

  const message = errorMessage || t("settings.importFailed");

  return (
    <div
      className={`${baseClass} border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400`}
    >
      <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0" />
      <div className="space-y-1.5">
        <p className="font-semibold">{t("settings.importFailed")}</p>
        <p className="text-red-600/80 dark:text-red-400/80">{message}</p>
      </div>
    </div>
  );
}
