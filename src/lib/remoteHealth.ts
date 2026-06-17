import type { TFunction } from "i18next";
import type { RemoteHealth } from "@/lib/api";

export const EXPECTED_REMOTE_CAPABILITIES = [
  {
    id: "providers",
    labelKey: "remote.capabilities.providers",
    defaultLabel: "供应商",
  },
  {
    id: "universal-providers",
    labelKey: "remote.capabilities.universalProviders",
    defaultLabel: "统一供应商",
  },
  {
    id: "routing-config",
    labelKey: "remote.capabilities.routingConfig",
    defaultLabel: "路由配置",
  },
  {
    id: "routing-runtime",
    labelKey: "remote.capabilities.routingRuntime",
    defaultLabel: "路由运行态",
  },
  {
    id: "openclaw",
    labelKey: "remote.capabilities.openclaw",
    defaultLabel: "OpenClaw",
  },
  { id: "mcp", labelKey: "remote.capabilities.mcp", defaultLabel: "MCP" },
  {
    id: "prompts",
    labelKey: "remote.capabilities.prompts",
    defaultLabel: "提示词",
  },
  {
    id: "skills",
    labelKey: "remote.capabilities.skills",
    defaultLabel: "技能",
  },
  {
    id: "sessions",
    labelKey: "remote.capabilities.sessions",
    defaultLabel: "会话管理",
  },
  {
    id: "hermes-memory",
    labelKey: "remote.capabilities.hermesMemory",
    defaultLabel: "Hermes 记忆",
  },
  {
    id: "tools",
    labelKey: "remote.capabilities.tools",
    defaultLabel: "环境检查更新",
  },
  {
    id: "import-export",
    labelKey: "remote.capabilities.importExport",
    defaultLabel: "导入 / 导出",
  },
  {
    id: "settings",
    labelKey: "remote.capabilities.settings",
    defaultLabel: "通用设置",
  },
  {
    id: "settings-app-config-dir",
    labelKey: "remote.capabilities.settingsAppConfigDir",
    defaultLabel: "CC Switch 配置目录",
  },
  {
    id: "plugin",
    labelKey: "remote.capabilities.plugin",
    defaultLabel: "Claude 插件",
  },
  {
    id: "session",
    labelKey: "remote.capabilities.session",
    defaultLabel: "持久连接",
  },
] as const;

export function canReportRemoteCapabilities(health: RemoteHealth | null) {
  return health?.reachable === true && health.helperInstalled === true;
}

export function formatRemoteHelperVersion(health: RemoteHealth | null) {
  if (!health?.helperVersion) return "-";
  return health.helperVersion;
}

export function formatRemoteHelperLatest(health: RemoteHealth | null) {
  if (!health?.helperLatestVersion) return "-";
  return health.helperLatestVersion;
}

export function formatRemotePlatform(health: RemoteHealth | null) {
  if (!health?.platform) return "-";
  return health.helperArch
    ? `${health.platform} / ${health.helperArch}`
    : health.platform;
}

export function formatRemoteCapabilitySummary(
  health: RemoteHealth | null,
  t: TFunction,
) {
  if (!canReportRemoteCapabilities(health)) {
    return "-";
  }
  const count = health?.capabilities.length ?? 0;
  if (count === 0) {
    return t("remote.health.noCapabilities", {
      defaultValue: "未返回功能支持信息",
    });
  }
  return t("remote.health.supportedCapabilities", {
    defaultValue: "已支持 {{count}} 项",
    count,
  });
}

export function formatRemoteHelperUpdateError(error: string, t: TFunction) {
  if (error.includes("不支持持久会话")) {
    return error;
  }
  return t("remote.health.helperUpdateCheckFailed", {
    defaultValue: "Helper 更新检测失败: {{error}}",
    error,
  });
}
