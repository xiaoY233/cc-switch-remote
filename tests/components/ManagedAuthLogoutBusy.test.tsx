import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CodexOAuthSection } from "@/components/providers/forms/CodexOAuthSection";
import { CopilotAuthSection } from "@/components/providers/forms/CopilotAuthSection";
import { XaiOAuthSection } from "@/components/providers/forms/XaiOAuthSection";

const mocks = vi.hoisted(() => ({
  useCodexOauth: vi.fn(),
  useCopilotAuth: vi.fn(),
  useXaiOauth: vi.fn(),
}));

vi.mock("@/components/providers/forms/hooks/useCodexOauth", () => ({
  useCodexOauth: mocks.useCodexOauth,
}));
vi.mock("@/components/providers/forms/hooks/useCopilotAuth", () => ({
  useCopilotAuth: mocks.useCopilotAuth,
}));
vi.mock("@/components/providers/forms/hooks/useXaiOauth", () => ({
  useXaiOauth: mocks.useXaiOauth,
}));

const accounts = [
  {
    id: "account-a",
    provider: "codex_oauth",
    login: "a@example.com",
    avatar_url: null,
    authenticated_at: 1,
    is_default: true,
    github_domain: "github.com",
    requires_reauth: false,
  },
  {
    id: "account-b",
    provider: "codex_oauth",
    login: "b@example.com",
    avatar_url: null,
    authenticated_at: 2,
    is_default: false,
    github_domain: "github.com",
    requires_reauth: false,
  },
];

const pendingLogoutState = () => ({
  accounts,
  defaultAccountId: "account-a",
  migrationError: null,
  hasAnyAccount: true,
  isAuthenticated: true,
  pollingState: "idle",
  deviceCode: null,
  error: null,
  isPolling: false,
  isAddingAccount: false,
  isLoggingOut: true,
  isRemovingAccount: false,
  isSettingDefaultAccount: false,
  addAccount: vi.fn(),
  removeAccount: vi.fn(),
  setDefaultAccount: vi.fn(),
  cancelAuth: vi.fn(),
  logout: vi.fn(),
});

describe("managed auth logout interaction lock", () => {
  it.each([
    ["Codex", mocks.useCodexOauth, CodexOAuthSection, /注销所有账号/],
    ["Copilot", mocks.useCopilotAuth, CopilotAuthSection, /注销所有账号/],
    ["xAI", mocks.useXaiOauth, XaiOAuthSection, /移除所有 xAI 账号/],
  ])(
    "%s section reports pending logout and disables the destructive button",
    async (_name, hook, Section, logoutName) => {
      hook.mockReturnValue(pendingLogoutState());
      const onBusyChange = vi.fn();

      render(<Section onBusyChange={onBusyChange} />);

      await waitFor(() =>
        expect(onBusyChange).toHaveBeenLastCalledWith(true),
      );
      expect(screen.getByRole("button", { name: logoutName })).toBeDisabled();
    },
  );
});
