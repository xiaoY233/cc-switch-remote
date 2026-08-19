import { invoke } from "@tauri-apps/api/core";
import { remoteApi, type ManagementTarget } from "./remote";

export type ManagedAuthProvider =
  | "github_copilot"
  | "codex_oauth"
  | "xai_oauth";

export interface ManagedAuthAccount {
  id: string;
  provider: ManagedAuthProvider;
  login: string;
  avatar_url: string | null;
  authenticated_at: number;
  is_default: boolean;
  github_domain: string;
  /** Codex-only: the account predates persisted id_token support. */
  reauth_required?: boolean;
  /** xAI-only: the refresh credential is invalid and the account is unusable. */
  requires_reauth: boolean;
}

export interface ManagedAuthStatus {
  provider: ManagedAuthProvider;
  authenticated: boolean;
  default_account_id: string | null;
  migration_error?: string | null;
  accounts: ManagedAuthAccount[];
}

export interface ManagedAuthDeviceCodeResponse {
  provider: ManagedAuthProvider;
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export async function authStartLogin(
  authProvider: ManagedAuthProvider,
  githubDomain?: string,
  target: ManagementTarget = { type: "local" },
): Promise<ManagedAuthDeviceCodeResponse> {
  if (target.type === "remote") {
    return remoteApi.authStartLogin(
      target.profile,
      authProvider,
      githubDomain,
      target.secret,
    );
  }
  return invoke<ManagedAuthDeviceCodeResponse>("auth_start_login", {
    authProvider,
    githubDomain: githubDomain || null,
  });
}

export async function authPollForAccount(
  authProvider: ManagedAuthProvider,
  deviceCode: string,
  githubDomain?: string,
  target: ManagementTarget = { type: "local" },
): Promise<ManagedAuthAccount | null> {
  if (target.type === "remote") {
    return remoteApi.authPollForAccount(
      target.profile,
      authProvider,
      deviceCode,
      githubDomain,
      target.secret,
    );
  }
  return invoke<ManagedAuthAccount | null>("auth_poll_for_account", {
    authProvider,
    deviceCode,
    githubDomain: githubDomain || null,
  });
}

export async function authListAccounts(
  authProvider: ManagedAuthProvider,
  target: ManagementTarget = { type: "local" },
): Promise<ManagedAuthAccount[]> {
  if (target.type === "remote") {
    return remoteApi.authListAccounts(
      target.profile,
      authProvider,
      target.secret,
    );
  }
  return invoke<ManagedAuthAccount[]>("auth_list_accounts", {
    authProvider,
  });
}

export async function authGetStatus(
  authProvider: ManagedAuthProvider,
  target: ManagementTarget = { type: "local" },
): Promise<ManagedAuthStatus> {
  if (target.type === "remote") {
    return remoteApi.authGetStatus(target.profile, authProvider, target.secret);
  }
  return invoke<ManagedAuthStatus>("auth_get_status", {
    authProvider,
  });
}

export async function authRemoveAccount(
  authProvider: ManagedAuthProvider,
  accountId: string,
  target: ManagementTarget = { type: "local" },
): Promise<void> {
  if (target.type === "remote") {
    return remoteApi.authRemoveAccount(
      target.profile,
      authProvider,
      accountId,
      target.secret,
    );
  }
  return invoke("auth_remove_account", {
    authProvider,
    accountId,
  });
}

export async function authSetDefaultAccount(
  authProvider: ManagedAuthProvider,
  accountId: string,
  target: ManagementTarget = { type: "local" },
): Promise<void> {
  if (target.type === "remote") {
    return remoteApi.authSetDefaultAccount(
      target.profile,
      authProvider,
      accountId,
      target.secret,
    );
  }
  return invoke("auth_set_default_account", {
    authProvider,
    accountId,
  });
}

export async function authLogout(
  authProvider: ManagedAuthProvider,
  target: ManagementTarget = { type: "local" },
): Promise<void> {
  if (target.type === "remote") {
    return remoteApi.authLogout(target.profile, authProvider, target.secret);
  }
  return invoke("auth_logout", {
    authProvider,
  });
}

export const authApi = {
  authStartLogin,
  authPollForAccount,
  authListAccounts,
  authGetStatus,
  authRemoveAccount,
  authSetDefaultAccount,
  authLogout,
};
