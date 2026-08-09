import { describe, expect, it } from "vitest";
import {
  isManagementInteractionBusy,
  isProviderTargetWorkflowOpen,
} from "@/lib/managementBusy";

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

  it.each(["add", "edit", "usage", "confirm"] as const)(
    "locks for the %s provider workflow",
    (workflow) => {
      expect(
        isProviderTargetWorkflowOpen({
          add: workflow === "add",
          edit: workflow === "edit",
          usage: workflow === "usage",
          confirm: workflow === "confirm",
        }),
      ).toBe(true);
    },
  );
});
