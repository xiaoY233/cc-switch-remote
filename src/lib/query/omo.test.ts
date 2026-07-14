import { describe, expect, it } from "vitest";
import { omoKeys, omoSlimKeys } from "@/lib/query/omo";

describe("OMO query keys", () => {
  it("separates current provider state by management target", () => {
    expect(omoKeys.currentProviderId("local")).toEqual([
      "omo",
      "current-provider-id",
      "local",
    ]);
    expect(omoKeys.currentProviderId("remote:remote-1")).toEqual([
      "omo",
      "current-provider-id",
      "remote:remote-1",
    ]);
    expect(omoSlimKeys.currentProviderId("remote:remote-1")).toEqual([
      "omo-slim",
      "current-provider-id",
      "remote:remote-1",
    ]);
  });
});
