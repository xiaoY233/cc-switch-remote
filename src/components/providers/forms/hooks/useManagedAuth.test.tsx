import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useManagedAuth } from "./useManagedAuth";
import {
  authApi,
  remoteApi,
  settingsApi,
  type ManagementTarget,
  type RemoteHealth,
} from "@/lib/api";

vi.mock("@/lib/clipboard", () => ({
  copyText: vi.fn().mockResolvedValue(undefined),
}));

type RemoteTarget = Extract<ManagementTarget, { type: "remote" }>;

const target = (host: string, password: string): RemoteTarget => ({
  type: "remote",
  profile: {
    id: "same-profile",
    name: "Server",
    host,
    port: 22,
    username: "alice",
    authMethod: { type: "password" },
    helperPath: "~/.local/bin/cc-switch-remote-helper",
    createdAt: 1,
    updatedAt: 1,
  },
  secret: { password },
});

const deviceCode = {
  provider: "github_copilot" as const,
  device_code: "old-device",
  user_code: "OLD-CODE",
  verification_uri: "https://example.com/device",
  expires_in: 900,
  interval: 5,
};

function remoteHealth(capabilities: string[]): RemoteHealth {
  return {
    reachable: true,
    helperInstalled: true,
    helperUpdateAvailable: false,
    capabilities,
  };
}

function wrapper(queryClient: QueryClient) {
  return ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("useManagedAuth connection generation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(settingsApi, "openExternal").mockResolvedValue(undefined);
    vi.spyOn(remoteApi, "checkHealth").mockResolvedValue(remoteHealth([]));
    vi.spyOn(authApi, "authGetStatus").mockImplementation(async (provider) => ({
      provider,
      authenticated: false,
      default_account_id: null,
      accounts: [],
    }));
  });

  it("enables targeted Codex reauthentication only when the cached remote health reports support", async () => {
    vi.spyOn(remoteApi, "checkHealth").mockResolvedValue(
      remoteHealth(["auth", "auth-targeted-relogin"]),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderHook(
      () =>
        useManagedAuth("codex_oauth", undefined, target("host-a", "secret-a")),
      { wrapper: wrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isLoadingStatus).toBe(false));
    await waitFor(() => expect(result.current.canTargetedReauth).toBe(true));

    expect(remoteApi.checkHealth).toHaveBeenCalledWith(
      target("host-a", "secret-a").profile,
      target("host-a", "secret-a").secret,
    );
  });

  it("keeps targeted Codex reauthentication unavailable for an old remote helper", async () => {
    vi.spyOn(remoteApi, "checkHealth").mockResolvedValue(
      remoteHealth(["auth"]),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderHook(
      () =>
        useManagedAuth("codex_oauth", undefined, target("host-a", "secret-a")),
      { wrapper: wrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isLoadingStatus).toBe(false));
    await waitFor(() => expect(result.current.canTargetedReauth).toBe(false));
  });

  it("does not call remote auth commands when the helper lacks auth capability", async () => {
    vi.spyOn(remoteApi, "checkHealth").mockResolvedValue(
      remoteHealth(["providers"]),
    );
    const getStatus = vi.mocked(authApi.authGetStatus);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderHook(
      () =>
        useManagedAuth("codex_oauth", undefined, target("host-a", "secret-a")),
      { wrapper: wrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.isLoadingStatus).toBe(false));
    expect(result.current.isAuthSupported).toBe(false);
    expect(getStatus).not.toHaveBeenCalled();
  });

  it("does not cancel a remote Codex flow when an equivalent target object rerenders", async () => {
    vi.spyOn(authApi, "authStartLogin").mockResolvedValue({
      ...deviceCode,
      provider: "codex_oauth",
    });
    vi.spyOn(authApi, "authPollForAccount").mockResolvedValue(null);
    const cancelLogin = vi
      .spyOn(authApi, "authCancelLogin")
      .mockResolvedValue(true);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const first = target("host-a", "secret-a");
    const { result, rerender } = renderHook(
      ({ currentTarget }) =>
        useManagedAuth("codex_oauth", undefined, currentTarget),
      {
        initialProps: { currentTarget: first },
        wrapper: wrapper(queryClient),
      },
    );
    await waitFor(() => expect(result.current.isLoadingStatus).toBe(false));

    act(() => result.current.startAuth());
    await waitFor(() => expect(result.current.pollingState).toBe("polling"));

    rerender({ currentTarget: target("host-a", "secret-a") });
    await act(async () => Promise.resolve());

    expect(cancelLogin).not.toHaveBeenCalled();
    expect(result.current.pollingState).toBe("polling");
  });

  it("cancels the old remote Codex flow when the connection identity changes", async () => {
    vi.spyOn(authApi, "authStartLogin").mockResolvedValue({
      ...deviceCode,
      provider: "codex_oauth",
    });
    vi.spyOn(authApi, "authPollForAccount").mockResolvedValue(null);
    const cancelLogin = vi
      .spyOn(authApi, "authCancelLogin")
      .mockResolvedValue(true);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const first = target("host-a", "secret-a");
    const { result, rerender } = renderHook(
      ({ currentTarget }) =>
        useManagedAuth("codex_oauth", undefined, currentTarget),
      {
        initialProps: { currentTarget: first },
        wrapper: wrapper(queryClient),
      },
    );
    await waitFor(() => expect(result.current.isLoadingStatus).toBe(false));

    act(() => result.current.startAuth());
    await waitFor(() => expect(result.current.pollingState).toBe("polling"));

    rerender({ currentTarget: target("host-b", "secret-b") });

    await waitFor(() =>
      expect(cancelLogin).toHaveBeenCalledWith(
        "codex_oauth",
        "old-device",
        first,
      ),
    );
    expect(result.current.pollingState).toBe("idle");
  });

  it("drops a late device-code response after same-id credentials change", async () => {
    let resolveStart!: (value: typeof deviceCode) => void;
    const startLogin = vi.spyOn(authApi, "authStartLogin").mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStart = resolve;
        }),
    );
    const poll = vi
      .spyOn(authApi, "authPollForAccount")
      .mockResolvedValue(null);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const first = target("host-a", "secret-a");
    const second = target("host-b", "secret-b");
    const { result, rerender } = renderHook(
      ({ currentTarget }) =>
        useManagedAuth("github_copilot", undefined, currentTarget),
      {
        initialProps: { currentTarget: first },
        wrapper: wrapper(queryClient),
      },
    );
    await waitFor(() => expect(result.current.isLoadingStatus).toBe(false));

    act(() => result.current.startAuth());
    await waitFor(() => expect(startLogin).toHaveBeenCalledTimes(1));
    rerender({ currentTarget: second });
    await act(async () => resolveStart(deviceCode));

    await waitFor(() => expect(result.current.isAddingAccount).toBe(false));
    expect(result.current.deviceCode).toBeNull();
    expect(result.current.pollingState).toBe("idle");
    expect(poll).not.toHaveBeenCalled();
  });

  it("stops polling and ignores a late account after the target changes", async () => {
    vi.spyOn(authApi, "authStartLogin").mockResolvedValue(deviceCode);
    let resolvePoll!: (value: null) => void;
    const poll = vi.spyOn(authApi, "authPollForAccount").mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePoll = resolve;
        }),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const first = target("host-a", "secret-a");
    const { result, rerender } = renderHook(
      ({ currentTarget }) =>
        useManagedAuth("github_copilot", undefined, currentTarget),
      {
        initialProps: { currentTarget: first },
        wrapper: wrapper(queryClient),
      },
    );
    await waitFor(() => expect(result.current.isLoadingStatus).toBe(false));
    act(() => result.current.startAuth());
    await waitFor(() => expect(poll).toHaveBeenCalledTimes(1));

    rerender({ currentTarget: target("host-b", "secret-b") });
    await act(async () => resolvePoll(null));

    await waitFor(() => expect(result.current.pollingState).toBe("idle"));
    expect(result.current.deviceCode).toBeNull();
  });

  it("exposes logout as pending until the selected target finishes logging out", async () => {
    let resolveLogout!: () => void;
    vi.spyOn(authApi, "authLogout").mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveLogout = resolve;
        }),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderHook(
      () =>
        useManagedAuth(
          "github_copilot",
          undefined,
          target("host-a", "secret-a"),
        ),
      { wrapper: wrapper(queryClient) },
    );
    await waitFor(() => expect(result.current.isLoadingStatus).toBe(false));

    act(() => result.current.logout());
    await waitFor(() => expect(result.current.isLoggingOut).toBe(true));

    await act(async () => resolveLogout());
    await waitFor(() => expect(result.current.isLoggingOut).toBe(false));
  });
});
