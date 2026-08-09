import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RemoteSettingsPage } from "@/components/settings/RemoteSettingsPage";
import {
  authApi,
  remoteApi,
  settingsApi,
  type ManagedAuthProvider,
  type RemoteHostProfile,
} from "@/lib/api";
import type { Settings } from "@/types";

const profile: RemoteHostProfile = {
  id: "logout-host",
  name: "Logout Host",
  host: "192.0.2.44",
  port: 22,
  username: "alice",
  authMethod: { type: "password" },
  helperPath: "~/.local/bin/cc-switch-remote-helper",
  createdAt: 1,
  updatedAt: 1,
};

const settings = {
  showInTray: true,
  minimizeToTrayOnClose: true,
  useAppWindowControls: false,
  enableClaudePluginIntegration: false,
  skipClaudeOnboarding: false,
  launchOnStartup: false,
  silentStartup: false,
  enableLocalProxy: false,
} as Settings;

function wrapper(queryClient: QueryClient) {
  return ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("remote managed-auth logout busy wiring", () => {
  beforeEach(() => {
    vi.spyOn(remoteApi, "checkHealth").mockResolvedValue({
      reachable: true,
      helperInstalled: true,
      helperVersion: "3.19.2",
      platform: "linux",
      capabilities: ["settings", "auth"],
    });
    vi.spyOn(remoteApi, "getSettings").mockResolvedValue(settings);
    vi.spyOn(remoteApi, "getInstalledSkills").mockResolvedValue([]);
    vi.spyOn(settingsApi, "openExternal").mockResolvedValue(undefined);
    vi.spyOn(authApi, "authGetStatus").mockImplementation(
      async (provider: ManagedAuthProvider) => ({
        provider,
        authenticated: provider === "github_copilot",
        default_account_id:
          provider === "github_copilot" ? "copilot-account-a" : null,
        accounts:
          provider === "github_copilot"
            ? [
                {
                  id: "copilot-account-a",
                  provider,
                  login: "a@example.com",
                  avatar_url: null,
                  authenticated_at: 1,
                  is_default: true,
                  github_domain: "github.com",
                  requires_reauth: false,
                },
                {
                  id: "copilot-account-b",
                  provider,
                  login: "b@example.com",
                  avatar_url: null,
                  authenticated_at: 2,
                  is_default: false,
                  github_domain: "github.com",
                  requires_reauth: false,
                },
              ]
            : [],
      }),
    );
  });

  it("locks the page through the real hook, section, and Auth Center while logout is pending", async () => {
    let resolveLogout!: () => void;
    const logout = vi.spyOn(authApi, "authLogout").mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveLogout = resolve;
        }),
    );
    const onInteractionBlockedChange = vi.fn();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const Wrapper = wrapper(queryClient);
    const user = userEvent.setup();

    render(
      <Wrapper>
        <RemoteSettingsPage
          open
          onOpenChange={vi.fn()}
          defaultTab="auth"
          onInteractionBlockedChange={onInteractionBlockedChange}
          target={{
            type: "remote",
            profile,
            secret: { password: "secret" },
          }}
        />
      </Wrapper>,
    );

    const logoutButton = await screen.findByRole("button", {
      name: "注销所有账号",
    });
    await waitFor(() => expect(onInteractionBlockedChange).toHaveBeenLastCalledWith(false));
    await user.click(logoutButton);

    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(logoutButton).toBeDisabled());
    await waitFor(() =>
      expect(onInteractionBlockedChange).toHaveBeenLastCalledWith(true),
    );

    resolveLogout();
    await waitFor(() =>
      expect(onInteractionBlockedChange).toHaveBeenLastCalledWith(false),
    );
  });
});
