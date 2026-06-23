import { describe, expect, it } from "vitest";
import { shouldPersistUsageConfirmation } from "@/utils/usageScriptTarget";
import type { ManagementTarget } from "@/lib/api";

const remoteTarget: ManagementTarget = {
  type: "remote",
  profile: {
    id: "remote-host",
    name: "Remote Host",
    host: "192.168.1.20",
    port: 22,
    username: "root",
    authMethod: { type: "password" },
    helperPath: "~/.local/bin/cc-switch-remote-helper",
    createdAt: 1,
    updatedAt: 1,
  },
  secret: { password: "secret" },
};

describe("usage script target policy", () => {
  it("persists usage confirmation only for local targets", () => {
    expect(shouldPersistUsageConfirmation({ type: "local" })).toBe(true);
    expect(shouldPersistUsageConfirmation(remoteTarget)).toBe(false);
  });
});
