import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deletePreviewRemoteProfile,
  loadPreviewRemoteProfiles,
  remoteApi,
  savePreviewRemoteProfile,
  validateRemoteProfile,
  type RemoteConnectionSecret,
  type RemoteHostProfile,
} from "./remote";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

function profile(
  overrides: Partial<RemoteHostProfile> = {},
): RemoteHostProfile {
  return {
    id: "remote-1",
    name: "Remote 1",
    host: "192.0.2.10",
    port: 22,
    username: "root",
    authMethod: { type: "password" },
    helperPath: "~/.local/bin/cc-switch-remote-helper",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

class MemoryStorage
  implements Pick<Storage, "getItem" | "setItem" | "removeItem">
{
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

beforeEach(() => {
  invokeMock.mockReset();
});

describe("remote preview profile store", () => {
  it("saves updates and deletes remote profiles without requiring Tauri invoke", () => {
    const storage = new MemoryStorage();
    const saved = savePreviewRemoteProfile(profile(), storage);
    const updated = savePreviewRemoteProfile(
      profile({ name: "Remote Renamed", updatedAt: 2 }),
      storage,
    );

    expect(saved.id).toBe("remote-1");
    expect(updated.name).toBe("Remote Renamed");
    expect(loadPreviewRemoteProfiles(storage)).toEqual([updated]);
    expect(deletePreviewRemoteProfile("remote-1", storage)).toBe(true);
    expect(loadPreviewRemoteProfiles(storage)).toEqual([]);
  });

  it("keeps password secrets out of browser preview profile storage", () => {
    const storage = new MemoryStorage();
    savePreviewRemoteProfile(profile(), storage);

    const raw = storage.getItem("cc-switch-preview-remote-hosts");

    expect(raw).toContain('"authMethod":{"type":"password"}');
    expect(raw).not.toContain("preview-only-password");
    expect(raw).not.toContain('password":"');
  });

  it("validates required profile fields before preview save", () => {
    expect(() => validateRemoteProfile(profile({ host: "" }))).toThrow(
      "Remote host is required",
    );
    expect(() =>
      validateRemoteProfile(
        profile({ authMethod: { type: "keyFile", path: "" } }),
      ),
    ).toThrow("Remote SSH key path is required");
  });
});

describe("remote API invoke mappings", () => {
  it("fetches Codex OAuth models through the remote helper command", async () => {
    const remoteProfile = profile();
    const secret: RemoteConnectionSecret = { password: "secret" };
    invokeMock.mockResolvedValueOnce([{ id: "gpt-5", ownedBy: null }]);

    const result = await remoteApi.fetchCodexOauthModels(
      remoteProfile,
      "chatgpt-1",
      secret,
    );

    expect(result).toEqual([{ id: "gpt-5", ownedBy: null }]);
    expect(invokeMock).toHaveBeenCalledWith("remote_fetch_codex_oauth_models", {
      profile: remoteProfile,
      accountId: "chatgpt-1",
      secret,
    });
  });

  it("scans OpenClaw health through the remote helper command", async () => {
    const remoteProfile = profile();
    const secret: RemoteConnectionSecret = { password: "secret" };
    invokeMock.mockResolvedValueOnce([
      {
        code: "openclaw.config.missing",
        message: "Remote config missing",
      },
    ]);

    const result = await remoteApi.scanOpenClawHealth(remoteProfile, secret);

    expect(result).toEqual([
      {
        code: "openclaw.config.missing",
        message: "Remote config missing",
      },
    ]);
    expect(invokeMock).toHaveBeenCalledWith("remote_scan_openclaw_health", {
      profile: remoteProfile,
      secret,
    });
  });
});
