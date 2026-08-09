import { describe, expect, it } from "vitest";
import { buildOmoWarningSignature } from "./useOmoModelSource";

describe("OMO warning target identity", () => {
  it("does not deduplicate equal failures from different targets", () => {
    const local = buildOmoWarningSignature("local", 0, true, ["broken"]);
    const remote = buildOmoWarningSignature(
      "remote:server-1",
      0,
      true,
      ["broken"],
    );

    expect(local).not.toBe(remote);
  });

  it("is stable for the same target regardless of provider failure order", () => {
    expect(
      buildOmoWarningSignature("remote:server-1", 0, false, ["b", "a"]),
    ).toBe(
      buildOmoWarningSignature("remote:server-1", 0, false, ["a", "b"]),
    );
  });

  it("does not deduplicate the same failure after a same-id connection change", () => {
    const oldConnection = buildOmoWarningSignature(
      "remote:server-1",
      0,
      true,
      ["broken"],
    );
    const newConnection = buildOmoWarningSignature(
      "remote:server-1",
      1,
      true,
      ["broken"],
    );

    expect(oldConnection).not.toBe(newConnection);
  });
});
