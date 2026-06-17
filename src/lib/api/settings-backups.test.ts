import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ManagementTarget, RemoteHostProfile } from "./remote";

const invokeMock = vi.fn();
const remoteCreateDbBackupMock = vi.fn();
const remoteListDbBackupsMock = vi.fn();
const remoteRestoreDbBackupMock = vi.fn();
const remoteRenameDbBackupMock = vi.fn();
const remoteDeleteDbBackupMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("./remote", () => ({
  remoteApi: {
    createDbBackup: (...args: unknown[]) => remoteCreateDbBackupMock(...args),
    listDbBackups: (...args: unknown[]) => remoteListDbBackupsMock(...args),
    restoreDbBackup: (...args: unknown[]) => remoteRestoreDbBackupMock(...args),
    renameDbBackup: (...args: unknown[]) => remoteRenameDbBackupMock(...args),
    deleteDbBackup: (...args: unknown[]) => remoteDeleteDbBackupMock(...args),
  },
}));

const profile: RemoteHostProfile = {
  id: "remote-1",
  name: "Remote 1",
  host: "192.168.1.20",
  port: 22,
  username: "root",
  authMethod: { type: "password" },
  helperPath: "~/.local/bin/cc-switch-remote-helper",
  createdAt: 1,
  updatedAt: 1,
};

const remoteTarget: ManagementTarget = {
  type: "remote",
  profile,
  secret: { password: "secret" },
};

describe("backup API", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    remoteCreateDbBackupMock.mockReset();
    remoteListDbBackupsMock.mockReset();
    remoteRestoreDbBackupMock.mockReset();
    remoteRenameDbBackupMock.mockReset();
    remoteDeleteDbBackupMock.mockReset();
  });

  it("uses remote backup commands when target is remote", async () => {
    const { backupsApi } = await import("./settings");
    const backups = [
      {
        filename: "db_backup_20260617_120000.db",
        sizeBytes: 2048,
        createdAt: "2026-06-17T12:00:00Z",
      },
    ];
    remoteCreateDbBackupMock.mockResolvedValue("created.db");
    remoteListDbBackupsMock.mockResolvedValue(backups);
    remoteRestoreDbBackupMock.mockResolvedValue("safety-backup");
    remoteRenameDbBackupMock.mockResolvedValue("renamed.db");
    remoteDeleteDbBackupMock.mockResolvedValue(true);

    await expect(backupsApi.createDbBackup(remoteTarget)).resolves.toBe(
      "created.db",
    );
    await expect(backupsApi.listDbBackups(remoteTarget)).resolves.toEqual(
      backups,
    );
    await expect(
      backupsApi.restoreDbBackup("created.db", remoteTarget),
    ).resolves.toBe("safety-backup");
    await expect(
      backupsApi.renameDbBackup("created.db", "renamed", remoteTarget),
    ).resolves.toBe("renamed.db");
    await expect(
      backupsApi.deleteDbBackup("renamed.db", remoteTarget),
    ).resolves.toBe(true);

    expect(remoteCreateDbBackupMock).toHaveBeenCalledWith(
      profile,
      remoteTarget.secret,
    );
    expect(remoteListDbBackupsMock).toHaveBeenCalledWith(
      profile,
      remoteTarget.secret,
    );
    expect(remoteRestoreDbBackupMock).toHaveBeenCalledWith(
      profile,
      "created.db",
      remoteTarget.secret,
    );
    expect(remoteRenameDbBackupMock).toHaveBeenCalledWith(
      profile,
      "created.db",
      "renamed",
      remoteTarget.secret,
    );
    expect(remoteDeleteDbBackupMock).toHaveBeenCalledWith(
      profile,
      "renamed.db",
      remoteTarget.secret,
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
