import type { Settings } from "@/types";

export type RemoteDirectoryApp =
  | "claude"
  | "codex"
  | "gemini"
  | "opencode"
  | "openclaw"
  | "hermes";

export interface RemoteDirectoryField {
  app: RemoteDirectoryApp;
  settingsKey: keyof Pick<
    Settings,
    | "claudeConfigDir"
    | "codexConfigDir"
    | "geminiConfigDir"
    | "opencodeConfigDir"
    | "openclawConfigDir"
    | "hermesConfigDir"
  >;
  labelKey: string;
  placeholderKey: string;
  defaultPlaceholder: string;
}

export const REMOTE_DIRECTORY_FIELDS: RemoteDirectoryField[] = [
  {
    app: "claude",
    settingsKey: "claudeConfigDir",
    labelKey: "settings.claudeConfigDir",
    placeholderKey: "settings.browsePlaceholderClaude",
    defaultPlaceholder: "~/.claude",
  },
  {
    app: "codex",
    settingsKey: "codexConfigDir",
    labelKey: "settings.codexConfigDir",
    placeholderKey: "settings.browsePlaceholderCodex",
    defaultPlaceholder: "~/.codex",
  },
  {
    app: "gemini",
    settingsKey: "geminiConfigDir",
    labelKey: "settings.geminiConfigDir",
    placeholderKey: "settings.browsePlaceholderGemini",
    defaultPlaceholder: "~/.gemini",
  },
  {
    app: "opencode",
    settingsKey: "opencodeConfigDir",
    labelKey: "settings.opencodeConfigDir",
    placeholderKey: "settings.browsePlaceholderOpencode",
    defaultPlaceholder: "~/.config/opencode",
  },
  {
    app: "openclaw",
    settingsKey: "openclawConfigDir",
    labelKey: "settings.openclawConfigDir",
    placeholderKey: "settings.browsePlaceholderOpenclaw",
    defaultPlaceholder: "~/.openclaw",
  },
  {
    app: "hermes",
    settingsKey: "hermesConfigDir",
    labelKey: "settings.hermesConfigDir",
    placeholderKey: "settings.browsePlaceholderHermes",
    defaultPlaceholder: "~/.hermes",
  },
];

function fieldForApp(app: RemoteDirectoryApp): RemoteDirectoryField {
  return REMOTE_DIRECTORY_FIELDS.find((field) => field.app === app)!;
}

function sanitizeRemoteDirectory(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function getRemoteDirectoryValue(
  settings: Settings,
  app: RemoteDirectoryApp,
): string {
  return settings[fieldForApp(app).settingsKey] ?? "";
}

export function buildRemoteDirectoryUpdates(
  app: RemoteDirectoryApp,
  value: string,
): Partial<Settings> {
  return {
    [fieldForApp(app).settingsKey]: sanitizeRemoteDirectory(value),
  };
}
