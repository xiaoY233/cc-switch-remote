import { describe, expect, it } from "vitest";
import { isManagementInteractionBusy } from "@/lib/managementBusy";

describe("management interaction lock", () => {
  it("locks target navigation while a provider/auth dialog is open", () => {
    expect(
      isManagementInteractionBusy({
        mcp: false,
        skills: false,
        skillsNavigation: false,
        promptsNavigation: false,
        providerDialog: true,
        remoteSettings: false,
      }),
    ).toBe(true);
  });

  it("remains unlocked when no target-scoped workflow is active", () => {
    expect(
      isManagementInteractionBusy({
        mcp: false,
        skills: false,
        skillsNavigation: false,
        promptsNavigation: false,
        providerDialog: false,
        remoteSettings: false,
      }),
    ).toBe(false);
  });
});
