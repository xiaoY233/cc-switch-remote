import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileText, Search } from "lucide-react";
import { type AppId } from "@/lib/api";
import { usePromptActions } from "@/hooks/usePromptActions";
import { useTauriEvent } from "@/hooks/useTauriEvent";
import { ManagementListSearch } from "@/components/common/ManagementListSearch";
import { ScrollArea } from "@/components/ui/scroll-area";
import PromptListItem from "./PromptListItem";
import PromptFormPanel from "./PromptFormPanel";
import PiPromptPanel, {
  type PromptPrimaryAction,
  type PiPromptPanelHandle,
} from "./PiPromptPanel";
import { ConfirmDialog } from "../ConfirmDialog";
import type { ManagementTarget } from "@/lib/api/remote";

interface PromptPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appId: AppId;
  onInteractionBlockedChange?: (blocked: boolean) => void;
  onNavigationBlockedChange?: (blocked: boolean) => void;
  onPrimaryActionChange?: (action: PromptPrimaryAction) => void;
  target?: ManagementTarget;
}

const LOCAL_TARGET: ManagementTarget = { type: "local" };

export interface PromptPanelHandle {
  openAdd: () => void;
  openImport: () => Promise<void>;
}

const StandardPromptPanel = React.forwardRef<
  PromptPanelHandle,
  PromptPanelProps
>(
  (
    {
      open,
      appId,
      onInteractionBlockedChange,
      onNavigationBlockedChange,
      target = LOCAL_TARGET,
    },
    ref,
  ) => {
    const { t } = useTranslation();
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [confirmDialog, setConfirmDialog] = useState<{
      isOpen: boolean;
      titleKey: string;
      messageKey: string;
      messageParams?: Record<string, unknown>;
      onConfirm: () => void;
    } | null>(null);
    const [writePending, setWritePending] = useState(false);
    const [reloadPending, setReloadPending] = useState(false);
    const writeLockRef = React.useRef(false);
    const reloadLockRef = React.useRef(false);
    const reloadRunGenerationRef = React.useRef(0);
    const overlayOpenRef = React.useRef(false);
    const externalReloadQueuedRef = React.useRef(false);

    const {
      prompts,
      loading,
      reload,
      savePrompt,
      deletePrompt,
      toggleEnabled,
      importFromFile,
    } = usePromptActions(appId, target);
    const targetKey =
      target.type === "remote" ? `remote:${target.profile.id}` : "local";
    const reloadRef = React.useRef(reload);
    reloadRef.current = reload;

    const dialogOpen = confirmDialog !== null;
    const interactionBlocked =
      loading || reloadPending || writePending || isFormOpen || dialogOpen;
    const navigationBlocked = writePending || isFormOpen || dialogOpen;

    useEffect(() => {
      onInteractionBlockedChange?.(interactionBlocked);
    }, [interactionBlocked, onInteractionBlockedChange]);

    useEffect(() => {
      onNavigationBlockedChange?.(navigationBlocked);
    }, [navigationBlocked, onNavigationBlockedChange]);

    useEffect(
      () => () => {
        onInteractionBlockedChange?.(false);
        onNavigationBlockedChange?.(false);
      },
      [onInteractionBlockedChange, onNavigationBlockedChange],
    );

    const runExternalReload = React.useCallback(async () => {
      if (writeLockRef.current || overlayOpenRef.current) {
        externalReloadQueuedRef.current = true;
        return;
      }

      const runGeneration = ++reloadRunGenerationRef.current;
      externalReloadQueuedRef.current = false;
      reloadLockRef.current = true;
      setReloadPending(true);
      try {
        await reloadRef.current();
      } finally {
        if (reloadRunGenerationRef.current === runGeneration) {
          reloadLockRef.current = false;
          setReloadPending(false);
        }
      }
    }, []);

    const beginWrite = () => {
      if (loading || reloadLockRef.current || writeLockRef.current)
        return false;
      writeLockRef.current = true;
      setWritePending(true);
      return true;
    };

    const endWrite = () => {
      writeLockRef.current = false;
      setWritePending(false);
      if (externalReloadQueuedRef.current) {
        void runExternalReload();
      }
    };

    useEffect(() => {
      if (open) void runExternalReload();
    }, [appId, open, runExternalReload, target, targetKey]);

    useEffect(() => {
      setSearchQuery("");
      overlayOpenRef.current = false;
      setIsFormOpen(false);
      setEditingId(null);
      setConfirmDialog(null);
      if (externalReloadQueuedRef.current) {
        void runExternalReload();
      }
    }, [appId, runExternalReload, target, targetKey]);

    // Listen for prompt import events from deep link
    useEffect(() => {
      const handlePromptImported = (event: Event) => {
        const customEvent = event as CustomEvent;
        // Reload if the import is for this app
        if (target.type === "local" && customEvent.detail?.app === appId) {
          void runExternalReload();
        }
      };

      window.addEventListener("prompt-imported", handlePromptImported);
      return () => {
        window.removeEventListener("prompt-imported", handlePromptImported);
      };
    }, [appId, runExternalReload, target.type]);

    // 应用项目 Profile 会切换激活的 prompt（prompts 非 react-query，需主动 reload）
    useTauriEvent("profile-applied", () => {
      if (target.type === "local") {
        void runExternalReload();
      }
    });

    const handleAdd = () => {
      if (reloadLockRef.current || writeLockRef.current || interactionBlocked) {
        return;
      }
      overlayOpenRef.current = true;
      setEditingId(null);
      setIsFormOpen(true);
    };

    React.useImperativeHandle(ref, () => ({
      openAdd: handleAdd,
      openImport: async () => {
        if (!beginWrite()) return;
        try {
          await importFromFile();
        } finally {
          endWrite();
        }
      },
    }));

    const handleEdit = (id: string) => {
      if (reloadLockRef.current || writeLockRef.current || interactionBlocked) {
        return;
      }
      overlayOpenRef.current = true;
      setEditingId(id);
      setIsFormOpen(true);
    };

    const handleDelete = (id: string) => {
      if (reloadLockRef.current || writeLockRef.current || interactionBlocked) {
        return;
      }
      const prompt = prompts[id];
      overlayOpenRef.current = true;
      setConfirmDialog({
        isOpen: true,
        titleKey: "prompts.confirm.deleteTitle",
        messageKey: "prompts.confirm.deleteMessage",
        messageParams: { name: prompt?.name },
        onConfirm: async () => {
          if (!beginWrite()) return;
          try {
            const refreshed = await deletePrompt(id);
            if (refreshed === false) {
              externalReloadQueuedRef.current = true;
            }
            overlayOpenRef.current = false;
            setConfirmDialog(null);
          } catch (e) {
            // Error handled by hook
          } finally {
            endWrite();
          }
        },
      });
    };

    const handleToggle = async (id: string, enabled: boolean) => {
      if (!beginWrite()) return;
      try {
        const refreshed = await toggleEnabled(id, enabled);
        if (refreshed === false) {
          externalReloadQueuedRef.current = true;
        }
      } catch (error) {
        // Error handled by hook
      } finally {
        endWrite();
      }
    };

    const handleSave = async (
      id: string,
      prompt: Parameters<typeof savePrompt>[1],
    ) => {
      if (!beginWrite()) return false;
      try {
        const refreshed = await savePrompt(id, prompt);
        if (refreshed === false) {
          externalReloadQueuedRef.current = true;
        }
        return true;
      } catch (error) {
        // Error handled by hook
        return false;
      } finally {
        endWrite();
      }
    };

    const handleCloseForm = () => {
      if (writeLockRef.current) return;
      overlayOpenRef.current = false;
      setIsFormOpen(false);
      setEditingId(null);
      if (externalReloadQueuedRef.current) {
        void runExternalReload();
      }
    };

    const promptEntries = useMemo(() => Object.entries(prompts), [prompts]);
    const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase();
    const filteredPromptEntries = useMemo(() => {
      if (!normalizedSearchQuery) return promptEntries;

      return promptEntries.filter(([recordId, prompt]) =>
        [
          recordId,
          prompt.id,
          prompt.name,
          prompt.description,
          prompt.content,
        ].some((value) =>
          value?.toLocaleLowerCase().includes(normalizedSearchQuery),
        ),
      );
    }, [normalizedSearchQuery, promptEntries]);

    const enabledPrompt = promptEntries.find(([_, p]) => p.enabled);

    return (
      <div className="flex flex-col flex-1 min-h-0 px-6">
        <div className="flex-shrink-0 py-4 glass rounded-xl border border-white/10 mb-4 px-6">
          <div className="text-sm text-muted-foreground">
            {t("prompts.count", { count: promptEntries.length })} ·{" "}
            {enabledPrompt
              ? t("prompts.enabledName", { name: enabledPrompt[1].name })
              : t("prompts.noneEnabled")}
          </div>
        </div>

        <ManagementListSearch
          value={searchQuery}
          onValueChange={setSearchQuery}
          placeholder={t("prompts.searchPlaceholder")}
          ariaLabel={t("prompts.searchAriaLabel")}
          clearLabel={t("common.clear")}
        />

        <ScrollArea className="-mr-3 flex-1 min-h-0" type="auto">
          <div className="pb-16 pr-3">
            {loading ? (
              <div className="text-center py-12 text-muted-foreground">
                {t("prompts.loading")}
              </div>
            ) : promptEntries.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-16 h-16 mx-auto mb-4 bg-muted rounded-full flex items-center justify-center">
                  <FileText size={24} className="text-muted-foreground" />
                </div>
                <h3 className="text-lg font-medium text-foreground mb-2">
                  {t("prompts.empty")}
                </h3>
                <p className="text-muted-foreground text-sm">
                  {t("prompts.emptyDescription")}
                </p>
              </div>
            ) : filteredPromptEntries.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                <Search className="mb-4 h-10 w-10 opacity-40" />
                <p className="text-sm">{t("prompts.noSearchResults")}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredPromptEntries.map(([id, prompt]) => (
                  <PromptListItem
                    key={id}
                    id={id}
                    prompt={prompt}
                    onToggle={handleToggle}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    disabled={interactionBlocked}
                  />
                ))}
              </div>
            )}
          </div>
        </ScrollArea>

        {isFormOpen && (
          <PromptFormPanel
            appId={appId}
            editingId={editingId || undefined}
            initialData={editingId ? prompts[editingId] : undefined}
            onSave={handleSave}
            onClose={handleCloseForm}
          />
        )}

        {confirmDialog && (
          <ConfirmDialog
            isOpen={confirmDialog.isOpen}
            title={t(confirmDialog.titleKey)}
            message={t(confirmDialog.messageKey, confirmDialog.messageParams)}
            pending={writePending}
            onConfirm={confirmDialog.onConfirm}
            onCancel={() => {
              if (!writeLockRef.current) {
                overlayOpenRef.current = false;
                setConfirmDialog(null);
                if (externalReloadQueuedRef.current) {
                  void runExternalReload();
                }
              }
            }}
          />
        )}
      </div>
    );
  },
);

StandardPromptPanel.displayName = "StandardPromptPanel";

const PromptPanel = React.forwardRef<PromptPanelHandle, PromptPanelProps>(
  (props, ref) => {
    // Pi 原生提示词面板只适用于本地目标：它读写的是本机 Pi 的
    // 提示词/规则文件；远程目标继续走标准的远端 prompts 链路。
    if (props.appId === "pi" && props.target?.type !== "remote") {
      return (
        <PiPromptPanel
          ref={ref as React.ForwardedRef<PiPromptPanelHandle>}
          open={props.open}
          onInteractionBlockedChange={props.onInteractionBlockedChange}
          onNavigationBlockedChange={props.onNavigationBlockedChange}
          onPrimaryActionChange={props.onPrimaryActionChange}
        />
      );
    }

    return <StandardPromptPanel ref={ref} {...props} />;
  },
);

PromptPanel.displayName = "PromptPanel";

export type { PromptPrimaryAction } from "./PiPromptPanel";

export default PromptPanel;
