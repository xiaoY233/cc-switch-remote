import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useImportExport } from "@/hooks/useImportExport";

const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();
const toastWarningMock = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
    warning: (...args: unknown[]) => toastWarningMock(...args),
  },
}));

const openFileDialogMock = vi.fn();
const importConfigMock = vi.fn();
const saveFileDialogMock = vi.fn();
const exportConfigMock = vi.fn();
const syncCurrentProvidersLiveMock = vi.fn();
const remoteImportConfigMock = vi.fn();
const remoteExportConfigMock = vi.fn();
const remotePreflightConfigFileMock = vi.fn();
const invalidateQueriesMock = vi.fn();

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: invalidateQueriesMock }),
  };
});

vi.mock("@/lib/api", () => ({
  settingsApi: {
    openFileDialog: (...args: unknown[]) => openFileDialogMock(...args),
    importConfigFromFile: (...args: unknown[]) => importConfigMock(...args),
    saveFileDialog: (...args: unknown[]) => saveFileDialogMock(...args),
    exportConfigToFile: (...args: unknown[]) => exportConfigMock(...args),
    syncCurrentProvidersLive: (...args: unknown[]) =>
      syncCurrentProvidersLiveMock(...args),
  },
  remoteApi: {
    preflightConfigFile: (...args: unknown[]) =>
      remotePreflightConfigFileMock(...args),
    importConfigFromFile: (...args: unknown[]) =>
      remoteImportConfigMock(...args),
    exportConfigToFile: (...args: unknown[]) => remoteExportConfigMock(...args),
  },
}));

beforeEach(() => {
  openFileDialogMock.mockReset();
  importConfigMock.mockReset();
  saveFileDialogMock.mockReset();
  exportConfigMock.mockReset();
  remoteImportConfigMock.mockReset();
  remoteExportConfigMock.mockReset();
  remotePreflightConfigFileMock.mockReset();
  invalidateQueriesMock.mockReset();
  toastSuccessMock.mockReset();
  toastErrorMock.mockReset();
  toastWarningMock.mockReset();
  syncCurrentProvidersLiveMock.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useImportExport Hook", () => {
  it("should update state after successfully selecting file", async () => {
    openFileDialogMock.mockResolvedValue("/path/config.json");
    const { result } = renderHook(() => useImportExport());

    await act(async () => {
      await result.current.selectImportFile();
    });

    expect(result.current.selectedFile).toBe("/path/config.json");
    expect(result.current.status).toBe("idle");
    expect(result.current.errorMessage).toBeNull();
  });

  it("should show error toast and keep initial state when file dialog fails", async () => {
    openFileDialogMock.mockRejectedValue(new Error("file dialog error"));
    const { result } = renderHook(() => useImportExport());

    await act(async () => {
      await result.current.selectImportFile();
    });

    expect(toastErrorMock).toHaveBeenCalledTimes(1);
    expect(result.current.selectedFile).toBe("");
    expect(result.current.status).toBe("idle");
  });

  it("should show error and return early when no file is selected for import", async () => {
    const { result } = renderHook(() =>
      useImportExport({ onImportSuccess: vi.fn() }),
    );

    await act(async () => {
      await result.current.importConfig();
    });

    expect(toastErrorMock).toHaveBeenCalledTimes(1);
    expect(importConfigMock).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
  });

  it("should set success status, record backup ID, and call callback on successful import", async () => {
    openFileDialogMock.mockResolvedValue("/config.json");
    importConfigMock.mockResolvedValue({
      success: true,
      backupId: "backup-123",
    });
    const onImportSuccess = vi.fn();

    const { result } = renderHook(() => useImportExport({ onImportSuccess }));

    await act(async () => {
      await result.current.selectImportFile();
    });

    await act(async () => {
      await result.current.importConfig();
    });

    expect(importConfigMock).toHaveBeenCalledWith("/config.json");
    expect(result.current.status).toBe("success");
    expect(result.current.backupId).toBe("backup-123");
    expect(toastSuccessMock).toHaveBeenCalledTimes(1);
    expect(onImportSuccess).toHaveBeenCalledTimes(1);
  });

  it("should show error message and keep selected file when import result fails", async () => {
    openFileDialogMock.mockResolvedValue("/config.json");
    importConfigMock.mockResolvedValue({
      success: false,
      message: "Config corrupted",
    });

    const { result } = renderHook(() => useImportExport());

    await act(async () => {
      await result.current.selectImportFile();
    });

    await act(async () => {
      await result.current.importConfig();
    });

    expect(result.current.status).toBe("error");
    expect(result.current.errorMessage).toBe("Config corrupted");
    expect(result.current.selectedFile).toBe("/config.json");
    expect(toastErrorMock).toHaveBeenCalledWith("Config corrupted");
  });

  it("should catch and display error when import process throws exception", async () => {
    openFileDialogMock.mockResolvedValue("/config.json");
    importConfigMock.mockRejectedValue(new Error("Import failed"));

    const { result } = renderHook(() => useImportExport());

    await act(async () => {
      await result.current.selectImportFile();
    });

    await act(async () => {
      await result.current.importConfig();
    });

    expect(result.current.status).toBe("error");
    expect(result.current.errorMessage).toBe("Import failed");
    expect(toastErrorMock).toHaveBeenCalledWith(
      expect.stringContaining("导入配置失败:"),
    );
  });

  it("should export successfully with default filename and show path in toast", async () => {
    saveFileDialogMock.mockResolvedValue("/export.json");
    exportConfigMock.mockResolvedValue({
      success: true,
      filePath: "/backup/export.json",
    });

    const { result } = renderHook(() => useImportExport());

    await act(async () => {
      await result.current.exportConfig();
    });

    expect(saveFileDialogMock).toHaveBeenCalledTimes(1);
    expect(exportConfigMock).toHaveBeenCalledWith("/export.json");
    expect(toastSuccessMock).toHaveBeenCalledWith(
      expect.stringContaining("/backup/export.json"),
      expect.objectContaining({ closeButton: true }),
    );
  });

  it("should import selected SQL into the remote target without touching the local database", async () => {
    const remoteTarget = {
      type: "remote" as const,
      profile: {
        id: "host-1",
        name: "Host 1",
        host: "192.168.1.10",
        port: 22,
        username: "root",
        authMethod: { type: "password" as const },
        helperPath: "~/.local/bin/cc-switch-cli",
        createdAt: 1,
        updatedAt: 1,
      },
      secret: { password: "secret" },
    };
    openFileDialogMock.mockResolvedValue("/config.sql");
    remotePreflightConfigFileMock.mockResolvedValue({
      hasBlockingRisks: false,
      risks: [],
    });
    remoteImportConfigMock.mockResolvedValue({
      success: true,
      backupId: "remote-backup-1",
    });

    const { result } = renderHook(() =>
      useImportExport({ target: remoteTarget }),
    );

    await act(async () => {
      await result.current.selectImportFile();
    });

    await act(async () => {
      await result.current.importConfig();
    });

    expect(remotePreflightConfigFileMock).toHaveBeenCalledWith(
      remoteTarget.profile,
      "/config.sql",
      remoteTarget.secret,
    );
    expect(remoteImportConfigMock).toHaveBeenCalledWith(
      remoteTarget.profile,
      "/config.sql",
      remoteTarget.secret,
      { restoreMode: "exact" },
    );
    expect(importConfigMock).not.toHaveBeenCalled();
    expect(syncCurrentProvidersLiveMock).not.toHaveBeenCalled();
    expect(result.current.status).toBe("success");
    expect(result.current.backupId).toBe("remote-backup-1");
    expect(invalidateQueriesMock).toHaveBeenCalledWith({
      queryKey: ["opencode", "runtime-models", "remote:host-1"],
    });
  });

  it("does not invalidate a remote runtime-model cache after a local import", async () => {
    openFileDialogMock.mockResolvedValue("/config.sql");
    importConfigMock.mockResolvedValue({ success: true, backupId: "local-1" });

    const { result } = renderHook(() => useImportExport());

    await act(async () => {
      await result.current.selectImportFile();
    });
    await act(async () => {
      await result.current.importConfig();
    });

    expect(invalidateQueriesMock).not.toHaveBeenCalled();
  });

  it("should export the remote target database to a local file path", async () => {
    const remoteTarget = {
      type: "remote" as const,
      profile: {
        id: "host-1",
        name: "Host 1",
        host: "192.168.1.10",
        port: 22,
        username: "root",
        authMethod: { type: "password" as const },
        helperPath: "~/.local/bin/cc-switch-cli",
        createdAt: 1,
        updatedAt: 1,
      },
      secret: { password: "secret" },
    };
    saveFileDialogMock.mockResolvedValue("/exports/remote.sql");
    remoteExportConfigMock.mockResolvedValue({
      success: true,
      filePath: "/exports/remote.sql",
    });

    const { result } = renderHook(() =>
      useImportExport({ target: remoteTarget }),
    );

    await act(async () => {
      await result.current.exportConfig();
    });

    expect(remoteExportConfigMock).toHaveBeenCalledWith(
      remoteTarget.profile,
      "/exports/remote.sql",
      remoteTarget.secret,
    );
    expect(exportConfigMock).not.toHaveBeenCalled();
    expect(toastSuccessMock).toHaveBeenCalledWith(
      expect.stringContaining("/exports/remote.sql"),
      expect.objectContaining({ closeButton: true }),
    );
  });

  it("should show error message when export fails", async () => {
    saveFileDialogMock.mockResolvedValue("/export.json");
    exportConfigMock.mockResolvedValue({
      success: false,
      message: "Write failed",
    });

    const { result } = renderHook(() => useImportExport());

    await act(async () => {
      await result.current.exportConfig();
    });

    expect(toastErrorMock).toHaveBeenCalledWith(
      expect.stringContaining("Write failed"),
    );
  });

  it("should catch and show error when export throws exception", async () => {
    saveFileDialogMock.mockResolvedValue("/export.json");
    exportConfigMock.mockRejectedValue(new Error("Disk read-only"));

    const { result } = renderHook(() => useImportExport());

    await act(async () => {
      await result.current.exportConfig();
    });

    expect(toastErrorMock).toHaveBeenCalledWith(
      expect.stringContaining("Disk read-only"),
    );
  });

  it("should show error and return when user cancels save dialog during export", async () => {
    saveFileDialogMock.mockResolvedValue(null);

    const { result } = renderHook(() => useImportExport());

    await act(async () => {
      await result.current.exportConfig();
    });

    expect(exportConfigMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledTimes(1);
  });

  it("should restore initial values when clearing selection and resetting status", async () => {
    openFileDialogMock.mockResolvedValue("/config.json");
    const { result } = renderHook(() => useImportExport());

    await act(async () => {
      await result.current.selectImportFile();
    });

    act(() => {
      result.current.clearSelection();
    });

    expect(result.current.selectedFile).toBe("");
    expect(result.current.status).toBe("idle");

    act(() => {
      result.current.resetStatus();
    });

    expect(result.current.errorMessage).toBeNull();
    expect(result.current.backupId).toBeNull();
  });
});
