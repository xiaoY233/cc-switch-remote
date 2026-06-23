import { useQuery } from "@tanstack/react-query";
import { copilotGetUsageForTarget } from "@/lib/api/copilot";
import type { ManagementTarget } from "@/lib/api";
import type { QuotaTier } from "@/types/subscription";

const REFETCH_INTERVAL = 5 * 60 * 1000; // 5 minutes

export interface CopilotQuota {
  success: boolean;
  plan: string | null;
  resetDate: string | null;
  tiers: QuotaTier[];
  error: string | null;
  queriedAt: number | null;
}

export interface UseCopilotQuotaOptions {
  enabled?: boolean;
  /** 是否启用自动轮询（5 分钟）与窗口 focus 重取 */
  autoQuery?: boolean;
  target?: ManagementTarget;
}

export function useCopilotQuota(
  accountId: string | null,
  options: UseCopilotQuotaOptions = {},
) {
  const { enabled = true, autoQuery = false, target = { type: "local" } } = options;
  const targetKey =
    target.type === "remote" ? `remote:${target.profile.id}` : "local";
  return useQuery<CopilotQuota>({
    queryKey: ["copilot", "quota", targetKey, accountId ?? "default"],
    queryFn: async (): Promise<CopilotQuota> => {
      const usage = await copilotGetUsageForTarget(accountId, target);

      const premium = usage.quota_snapshots.premium_interactions;
      const utilization =
        premium.entitlement > 0
          ? ((premium.entitlement - premium.remaining) / premium.entitlement) *
            100
          : 0;

      return {
        success: true,
        plan: usage.copilot_plan,
        resetDate: usage.quota_reset_date,
        tiers: [
          {
            name: "premium",
            utilization,
            resetsAt: usage.quota_reset_date,
          },
        ],
        error: null,
        queriedAt: Date.now(),
      };
    },
    enabled,
    refetchInterval: autoQuery ? REFETCH_INTERVAL : false,
    refetchIntervalInBackground: autoQuery,
    refetchOnWindowFocus: autoQuery,
    staleTime: REFETCH_INTERVAL,
    retry: 1,
  });
}
