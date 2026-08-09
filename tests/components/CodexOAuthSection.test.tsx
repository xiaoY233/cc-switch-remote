import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodexOAuthSection } from "@/components/providers/forms/CodexOAuthSection";
import { AuthCenterPanel } from "@/components/settings/AuthCenterPanel";
import type { ManagementTarget, RemoteHostProfile } from "@/lib/api";

const mocks = vi.hoisted(() => ({
  useCodexOauth: vi.fn(),
  renderAccountQuota: vi.fn(),
}));

vi.mock("@/components/providers/forms/hooks/useCodexOauth", () => ({
  useCodexOauth: mocks.useCodexOauth,
}));

vi.mock("@/components/CodexOauthAccountQuota", () => ({
  default: ({
    accountId,
    target,
  }: {
    accountId: string;
    target?: ManagementTarget;
  }) => {
    mocks.renderAccountQuota(accountId, target);
    return <div data-testid="account-quota">{accountId}</div>;
  },
}));

vi.mock("@/components/providers/forms/CopilotAuthSection", () => ({
  CopilotAuthSection: () => <div />,
}));

vi.mock("@/components/providers/forms/XaiOAuthSection", () => ({
  XaiOAuthSection: () => <div />,
}));

const remoteProfile: RemoteHostProfile = {
  id: "server-a",
  name: "Server A",
  host: "192.0.2.10",
  port: 22,
  username: "root",
  authMethod: { type: "sshAgent" },
  helperPath: "/root/.local/bin/cc-switch-remote-helper",
  createdAt: 1,
  updatedAt: 1,
};

const remoteTarget: ManagementTarget = {
  type: "remote",
  profile: remoteProfile,
  secret: { password: "secret" },
};

const authState = (accountId: string) => ({
  accounts: [
    {
      id: accountId,
      provider: "codex_oauth",
      login: `${accountId}@example.com`,
      avatar_url: null,
      authenticated_at: 0,
      is_default: true,
      github_domain: "",
    },
  ],
  defaultAccountId: accountId,
  hasAnyAccount: true,
  pollingState: "idle",
  deviceCode: null,
  error: null,
  isPolling: false,
  isAddingAccount: false,
  isRemovingAccount: false,
  isSettingDefaultAccount: false,
  addAccount: vi.fn(),
  removeAccount: vi.fn(),
  setDefaultAccount: vi.fn(),
  cancelAuth: vi.fn(),
  logout: vi.fn(),
});

describe("CodexOAuthSection", () => {
  beforeEach(() => {
    mocks.renderAccountQuota.mockReset();
    mocks.useCodexOauth.mockImplementation((target?: ManagementTarget) =>
      authState(target?.type === "remote" ? "remote-account" : "local-account"),
    );
  });

  afterEach(cleanup);

  it("does not render account quota by default", () => {
    render(<CodexOAuthSection />);

    expect(mocks.renderAccountQuota).not.toHaveBeenCalled();
    expect(screen.queryByTestId("account-quota")).not.toBeInTheDocument();
  });

  it("renders only remote account quotas with the remote Auth Center target", () => {
    render(<AuthCenterPanel target={remoteTarget} />);

    expect(mocks.useCodexOauth).toHaveBeenCalledWith(remoteTarget);
    expect(mocks.renderAccountQuota).toHaveBeenCalledWith(
      "remote-account",
      remoteTarget,
    );
    expect(mocks.renderAccountQuota).not.toHaveBeenCalledWith(
      "local-account",
      expect.anything(),
    );
    expect(screen.getByTestId("account-quota")).toHaveTextContent(
      "remote-account",
    );
  });
});
