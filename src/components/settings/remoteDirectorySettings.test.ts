import { describe, expect, it } from "vitest";
import {
  REMOTE_DIRECTORY_FIELDS,
  buildRemoteDirectoryUpdates,
  getRemoteDirectoryValue,
} from "./remoteDirectorySettingsUtils";
import type { Settings } from "@/types";

describe("remote directory settings", () => {
  it("keeps remote directory fields aligned with supported apps", () => {
    expect(REMOTE_DIRECTORY_FIELDS.map((field) => field.app)).toEqual([
      "claude",
      "codex",
      "gemini",
      "opencode",
      "openclaw",
      "hermes",
    ]);
  });

  it("trims non-empty paths and clears empty paths when saving", () => {
    expect(buildRemoteDirectoryUpdates("codex", " /srv/codex ")).toEqual({
      codexConfigDir: "/srv/codex",
    });
    expect(buildRemoteDirectoryUpdates("codex", "   ")).toEqual({
      codexConfigDir: undefined,
    });
  });

  it("reads app-specific directory overrides from settings", () => {
    const settings = {
      claudeConfigDir: "/remote/.claude",
      codexConfigDir: "/remote/.codex",
    } as Settings;

    expect(getRemoteDirectoryValue(settings, "claude")).toBe("/remote/.claude");
    expect(getRemoteDirectoryValue(settings, "gemini")).toBe("");
  });
});
