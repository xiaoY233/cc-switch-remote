import { describe, expect, it } from "vitest";
import {
  shouldConfirmRemoteFailoverToggle,
  shouldConfirmRemoteRoutingStart,
} from "./remoteRoutingGuards";

describe("remote routing confirmation guards", () => {
  it("requires the same first-run routing confirmation as local settings", () => {
    expect(shouldConfirmRemoteRoutingStart({ proxyConfirmed: false })).toBe(
      true,
    );
    expect(shouldConfirmRemoteRoutingStart({ proxyConfirmed: true })).toBe(
      false,
    );
  });

  it("only confirms remote failover when enabling before confirmation", () => {
    expect(
      shouldConfirmRemoteFailoverToggle({ failoverConfirmed: false }, true),
    ).toBe(true);
    expect(
      shouldConfirmRemoteFailoverToggle({ failoverConfirmed: false }, false),
    ).toBe(false);
    expect(
      shouldConfirmRemoteFailoverToggle({ failoverConfirmed: true }, true),
    ).toBe(false);
  });
});
