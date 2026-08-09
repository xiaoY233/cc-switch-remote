import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useManagedAuth } from "./useManagedAuth";
import { authApi, settingsApi, type ManagementTarget } from "@/lib/api";

vi.mock("@/lib/clipboard", () => ({ copyText: vi.fn().mockResolvedValue(undefined) }));

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

function wrapper(queryClient: QueryClient) {
  return ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("useManagedAuth connection generation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(settingsApi, "openExternal").mockResolvedValue(undefined);
    vi.spyOn(authApi, "authGetStatus").mockImplementation(
      async (provider) => ({
        provider,
        authenticated: false,
        default_account_id: null,
        accounts: [],
      }),
    );
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
    const poll = vi
      .spyOn(authApi, "authPollForAccount")
      .mockImplementation(
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
});
