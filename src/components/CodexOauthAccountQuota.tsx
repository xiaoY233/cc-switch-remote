import React from "react";
import { Loader2 } from "lucide-react";
import { useCodexOauthQuotaByAccountId } from "@/lib/query/subscription";
import { SubscriptionQuotaView } from "@/components/SubscriptionQuotaFooter";
import type { ManagementTarget } from "@/lib/api";

interface CodexOauthAccountQuotaProps {
  accountId: string;
  target?: ManagementTarget;
}

const CodexOauthAccountQuota: React.FC<CodexOauthAccountQuotaProps> = ({
  accountId,
  target,
}) => {
  const {
    data: quota,
    isFetching: loading,
    refetch,
  } = useCodexOauthQuotaByAccountId(accountId, {
    enabled: true,
    autoQuery: false,
    target,
  });

  if (loading && !quota) {
    return (
      <div className="mt-3 flex items-center justify-center rounded-xl border border-border-default bg-card py-5 shadow-sm">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <SubscriptionQuotaView
      quota={quota}
      loading={loading}
      refetch={refetch}
      appIdForExpiredHint="codex_oauth"
      inline={false}
    />
  );
};

export default CodexOauthAccountQuota;
