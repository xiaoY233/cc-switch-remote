import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authApi, remoteApi, settingsApi } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import {
  getManagementTargetKey,
  LOCAL_MANAGEMENT_TARGET,
} from "@/lib/managementTarget";
import type {
  ManagementTarget,
  ManagedAuthProvider,
  ManagedAuthStatus,
  ManagedAuthDeviceCodeResponse,
} from "@/lib/api";
import { useTargetQueryIdentityReset } from "@/hooks/useTargetQueryIdentityReset";

type PollingState = "idle" | "polling" | "success" | "error";
type LoginRequest = {
  targetAccountId?: string;
  generation: number;
  connectionGeneration: number;
};

export function useManagedAuth(
  authProvider: ManagedAuthProvider,
  githubDomain?: string,
  target: ManagementTarget = LOCAL_MANAGEMENT_TARGET,
) {
  const queryClient = useQueryClient();
  const targetKey = getManagementTargetKey(target);
  const queryKey = useMemo(
    () => ["managed-auth-status", targetKey, authProvider],
    [authProvider, targetKey],
  );
  const connectionGeneration = useTargetQueryIdentityReset(
    "all",
    target,
    targetKey,
  );
  const connectionTargetRef = useRef({
    generation: connectionGeneration,
    target,
  });
  if (connectionTargetRef.current.generation !== connectionGeneration) {
    connectionTargetRef.current = { generation: connectionGeneration, target };
  }
  const connectionTarget = connectionTargetRef.current.target;
  const connectionGenerationRef = useRef(connectionGeneration);
  connectionGenerationRef.current = connectionGeneration;
  const isCurrentGeneration = useCallback(
    (generation: number) => connectionGenerationRef.current === generation,
    [],
  );

  const [pollingState, setPollingState] = useState<PollingState>("idle");
  const [deviceCode, setDeviceCode] =
    useState<ManagedAuthDeviceCodeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const pollingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flowGenerationRef = useRef(0);
  const activeDeviceCodeRef = useRef<string | null>(null);
  const retryTargetAccountIdRef = useRef<string | undefined>(undefined);
  const flowTransitionRef = useRef<Promise<void>>(Promise.resolve());

  const remoteHealthQuery = useQuery({
    queryKey: ["remote-health", targetKey, connectionGeneration],
    queryFn: () => {
      if (target.type !== "remote") return null;
      return remoteApi.checkHealth(target.profile, target.secret);
    },
    enabled: target.type === "remote",
    retry: false,
    staleTime: 30_000,
  });
  const isAuthSupported =
    target.type === "local" ||
    remoteHealthQuery.data?.capabilities.includes("auth") === true;
  const canTargetedReauth =
    isAuthSupported &&
    (target.type === "local" ||
      (authProvider === "codex_oauth" &&
        remoteHealthQuery.data?.capabilities.includes(
          "auth-targeted-relogin",
        ) === true));

  const {
    data: authStatus,
    isLoading: isAuthStatusLoading,
    isSuccess: isAuthStatusSuccess,
    isError: isAuthStatusError,
    refetch: refetchStatus,
  } = useQuery<ManagedAuthStatus>({
    queryKey,
    queryFn: () => authApi.authGetStatus(authProvider, target),
    enabled: isAuthSupported,
    staleTime: 30000,
    // A rejected xAI refresh token is persisted as `requires_reauth` by the
    // proxy hot path. Periodically refresh local status so an already-open Auth
    // Center stops showing the account as logged in without requiring a reload.
    refetchInterval: authProvider === "xai_oauth" ? 15_000 : false,
  });

  const refetchManagedAuthStatus = useCallback(async () => {
    if (target.type === "remote") {
      const health = await remoteHealthQuery.refetch();
      if (health.data?.capabilities.includes("auth") !== true) return health;
    }
    return refetchStatus();
  }, [refetchStatus, remoteHealthQuery, target.type]);

  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    if (pollingTimeoutRef.current) {
      clearTimeout(pollingTimeoutRef.current);
      pollingTimeoutRef.current = null;
    }
  }, []);

  const cancelBackendFlow = useCallback(
    async (activeDeviceCode: string | null): Promise<boolean> => {
      if (authProvider !== "codex_oauth" || !activeDeviceCode) return true;
      try {
        const cancelled = await authApi.authCancelLogin(
          authProvider,
          activeDeviceCode,
          connectionTarget,
        );
        if (!cancelled) {
          await queryClient.invalidateQueries({ queryKey });
        }
        return cancelled;
      } catch (e) {
        console.debug("[ManagedAuth] Failed to cancel device flow:", e);
        await queryClient.invalidateQueries({ queryKey });
        return false;
      }
    },
    [authProvider, connectionTarget, queryClient, queryKey],
  );

  const queueBackendCancellation = useCallback(
    (activeDeviceCode: string | null) => {
      const transition = flowTransitionRef.current.then(async () => {
        await cancelBackendFlow(activeDeviceCode);
      });
      flowTransitionRef.current = transition;
      return transition;
    },
    [cancelBackendFlow],
  );

  useEffect(() => {
    return () => {
      flowGenerationRef.current += 1;
      void cancelBackendFlow(activeDeviceCodeRef.current);
      activeDeviceCodeRef.current = null;
      stopPolling();
    };
  }, [cancelBackendFlow, stopPolling]);

  useEffect(() => {
    stopPolling();
    setPollingState("idle");
    setDeviceCode(null);
    setError(null);
  }, [connectionGeneration, stopPolling]);

  const startLoginMutation = useMutation({
    mutationFn: async ({
      targetAccountId,
      connectionGeneration: requestConnectionGeneration,
    }: LoginRequest) => ({
      response: await authApi.authStartLogin(
        authProvider,
        githubDomain,
        target,
        targetAccountId,
      ),
      connectionGeneration: requestConnectionGeneration,
    }),
    onSuccess: async (
      { response, connectionGeneration: requestGeneration },
      request,
    ) => {
      if (
        !isCurrentGeneration(requestGeneration) ||
        request.generation !== flowGenerationRef.current
      ) {
        void cancelBackendFlow(response.device_code);
        return;
      }
      activeDeviceCodeRef.current = response.device_code;
      setDeviceCode(response);
      setPollingState("polling");
      setError(null);

      try {
        await copyText(response.user_code);
      } catch (e) {
        console.debug("[ManagedAuth] Failed to copy user code:", e);
      }
      if (
        !isCurrentGeneration(requestGeneration) ||
        request.generation !== flowGenerationRef.current
      ) {
        return;
      }

      // Device-code login can be completed in a browser, but only the local
      // target may launch one. Remote users retain the verification URL in UI.
      if (target.type === "local") {
        try {
          await settingsApi.openExternal(response.verification_uri);
        } catch (e) {
          console.debug("[ManagedAuth] Failed to open browser:", e);
        }
      }
      if (
        !isCurrentGeneration(requestGeneration) ||
        request.generation !== flowGenerationRef.current
      ) {
        return;
      }

      // Add a small buffer on top of GitHub's suggested interval to avoid
      // hitting slow_down responses too aggressively during device polling.
      const interval = Math.max((response.interval || 5) + 3, 8) * 1000;
      const expiresAt = Date.now() + response.expires_in * 1000;

      const pollOnce = async () => {
        if (
          !isCurrentGeneration(requestGeneration) ||
          request.generation !== flowGenerationRef.current
        ) {
          stopPolling();
          return;
        }
        if (Date.now() > expiresAt) {
          stopPolling();
          activeDeviceCodeRef.current = null;
          void cancelBackendFlow(response.device_code);
          flowGenerationRef.current += 1;
          setPollingState("error");
          setError("Device code expired. Please try again.");
          return;
        }

        try {
          const newAccount = await authApi.authPollForAccount(
            authProvider,
            response.device_code,
            githubDomain,
            target,
          );
          if (
            !isCurrentGeneration(requestGeneration) ||
            request.generation !== flowGenerationRef.current
          ) {
            stopPolling();
            return;
          }
          if (newAccount) {
            stopPolling();
            activeDeviceCodeRef.current = null;
            flowGenerationRef.current += 1;
            const completionGeneration = flowGenerationRef.current;
            setPollingState("success");
            await refetchStatus();
            await queryClient.invalidateQueries({ queryKey });
            if (
              !isCurrentGeneration(requestGeneration) ||
              completionGeneration !== flowGenerationRef.current
            ) {
              return;
            }
            setPollingState("idle");
            setDeviceCode(null);
          }
        } catch (e) {
          if (
            !isCurrentGeneration(requestGeneration) ||
            request.generation !== flowGenerationRef.current
          ) {
            return;
          }
          const errorMessage = e instanceof Error ? e.message : String(e);
          if (
            !errorMessage.includes("pending") &&
            !errorMessage.includes("slow_down")
          ) {
            stopPolling();
            activeDeviceCodeRef.current = null;
            void cancelBackendFlow(response.device_code);
            flowGenerationRef.current += 1;
            setPollingState("error");
            setError(errorMessage);
          }
        }
      };

      pollingIntervalRef.current = setInterval(pollOnce, interval);
      pollingTimeoutRef.current = setTimeout(() => {
        if (
          !isCurrentGeneration(requestGeneration) ||
          request.generation !== flowGenerationRef.current
        ) {
          return;
        }
        stopPolling();
        activeDeviceCodeRef.current = null;
        void cancelBackendFlow(response.device_code);
        flowGenerationRef.current += 1;
        setPollingState("error");
        setError("Device code expired. Please try again.");
      }, response.expires_in * 1000);
      void pollOnce();
    },
    onError: (e, request) => {
      if (
        !isCurrentGeneration(request.connectionGeneration) ||
        request.generation !== flowGenerationRef.current
      ) {
        return;
      }
      setPollingState("error");
      setError(e instanceof Error ? e.message : String(e));
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await authApi.authLogout(authProvider, target);
      return connectionGeneration;
    },
    onSuccess: async (generation) => {
      if (!isCurrentGeneration(generation)) return;
      setPollingState("idle");
      setDeviceCode(null);
      setError(null);
      queryClient.setQueryData(queryKey, {
        provider: authProvider,
        authenticated: false,
        default_account_id: null,
        accounts: [],
      });
      await queryClient.invalidateQueries({ queryKey });
    },
    onError: async (e) => {
      console.error("[ManagedAuth] Failed to logout:", e);
      setError(e instanceof Error ? e.message : String(e));
      await refetchStatus();
    },
  });

  const removeAccountMutation = useMutation({
    mutationFn: async ({ accountId }: { accountId: string }) => {
      await authApi.authRemoveAccount(authProvider, accountId, target);
      return connectionGeneration;
    },
    onSuccess: async (generation) => {
      if (!isCurrentGeneration(generation)) return;
      setPollingState("idle");
      setDeviceCode(null);
      setError(null);
      await refetchStatus();
      await queryClient.invalidateQueries({ queryKey });
    },
    onError: (e) => {
      console.error("[ManagedAuth] Failed to remove account:", e);
      setError(e instanceof Error ? e.message : String(e));
    },
  });

  const setDefaultAccountMutation = useMutation({
    mutationFn: async ({ accountId }: { accountId: string }) => {
      await authApi.authSetDefaultAccount(authProvider, accountId, target);
      return connectionGeneration;
    },
    onSuccess: async (generation) => {
      if (!isCurrentGeneration(generation)) return;
      await refetchStatus();
      await queryClient.invalidateQueries({ queryKey });
    },
    onError: (e) => {
      console.error("[ManagedAuth] Failed to set default account:", e);
      setError(e instanceof Error ? e.message : String(e));
    },
  });

  const beginLogin = useCallback(
    (targetAccountId?: string) => {
      const previousDeviceCode = activeDeviceCodeRef.current;
      activeDeviceCodeRef.current = null;
      const generation = flowGenerationRef.current + 1;
      flowGenerationRef.current = generation;
      retryTargetAccountIdRef.current = targetAccountId;
      setPollingState("idle");
      setDeviceCode(null);
      setError(null);
      stopPolling();
      void queueBackendCancellation(previousDeviceCode).then(() => {
        if (generation !== flowGenerationRef.current) return;
        startLoginMutation.mutate({
          targetAccountId,
          generation,
          connectionGeneration,
        });
      });
    },
    [
      connectionGeneration,
      queueBackendCancellation,
      startLoginMutation,
      stopPolling,
    ],
  );

  const startAuth = useCallback(() => beginLogin(), [beginLogin]);

  const reauthAccount = useCallback(
    (accountId: string) => {
      beginLogin(accountId);
    },
    [beginLogin],
  );

  const retryAuth = useCallback(
    () => beginLogin(retryTargetAccountIdRef.current),
    [beginLogin],
  );

  const cancelAuth = useCallback(() => {
    flowGenerationRef.current += 1;
    const previousDeviceCode = activeDeviceCodeRef.current;
    activeDeviceCodeRef.current = null;
    retryTargetAccountIdRef.current = undefined;
    stopPolling();
    setPollingState("idle");
    setDeviceCode(null);
    setError(null);
    void queueBackendCancellation(previousDeviceCode);
  }, [queueBackendCancellation, stopPolling]);

  const logout = useCallback(() => {
    logoutMutation.mutate();
  }, [logoutMutation]);

  const removeAccount = useCallback(
    (accountId: string) => {
      removeAccountMutation.mutate({ accountId });
    },
    [removeAccountMutation],
  );

  const setDefaultAccount = useCallback(
    (accountId: string) => {
      setDefaultAccountMutation.mutate({ accountId });
    },
    [setDefaultAccountMutation],
  );

  const accounts = authStatus?.accounts ?? [];

  return {
    authStatus,
    isAuthSupported,
    isLoadingStatus:
      isAuthStatusLoading ||
      (target.type === "remote" && remoteHealthQuery.isLoading),
    isStatusSuccess: isAuthSupported && isAuthStatusSuccess,
    isStatusError: remoteHealthQuery.isError || isAuthStatusError,
    accounts,
    hasAnyAccount: accounts.length > 0,
    isAuthenticated: authStatus?.authenticated ?? false,
    defaultAccountId: authStatus?.default_account_id ?? null,
    migrationError: authStatus?.migration_error ?? null,
    pollingState,
    deviceCode,
    error,
    isPolling: pollingState === "polling",
    isAddingAccount: startLoginMutation.isPending || pollingState === "polling",
    isLoggingOut: logoutMutation.isPending,
    isRemovingAccount: removeAccountMutation.isPending,
    isSettingDefaultAccount: setDefaultAccountMutation.isPending,
    startAuth,
    addAccount: startAuth,
    canTargetedReauth,
    reauthAccount,
    retryAuth,
    cancelAuth,
    logout,
    removeAccount,
    setDefaultAccount,
    refetchStatus: refetchManagedAuthStatus,
  };
}
