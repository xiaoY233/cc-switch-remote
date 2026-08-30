import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { usageApi } from "@/lib/api/usage";
import { usageKeys } from "@/lib/query/usage";
import { LOCAL_MANAGEMENT_TARGET } from "@/lib/managementTarget";
import type { ManagementTarget } from "@/lib/api/remote";
import { Database, FileText } from "lucide-react";

interface DataSourceBarProps {
  refreshIntervalMs: number;
  target?: ManagementTarget;
}

const DATA_SOURCE_ICONS: Record<string, React.ReactNode> = {
  proxy: <Database className="h-3.5 w-3.5" />,
  session_log: <FileText className="h-3.5 w-3.5" />,
  codex_db: <Database className="h-3.5 w-3.5" />,
  codex_session: <FileText className="h-3.5 w-3.5" />,
  gemini_session: <FileText className="h-3.5 w-3.5" />,
  opencode_session: <FileText className="h-3.5 w-3.5" />,
};

export function DataSourceBar({
  refreshIntervalMs,
  target = LOCAL_MANAGEMENT_TARGET,
}: DataSourceBarProps) {
  const { t } = useTranslation();
  const { data: sources } = useQuery({
    queryKey: [...usageKeys.all(target), "data-sources"],
    queryFn: () => usageApi.getDataSourceBreakdown(target),
    refetchInterval: refreshIntervalMs > 0 ? refreshIntervalMs : false,
    refetchIntervalInBackground: false,
  });

  if (!sources || sources.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground bg-muted/30 rounded-lg px-4 py-2">
      <span className="font-medium text-foreground/70">
        {t("usage.dataSources", { defaultValue: "Data Sources" })}:
      </span>
      <div className="flex items-center gap-3 flex-wrap">
        {sources.map((source) => (
          <div
            key={source.dataSource}
            className="flex items-center gap-1.5 bg-background/50 rounded-md px-2 py-1"
          >
            {DATA_SOURCE_ICONS[source.dataSource] ?? (
              <Database className="h-3.5 w-3.5" />
            )}
            <span>
              {t(`usage.dataSource.${source.dataSource}`, {
                defaultValue: source.dataSource,
              })}
            </span>
            <span className="font-mono font-medium text-foreground/80">
              {source.requestCount.toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
