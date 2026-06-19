import type { CSSProperties } from "react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Check,
  ChevronDown,
  Cloud,
  Laptop,
  MonitorCog,
  Server,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { RemoteHostProfile } from "@/lib/api";

interface ManagementTargetSwitcherProps {
  profiles: RemoteHostProfile[];
  activeTargetKey: string;
  onTargetChange: (targetKey: string) => void;
  onManageServers?: () => void;
  className?: string;
  style?: CSSProperties;
}

export function ManagementTargetSwitcher({
  profiles,
  activeTargetKey,
  onTargetChange,
  onManageServers,
  className,
  style,
}: ManagementTargetSwitcherProps) {
  const { t } = useTranslation();
  const activeRemoteProfile = useMemo(
    () =>
      profiles.find((profile) => `remote:${profile.id}` === activeTargetKey),
    [activeTargetKey, profiles],
  );
  const isLocal = activeTargetKey === "local" || !activeRemoteProfile;
  const triggerLabel = isLocal
    ? t("remote.localTarget", { defaultValue: "本地" })
    : (activeRemoteProfile?.name ??
      t("remote.remoteTarget", { defaultValue: "远程" }));
  const TriggerIcon = isLocal ? Laptop : MonitorCog;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn("max-w-[220px] px-2.5", className)}
          style={style}
          aria-label={t("remote.targetSelector", { defaultValue: "管理目标" })}
        >
          <TriggerIcon className="h-4 w-4 shrink-0" />
          <span className="min-w-0 truncate">{triggerLabel}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>
          {t("remote.targetSelector", { defaultValue: "管理目标" })}
        </DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => onTargetChange("local")}>
          <Laptop className="h-4 w-4 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">
            {t("remote.localTarget", { defaultValue: "本地" })}
          </span>
          {isLocal && <Check className="h-4 w-4 text-primary" />}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>
          {t("remote.manageServers", { defaultValue: "远程服务器" })}
        </DropdownMenuLabel>
        {profiles.length === 0 ? (
          <DropdownMenuItem disabled>
            {t("remote.noServers", { defaultValue: "暂无远程服务器" })}
          </DropdownMenuItem>
        ) : (
          profiles.map((profile) => {
            const targetKey = `remote:${profile.id}`;
            const selected = targetKey === activeTargetKey;
            return (
              <DropdownMenuItem
                key={profile.id}
                onSelect={() => onTargetChange(targetKey)}
                className="min-w-0"
              >
                <Cloud className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{profile.name}</span>
                {selected && <Check className="h-4 w-4 text-primary" />}
              </DropdownMenuItem>
            );
          })
        )}
        {onManageServers && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onManageServers}>
              <Server className="h-4 w-4 text-muted-foreground" />
              {t("remote.manageServers", { defaultValue: "远程服务器" })}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
