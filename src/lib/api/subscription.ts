import { invoke } from "@tauri-apps/api/core";
import { remoteApi, type ManagementTarget } from "./remote";
import type { SubscriptionQuota } from "@/types/subscription";

export const subscriptionApi = {
  getQuota: (
    tool: string,
    target: ManagementTarget = { type: "local" },
  ): Promise<SubscriptionQuota> => {
    if (target.type === "remote") {
      return remoteApi.getSubscriptionQuota(
        target.profile,
        tool,
        target.secret,
      );
    }

    return invoke("get_subscription_quota", { tool });
  },
  getCodexOauthQuota: (
    accountId: string | null,
    target: ManagementTarget = { type: "local" },
  ): Promise<SubscriptionQuota> => {
    if (target.type === "remote") {
      return remoteApi.getCodexOauthQuota(
        target.profile,
        accountId,
        target.secret,
      );
    }

    return invoke("get_codex_oauth_quota", { accountId });
  },
  getCodingPlanQuota: (
    baseUrl: string,
    apiKey: string,
    // 火山方舟用账号 AK/SK 签名查询用量；其他供应商不传。
    accessKeyId?: string,
    secretAccessKey?: string,
    target: ManagementTarget = { type: "local" },
  ): Promise<SubscriptionQuota> => {
    if (target.type === "remote") {
      return remoteApi.getCodingPlanQuota(
        target.profile,
        {
          baseUrl,
          apiKey,
          accessKeyId,
          secretAccessKey,
        },
        target.secret,
      );
    }

    return invoke("get_coding_plan_quota", {
      baseUrl,
      apiKey,
      accessKeyId,
      secretAccessKey,
    });
  },
  getBalance: (
    baseUrl: string,
    apiKey: string,
    target: ManagementTarget = { type: "local" },
  ): Promise<import("@/types").UsageResult> => {
    if (target.type === "remote") {
      return remoteApi.getBalance(
        target.profile,
        { baseUrl, apiKey },
        target.secret,
      );
    }

    return invoke("get_balance", { baseUrl, apiKey });
  },
};
