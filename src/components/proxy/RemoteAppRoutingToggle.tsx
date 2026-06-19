import { Loader2, RadioTower } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Switch } from "@/components/ui/switch";
import { useProxyStatus } from "@/hooks/useProxyStatus";
import { useAppProxyConfig, useUpdateAppProxyConfig } from "@/lib/query/proxy";
import type { AppId, ManagementTarget } from "@/lib/api";
import { cn } from "@/lib/utils";

interface RemoteAppRoutingToggleProps {
  className?: string;
  activeApp: Extract<AppId, "claude" | "codex" | "gemini">;
  target: Extract<ManagementTarget, { type: "remote" }>;
}

function appLabel(app: string): string {
  if (app === "claude") return "Claude";
  if (app === "codex") return "Codex";
  return "Gemini";
}

export function RemoteAppRoutingToggle({
  className,
  activeApp,
  target,
}: RemoteAppRoutingToggleProps) {
  const { t } = useTranslation();
  const { isRunning, startProxyServer, isStarting } = useProxyStatus(target);
  const { data: config, isLoading } = useAppProxyConfig(activeApp, target);
  const updateConfig = useUpdateAppProxyConfig(target);
  const enabled = config?.enabled ?? false;
  const label = appLabel(activeApp);
  const isPending = isLoading || updateConfig.isPending || isStarting;

  const handleToggle = async (checked: boolean) => {
    if (!config) return;
    if (checked && !isRunning) {
      await startProxyServer();
    }
    await updateConfig.mutateAsync({ ...config, enabled: checked });
  };

  let tooltipText: string;
  if (enabled && !isRunning) {
    tooltipText = t("remote.routing.app.tooltip.broken", {
      app: label,
      defaultValue: `${label} 已启用远程路由，但远程路由服务未运行`,
    });
  } else if (enabled) {
    tooltipText = t("remote.routing.app.tooltip.active", {
      app: label,
      defaultValue: `${label} 请求将通过远程路由转发`,
    });
  } else if (!isRunning) {
    tooltipText = t("remote.routing.app.tooltip.inactiveWithStart", {
      app: label,
      defaultValue: `启用 ${label} 远程路由；远程路由服务会自动启动`,
    });
  } else {
    tooltipText = t("remote.routing.app.tooltip.inactive", {
      app: label,
      defaultValue: `启用 ${label} 远程路由`,
    });
  }

  return (
    <div
      data-testid="remote-app-routing-toggle"
      className={cn(
        "flex items-center gap-1 px-1.5 h-8 rounded-lg bg-muted/50 transition-all",
        className,
      )}
      title={tooltipText}
    >
      {isPending ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : (
        <RadioTower
          className={cn(
            "h-4 w-4 transition-colors",
            enabled
              ? "text-emerald-500 animate-pulse"
              : "text-muted-foreground",
          )}
        />
      )}
      <Switch
        checked={enabled}
        onCheckedChange={handleToggle}
        disabled={isPending || !config}
      />
    </div>
  );
}
