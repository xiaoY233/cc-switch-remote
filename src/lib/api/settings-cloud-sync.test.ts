import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ManagementTarget, RemoteHostProfile } from "./remote";
import type { S3SyncSettings, WebDavSyncSettings } from "@/types";

const invokeMock = vi.fn();
const remoteWebdavTestConnectionMock = vi.fn();
const remoteWebdavSyncSaveSettingsMock = vi.fn();
const remoteWebdavSyncUploadMock = vi.fn();
const remoteWebdavSyncDownloadMock = vi.fn();
const remoteWebdavSyncFetchRemoteInfoMock = vi.fn();
const remoteS3TestConnectionMock = vi.fn();
const remoteS3SyncSaveSettingsMock = vi.fn();
const remoteS3SyncUploadMock = vi.fn();
const remoteS3SyncDownloadMock = vi.fn();
const remoteS3SyncFetchRemoteInfoMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("./remote", () => ({
  remoteApi: {
    webdavTestConnection: (...args: unknown[]) =>
      remoteWebdavTestConnectionMock(...args),
    webdavSyncSaveSettings: (...args: unknown[]) =>
      remoteWebdavSyncSaveSettingsMock(...args),
    webdavSyncUpload: (...args: unknown[]) =>
      remoteWebdavSyncUploadMock(...args),
    webdavSyncDownload: (...args: unknown[]) =>
      remoteWebdavSyncDownloadMock(...args),
    webdavSyncFetchRemoteInfo: (...args: unknown[]) =>
      remoteWebdavSyncFetchRemoteInfoMock(...args),
    s3TestConnection: (...args: unknown[]) =>
      remoteS3TestConnectionMock(...args),
    s3SyncSaveSettings: (...args: unknown[]) =>
      remoteS3SyncSaveSettingsMock(...args),
    s3SyncUpload: (...args: unknown[]) => remoteS3SyncUploadMock(...args),
    s3SyncDownload: (...args: unknown[]) => remoteS3SyncDownloadMock(...args),
    s3SyncFetchRemoteInfo: (...args: unknown[]) =>
      remoteS3SyncFetchRemoteInfoMock(...args),
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

const webdavSettings: WebDavSyncSettings = {
  enabled: true,
  autoSync: false,
  baseUrl: "https://dav.example.com/dav/",
  username: "user",
  password: "",
  remoteRoot: "cc-switch-sync",
  profile: "default",
};

const s3Settings: S3SyncSettings = {
  enabled: true,
  autoSync: false,
  region: "us-east-1",
  bucket: "bucket",
  accessKeyId: "ak",
  secretAccessKey: "",
  remoteRoot: "cc-switch-sync",
  profile: "default",
};

describe("cloud sync settings API", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    remoteWebdavTestConnectionMock.mockReset();
    remoteWebdavSyncSaveSettingsMock.mockReset();
    remoteWebdavSyncUploadMock.mockReset();
    remoteWebdavSyncDownloadMock.mockReset();
    remoteWebdavSyncFetchRemoteInfoMock.mockReset();
    remoteS3TestConnectionMock.mockReset();
    remoteS3SyncSaveSettingsMock.mockReset();
    remoteS3SyncUploadMock.mockReset();
    remoteS3SyncDownloadMock.mockReset();
    remoteS3SyncFetchRemoteInfoMock.mockReset();
  });

  it("routes WebDAV sync actions to the selected remote target", async () => {
    const { settingsApi } = await import("./settings");
    remoteWebdavTestConnectionMock.mockResolvedValue({ success: true });
    remoteWebdavSyncSaveSettingsMock.mockResolvedValue({ success: true });
    remoteWebdavSyncUploadMock.mockResolvedValue({ status: "uploaded" });
    remoteWebdavSyncDownloadMock.mockResolvedValue({ status: "downloaded" });
    remoteWebdavSyncFetchRemoteInfoMock.mockResolvedValue({ empty: true });

    await settingsApi.webdavTestConnection(webdavSettings, true, remoteTarget);
    await settingsApi.webdavSyncSaveSettings(
      webdavSettings,
      false,
      remoteTarget,
    );
    await settingsApi.webdavSyncUpload(remoteTarget);
    await settingsApi.webdavSyncDownload(remoteTarget);
    await settingsApi.webdavSyncFetchRemoteInfo(remoteTarget);

    expect(remoteWebdavTestConnectionMock).toHaveBeenCalledWith(
      profile,
      webdavSettings,
      true,
      remoteTarget.secret,
    );
    expect(remoteWebdavSyncSaveSettingsMock).toHaveBeenCalledWith(
      profile,
      webdavSettings,
      false,
      remoteTarget.secret,
    );
    expect(remoteWebdavSyncUploadMock).toHaveBeenCalledWith(
      profile,
      remoteTarget.secret,
    );
    expect(remoteWebdavSyncDownloadMock).toHaveBeenCalledWith(
      profile,
      remoteTarget.secret,
    );
    expect(remoteWebdavSyncFetchRemoteInfoMock).toHaveBeenCalledWith(
      profile,
      remoteTarget.secret,
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("routes S3 sync actions to the selected remote target", async () => {
    const { settingsApi } = await import("./settings");
    remoteS3TestConnectionMock.mockResolvedValue({ success: true });
    remoteS3SyncSaveSettingsMock.mockResolvedValue({ success: true });
    remoteS3SyncUploadMock.mockResolvedValue({ status: "uploaded" });
    remoteS3SyncDownloadMock.mockResolvedValue({ status: "downloaded" });
    remoteS3SyncFetchRemoteInfoMock.mockResolvedValue({ empty: true });

    await settingsApi.s3TestConnection(s3Settings, true, remoteTarget);
    await settingsApi.s3SyncSaveSettings(s3Settings, false, remoteTarget);
    await settingsApi.s3SyncUpload(remoteTarget);
    await settingsApi.s3SyncDownload(remoteTarget);
    await settingsApi.s3SyncFetchRemoteInfo(remoteTarget);

    expect(remoteS3TestConnectionMock).toHaveBeenCalledWith(
      profile,
      s3Settings,
      true,
      remoteTarget.secret,
    );
    expect(remoteS3SyncSaveSettingsMock).toHaveBeenCalledWith(
      profile,
      s3Settings,
      false,
      remoteTarget.secret,
    );
    expect(remoteS3SyncUploadMock).toHaveBeenCalledWith(
      profile,
      remoteTarget.secret,
    );
    expect(remoteS3SyncDownloadMock).toHaveBeenCalledWith(
      profile,
      remoteTarget.secret,
    );
    expect(remoteS3SyncFetchRemoteInfoMock).toHaveBeenCalledWith(
      profile,
      remoteTarget.secret,
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
