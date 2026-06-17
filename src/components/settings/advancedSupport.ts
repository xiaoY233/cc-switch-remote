export type AdvancedSettingsSectionId =
  | "directory"
  | "data"
  | "backup"
  | "cloudSync"
  | "test"
  | "logConfig";

export type SettingsTargetMode = "local" | "remote";

export type AdvancedSettingsSupportStatus =
  | "parity"
  | "remote-adapted"
  | "unsupported";

export interface AdvancedSettingsSectionDefinition {
  id: AdvancedSettingsSectionId;
  titleKey: string;
  descriptionKey: string;
  defaultTitle: string;
  defaultDescription: string;
}

export interface AdvancedSettingsSupport {
  status: AdvancedSettingsSupportStatus;
  reasonKey?: string;
  defaultReason?: string;
}

export const ADVANCED_SETTINGS_SECTIONS: AdvancedSettingsSectionDefinition[] = [
  {
    id: "directory",
    titleKey: "settings.advanced.configDir.title",
    descriptionKey: "settings.advanced.configDir.description",
    defaultTitle: "Configuration Directory",
    defaultDescription:
      "Manage the CC Switch data directory and application config directory overrides",
  },
  {
    id: "data",
    titleKey: "settings.advanced.data.title",
    descriptionKey: "settings.advanced.data.description",
    defaultTitle: "Data Import/Export",
    defaultDescription: "Import or export CC Switch data",
  },
  {
    id: "backup",
    titleKey: "settings.advanced.backup.title",
    descriptionKey: "settings.advanced.backup.description",
    defaultTitle: "Backup & Restore",
    defaultDescription:
      "Manage automatic backups, view and restore database snapshots",
  },
  {
    id: "cloudSync",
    titleKey: "settings.advanced.cloudSync.title",
    descriptionKey: "settings.advanced.cloudSync.description",
    defaultTitle: "Cloud Sync",
    defaultDescription: "Configure WebDAV or S3 sync",
  },
  {
    id: "test",
    titleKey: "settings.advanced.modelTest.title",
    descriptionKey: "settings.advanced.modelTest.description",
    defaultTitle: "Model Test",
    defaultDescription: "Configure model connectivity test parameters",
  },
  {
    id: "logConfig",
    titleKey: "settings.advanced.logConfig.title",
    descriptionKey: "settings.advanced.logConfig.description",
    defaultTitle: "Log Config",
    defaultDescription: "Configure application log level",
  },
];

const REMOTE_ADVANCED_SUPPORT: Record<
  AdvancedSettingsSectionId,
  AdvancedSettingsSupport
> = {
  directory: {
    status: "remote-adapted",
  },
  data: { status: "parity" },
  backup: {
    status: "unsupported",
    reasonKey: "remote.settings.advanced.unsupported.backup",
    defaultReason:
      "Remote backup management is not connected yet. It needs helper commands for listing, creating, restoring, renaming, and deleting remote database snapshots.",
  },
  cloudSync: {
    status: "unsupported",
    reasonKey: "remote.settings.advanced.unsupported.cloudSync",
    defaultReason:
      "Remote cloud sync is not connected yet. Saving credentials and running upload/download must happen through remote helper commands.",
  },
  test: { status: "parity" },
  logConfig: { status: "parity" },
};

export function getAdvancedSettingsSupport(
  sectionId: AdvancedSettingsSectionId,
  targetMode: SettingsTargetMode,
): AdvancedSettingsSupport {
  if (targetMode === "local") {
    return { status: "parity" };
  }
  return REMOTE_ADVANCED_SUPPORT[sectionId];
}
