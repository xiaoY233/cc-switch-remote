import { useState, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { promptsApi, type Prompt, type AppId } from "@/lib/api";
import type { ManagementTarget } from "@/lib/api/remote";

const LOCAL_TARGET: ManagementTarget = { type: "local" };
const EMPTY_PROMPTS: Record<string, Prompt> = {};

const getContextKey = (appId: AppId, target: ManagementTarget) =>
  `${appId}:${target.type === "remote" ? `remote:${target.profile.id}` : "local"}`;

export function usePromptActions(
  appId: AppId,
  target: ManagementTarget = LOCAL_TARGET,
) {
  const { t } = useTranslation();
  const contextKey = getContextKey(appId, target);
  const [prompts, setPrompts] = useState<Record<string, Prompt>>({});
  const [promptsContextKey, setPromptsContextKey] = useState<string | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [currentFileContent, setCurrentFileContent] = useState<string | null>(
    null,
  );
  const [currentFileContextKey, setCurrentFileContextKey] = useState<
    string | null
  >(null);
  const reloadGenerationRef = useRef(0);
  const currentContextKeyRef = useRef(contextKey);
  const currentTargetRef = useRef(target);
  const promptsContextKeyRef = useRef<string | null>(null);
  currentContextKeyRef.current = contextKey;
  currentTargetRef.current = target;

  const visiblePrompts =
    promptsContextKey === contextKey ? prompts : EMPTY_PROMPTS;
  const visibleCurrentFileContent =
    currentFileContextKey === contextKey ? currentFileContent : null;

  const updatePromptsForContext = useCallback(
    (
      targetContextKey: string,
      requestTarget: ManagementTarget,
      updater: (current: Record<string, Prompt>) => Record<string, Prompt>,
    ) => {
      if (
        currentContextKeyRef.current !== targetContextKey ||
        currentTargetRef.current !== requestTarget
      ) {
        return;
      }

      const previousContextKey = promptsContextKeyRef.current;
      setPrompts((current) =>
        updater(
          previousContextKey === targetContextKey ? current : EMPTY_PROMPTS,
        ),
      );
      promptsContextKeyRef.current = targetContextKey;
      setPromptsContextKey(targetContextKey);
    },
    [],
  );

  useEffect(
    () => () => {
      reloadGenerationRef.current += 1;
    },
    [],
  );

  const reload = useCallback(async (): Promise<boolean> => {
    const requestContextKey = contextKey;
    const requestTarget = target;
    if (
      currentContextKeyRef.current !== requestContextKey ||
      currentTargetRef.current !== requestTarget
    ) {
      return false;
    }

    const requestGeneration = ++reloadGenerationRef.current;
    const isCurrentRequest = () =>
      reloadGenerationRef.current === requestGeneration &&
      currentContextKeyRef.current === requestContextKey &&
      currentTargetRef.current === requestTarget;

    setLoading(true);
    try {
      const data = await promptsApi.getPrompts(appId, requestTarget);
      if (!isCurrentRequest()) return false;
      updatePromptsForContext(requestContextKey, requestTarget, () => data);

      try {
        const content = await promptsApi.getCurrentFileContent(
          appId,
          requestTarget,
        );
        if (!isCurrentRequest()) return false;
        setCurrentFileContent(content);
        setCurrentFileContextKey(requestContextKey);
      } catch (error) {
        if (isCurrentRequest()) {
          setCurrentFileContent(null);
          setCurrentFileContextKey(requestContextKey);
        }
      }
      return true;
    } catch (error) {
      if (isCurrentRequest()) {
        toast.error(t("prompts.loadFailed"));
      }
      return false;
    } finally {
      if (isCurrentRequest()) {
        setLoading(false);
      }
    }
  }, [appId, contextKey, t, target, updatePromptsForContext]);

  const savePrompt = useCallback(
    async (id: string, prompt: Prompt) => {
      const requestContextKey = contextKey;
      const requestTarget = target;
      try {
        await promptsApi.upsertPrompt(appId, id, prompt, requestTarget);
        updatePromptsForContext(
          requestContextKey,
          requestTarget,
          (current) => ({
            ...current,
            [id]: prompt,
          }),
        );
        const refreshed =
          currentContextKeyRef.current === requestContextKey &&
          currentTargetRef.current === requestTarget
            ? await reload()
            : false;
        toast.success(t("prompts.saveSuccess"), { closeButton: true });
        return refreshed;
      } catch (error) {
        toast.error(t("prompts.saveFailed"));
        throw error;
      }
    },
    [appId, contextKey, reload, t, target, updatePromptsForContext],
  );

  const deletePrompt = useCallback(
    async (id: string) => {
      const requestContextKey = contextKey;
      const requestTarget = target;
      try {
        await promptsApi.deletePrompt(appId, id, requestTarget);
        updatePromptsForContext(requestContextKey, requestTarget, (current) => {
          const next = { ...current };
          delete next[id];
          return next;
        });
        const refreshed =
          currentContextKeyRef.current === requestContextKey &&
          currentTargetRef.current === requestTarget
            ? await reload()
            : false;
        toast.success(t("prompts.deleteSuccess"), { closeButton: true });
        return refreshed;
      } catch (error) {
        toast.error(t("prompts.deleteFailed"));
        throw error;
      }
    },
    [appId, contextKey, reload, t, target, updatePromptsForContext],
  );

  const enablePrompt = useCallback(
    async (id: string) => {
      const requestContextKey = contextKey;
      const requestTarget = target;
      try {
        await promptsApi.enablePrompt(appId, id, requestTarget);
        updatePromptsForContext(requestContextKey, requestTarget, (current) =>
          Object.fromEntries(
            Object.entries(current).map(([key, prompt]) => [
              key,
              { ...prompt, enabled: key === id },
            ]),
          ),
        );
        const refreshed =
          currentContextKeyRef.current === requestContextKey &&
          currentTargetRef.current === requestTarget
            ? await reload()
            : false;
        toast.success(t("prompts.enableSuccess"), { closeButton: true });
        return refreshed;
      } catch (error) {
        toast.error(t("prompts.enableFailed"));
        throw error;
      }
    },
    [appId, contextKey, reload, t, target, updatePromptsForContext],
  );

  const toggleEnabled = useCallback(
    async (id: string, enabled: boolean) => {
      const requestContextKey = contextKey;
      const requestTarget = target;
      const previousPrompts = visiblePrompts;
      const mutationGeneration = reloadGenerationRef.current;

      if (appId === "pi") setTogglingId(id);

      if (enabled) {
        const updatedPrompts = Object.keys(visiblePrompts).reduce(
          (acc, key) => {
            acc[key] = { ...visiblePrompts[key], enabled: key === id };
            return acc;
          },
          {} as Record<string, Prompt>,
        );
        updatePromptsForContext(
          requestContextKey,
          requestTarget,
          () => updatedPrompts,
        );
      } else {
        updatePromptsForContext(
          requestContextKey,
          requestTarget,
          (current) => ({
            ...current,
            [id]: { ...current[id], enabled: false },
          }),
        );
      }

      try {
        if (enabled) {
          await promptsApi.enablePrompt(appId, id, requestTarget);
          toast.success(t("prompts.enableSuccess"), { closeButton: true });
        } else {
          await promptsApi.upsertPrompt(
            appId,
            id,
            { ...visiblePrompts[id], enabled: false },
            requestTarget,
          );
          toast.success(t("prompts.disableSuccess"), { closeButton: true });
        }
        return currentContextKeyRef.current === requestContextKey &&
          currentTargetRef.current === requestTarget
          ? await reload()
          : false;
      } catch (error) {
        if (
          currentContextKeyRef.current === requestContextKey &&
          currentTargetRef.current === requestTarget &&
          reloadGenerationRef.current === mutationGeneration
        ) {
          updatePromptsForContext(
            requestContextKey,
            requestTarget,
            () => previousPrompts,
          );
        }
        toast.error(
          enabled ? t("prompts.enableFailed") : t("prompts.disableFailed"),
        );
        throw error;
      } finally {
        if (appId === "pi") setTogglingId(null);
      }
    },
    [
      appId,
      contextKey,
      reload,
      t,
      target,
      updatePromptsForContext,
      visiblePrompts,
    ],
  );

  const importFromFile = useCallback(async () => {
    const requestContextKey = contextKey;
    const requestTarget = target;
    try {
      const id = await promptsApi.importFromFile(appId, requestTarget);
      if (
        currentContextKeyRef.current === requestContextKey &&
        currentTargetRef.current === requestTarget
      ) {
        await reload();
      }
      toast.success(t("prompts.importSuccess"), { closeButton: true });
      return id;
    } catch (error) {
      toast.error(t("prompts.importFailed"));
      throw error;
    }
  }, [appId, contextKey, reload, t, target]);

  return {
    prompts: visiblePrompts,
    loading,
    currentFileContent: visibleCurrentFileContent,
    togglingId,
    reload,
    savePrompt,
    deletePrompt,
    enablePrompt,
    toggleEnabled,
    importFromFile,
  };
}
