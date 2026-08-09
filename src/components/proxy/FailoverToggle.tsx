/**
 * 故障转移切换开关组件
 *
 * 放置在主界面头部，用于一键启用/关闭自动故障转移
 */

import { Shuffle, Loader2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  useAutoFailoverEnabled,
  useSetAutoFailoverEnabled,
} from "@/lib/query/failover";
import { useAppProxyConfig } from "@/lib/query/proxy";
import { useProxyStatus } from "@/hooks/useProxyStatus";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import type { AppId, ManagementTarget } from "@/lib/api";
import { LOCAL_MANAGEMENT_TARGET } from "@/lib/managementTarget";

interface FailoverToggleProps {
  className?: string;
  activeApp: AppId;
  target?: ManagementTarget;
}

export function FailoverToggle({
  className,
  activeApp,
  target = LOCAL_MANAGEMENT_TARGET,
}: FailoverToggleProps) {
  const { t } = useTranslation();
  const { data: isEnabled = false, isLoading } = useAutoFailoverEnabled(
    activeApp,
    target,
  );
  const setEnabled = useSetAutoFailoverEnabled(target);
  const { isRunning, takeoverStatus } = useProxyStatus(target);
  const isLocalTarget = target.type === "local";
  const { data: remoteAppConfig } = useAppProxyConfig(activeApp, target);
  const routingReady = isLocalTarget
    ? (takeoverStatus?.[activeApp] ?? false)
    : isRunning && (remoteAppConfig?.enabled ?? false);

  const handleToggle = (checked: boolean) => {
    if (checked && !routingReady) return;
    setEnabled.mutate({ appType: activeApp, enabled: checked });
  };

  const appLabel =
    activeApp === "claude"
      ? "Claude"
      : activeApp === "codex"
        ? "Codex"
        : activeApp === "grokbuild"
          ? "Grok Build"
          : "Gemini";

  const tooltipText = !routingReady
    ? isLocalTarget
      ? t("failover.tooltip.takeoverRequired", {
          app: appLabel,
          defaultValue: `请先接管 ${appLabel}，再启用故障转移`,
        })
      : t("remote.routing.failover.tooltip.routingRequired", {
          app: appLabel,
          defaultValue: `请先启动远程路由并启用 ${appLabel} 路由，再启用故障转移`,
        })
    : isEnabled
      ? t("failover.tooltip.enabled", {
          app: appLabel,
          defaultValue: `${appLabel} 故障转移已启用\n按队列优先级（P1→P2→...）选择供应商`,
        })
      : t("failover.tooltip.disabled", {
          app: appLabel,
          defaultValue: `启用 ${appLabel} 故障转移\n将立即切换到队列 P1，并在失败时自动切换到下一个`,
        });

  return (
    <div
      className={cn(
        "flex items-center gap-1 px-1.5 h-8 rounded-lg bg-muted/50 transition-all",
        className,
      )}
      title={tooltipText}
    >
      {setEnabled.isPending || isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : (
        <Shuffle
          className={cn(
            "h-4 w-4 transition-colors",
            isEnabled
              ? "text-emerald-500 status-heartbeat"
              : "text-muted-foreground",
          )}
        />
      )}
      <Switch
        checked={isEnabled}
        onCheckedChange={handleToggle}
        disabled={setEnabled.isPending || isLoading || !routingReady}
      />
    </div>
  );
}
