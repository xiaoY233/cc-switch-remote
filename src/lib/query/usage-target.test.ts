import { describe, expect, it } from "vitest";
import type { ManagementTarget, RemoteHostProfile } from "@/lib/api/remote";
import { LOCAL_MANAGEMENT_TARGET } from "@/lib/managementTarget";
import { usageKeys, usageScriptResultKey } from "./usage";

const profile: RemoteHostProfile = {
  id: "remote-usage",
  name: "Remote Usage",
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
};

describe("usage query keys", () => {
  it("separates local and remote usage caches by target", () => {
    const localKey = usageKeys.summary(
      "today",
      undefined,
      undefined,
      { appType: "codex" },
      LOCAL_MANAGEMENT_TARGET,
    );
    const remoteKey = usageKeys.summary(
      "today",
      undefined,
      undefined,
      { appType: "codex" },
      remoteTarget,
    );

    expect(localKey).not.toEqual(remoteKey);
    expect(localKey.slice(0, 3)).toEqual(["usage", "local", "summary"]);
    expect(remoteKey.slice(0, 4)).toEqual([
      "usage",
      "remote",
      "remote-usage",
      "summary",
    ]);
  });

  it("separates local and remote provider usage result caches by target", () => {
    expect(usageScriptResultKey("provider-1", "codex")).toEqual([
      "usage",
      "local",
      "provider-1",
      "codex",
      "local",
    ]);

    expect(usageScriptResultKey("provider-1", "codex", remoteTarget)).toEqual([
      "usage",
      "local",
      "provider-1",
      "codex",
      "remote:remote-usage",
    ]);
  });
});
