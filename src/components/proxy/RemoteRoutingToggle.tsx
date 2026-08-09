import { Loader2, Radio } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Switch } from "@/components/ui/switch";
import { useProxyStatus } from "@/hooks/useProxyStatus";
import type { ManagementTarget } from "@/lib/api";
import { cn } from "@/lib/utils";

interface RemoteRoutingToggleProps {
  className?: string;
  target: Extract<ManagementTarget, { type: "remote" }>;
}

export function RemoteRoutingToggle({
  className,
  target,
}: RemoteRoutingToggleProps) {
  const { t } = useTranslation();
  const {
    status,
    isRunning,
    startProxyServer,
    stopWithRestore,
    isStarting,
    isStopping,
    isLoading,
  } = useProxyStatus(target);

  const isPending = isStarting || isStopping || isLoading;

  const handleToggle = async (checked: boolean) => {
    try {
      if (checked) {
        await startProxyServer();
      } else {
        await stopWithRestore();
      }
    } catch (error) {
      console.error(
        "[RemoteRoutingToggle] Toggle remote routing failed",
        error,
      );
    }
  };

  const tooltipText = isRunning
    ? t("remote.routing.tooltip.active", {
        address: status?.address,
        port: status?.port,
        defaultValue: `远程路由已启动 - ${status?.address}:${status?.port}`,
      })
    : t("remote.routing.tooltip.inactive", {
        defaultValue: "启动远程主机上的路由代理服务",
      });

  return (
    <div
      data-testid="remote-routing-toggle"
      className={cn(
        "flex items-center gap-1 px-1.5 h-8 rounded-lg bg-muted/50 transition-all",
        className,
      )}
      title={tooltipText}
    >
      {isPending ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : (
        <Radio
          className={cn(
            "h-4 w-4 transition-colors",
            isRunning
              ? "text-emerald-500 status-heartbeat"
              : "text-muted-foreground",
          )}
        />
      )}
      <Switch
        checked={isRunning}
        onCheckedChange={handleToggle}
        disabled={isPending}
      />
    </div>
  );
}
