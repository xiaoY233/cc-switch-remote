import { describe, expect, it } from "vitest";
import {
  ADVANCED_SETTINGS_SECTIONS,
  getAdvancedSettingsSupport,
} from "./advancedSupport";

describe("advanced settings remote support matrix", () => {
  it("keeps the remote advanced page aligned with the local advanced section order", () => {
    expect(ADVANCED_SETTINGS_SECTIONS.map((section) => section.id)).toEqual([
      "directory",
      "data",
      "backup",
      "cloudSync",
      "test",
      "logConfig",
    ]);
  });

  it("marks only implemented remote advanced workflows as parity", () => {
    expect(
      ADVANCED_SETTINGS_SECTIONS.map((section) => [
        section.id,
        getAdvancedSettingsSupport(section.id, "remote").status,
      ]),
    ).toEqual([
      ["directory", "remote-adapted"],
      ["data", "parity"],
      ["backup", "parity"],
      ["cloudSync", "unsupported"],
      ["test", "parity"],
      ["logConfig", "parity"],
    ]);
  });
});
