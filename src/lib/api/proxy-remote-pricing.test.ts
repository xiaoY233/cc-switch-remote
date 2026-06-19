import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ManagementTarget, RemoteHostProfile } from "./remote";

const invokeMock = vi.fn();
const remoteGetDefaultCostMultiplierMock = vi.fn();
const remoteSetDefaultCostMultiplierMock = vi.fn();
const remoteGetPricingModelSourceMock = vi.fn();
const remoteSetPricingModelSourceMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("./remote", () => ({
  remoteApi: {
    getDefaultCostMultiplier: (...args: unknown[]) =>
      remoteGetDefaultCostMultiplierMock(...args),
    setDefaultCostMultiplier: (...args: unknown[]) =>
      remoteSetDefaultCostMultiplierMock(...args),
    getPricingModelSource: (...args: unknown[]) =>
      remoteGetPricingModelSourceMock(...args),
    setPricingModelSource: (...args: unknown[]) =>
      remoteSetPricingModelSourceMock(...args),
  },
}));

const profile: RemoteHostProfile = {
  id: "remote-pricing",
  name: "Remote Pricing",
  host: "192.168.1.21",
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
  secret: { password: "secret" },
};

describe("remote proxy pricing API", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    remoteGetDefaultCostMultiplierMock.mockReset();
    remoteSetDefaultCostMultiplierMock.mockReset();
    remoteGetPricingModelSourceMock.mockReset();
    remoteSetPricingModelSourceMock.mockReset();
  });

  it("routes billing defaults to the selected remote target", async () => {
    const { proxyApi } = await import("./proxy");

    remoteGetDefaultCostMultiplierMock.mockResolvedValue("1.5");
    remoteSetDefaultCostMultiplierMock.mockResolvedValue(undefined);
    remoteGetPricingModelSourceMock.mockResolvedValue("request");
    remoteSetPricingModelSourceMock.mockResolvedValue(undefined);

    await proxyApi.getDefaultCostMultiplier("codex", remoteTarget);
    await proxyApi.setDefaultCostMultiplier("codex", "2", remoteTarget);
    await proxyApi.getPricingModelSource("codex", remoteTarget);
    await proxyApi.setPricingModelSource("codex", "response", remoteTarget);

    expect(remoteGetDefaultCostMultiplierMock).toHaveBeenCalledWith(
      profile,
      "codex",
      remoteTarget.secret,
    );
    expect(remoteSetDefaultCostMultiplierMock).toHaveBeenCalledWith(
      profile,
      "codex",
      "2",
      remoteTarget.secret,
    );
    expect(remoteGetPricingModelSourceMock).toHaveBeenCalledWith(
      profile,
      "codex",
      remoteTarget.secret,
    );
    expect(remoteSetPricingModelSourceMock).toHaveBeenCalledWith(
      profile,
      "codex",
      "response",
      remoteTarget.secret,
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
