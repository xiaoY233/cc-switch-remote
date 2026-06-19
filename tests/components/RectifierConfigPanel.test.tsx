import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RectifierConfigPanel } from "@/components/settings/RectifierConfigPanel";
import type { ManagementTarget, RemoteHostProfile } from "@/lib/api";

const getRectifierConfigMock = vi.fn();
const setRectifierConfigMock = vi.fn();
const getOptimizerConfigMock = vi.fn();
const setOptimizerConfigMock = vi.fn();
const localGetRectifierConfigMock = vi.fn();
const localSetRectifierConfigMock = vi.fn();
const localGetOptimizerConfigMock = vi.fn();
const localSetOptimizerConfigMock = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
  },
}));

vi.mock("@/lib/api/remote", () => ({
  remoteApi: {
    getRoutingRectifierConfig: (...args: unknown[]) =>
      getRectifierConfigMock(...args),
    setRoutingRectifierConfig: (...args: unknown[]) =>
      setRectifierConfigMock(...args),
    getRoutingOptimizerConfig: (...args: unknown[]) =>
      getOptimizerConfigMock(...args),
    setRoutingOptimizerConfig: (...args: unknown[]) =>
      setOptimizerConfigMock(...args),
  },
}));

vi.mock("@/lib/api/settings", () => ({
  settingsApi: {
    getRectifierConfig: (...args: unknown[]) =>
      localGetRectifierConfigMock(...args),
    setRectifierConfig: (...args: unknown[]) =>
      localSetRectifierConfigMock(...args),
    getOptimizerConfig: (...args: unknown[]) =>
      localGetOptimizerConfigMock(...args),
    setOptimizerConfig: (...args: unknown[]) =>
      localSetOptimizerConfigMock(...args),
  },
}));

const profile: RemoteHostProfile = {
  id: "remote-1",
  name: "Swarm01",
  host: "192.168.123.203",
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

const rectifierConfig = {
  enabled: true,
  requestThinkingSignature: true,
  requestThinkingBudget: true,
  requestMediaFallback: true,
  requestMediaHeuristic: true,
};

const optimizerConfig = {
  enabled: false,
  thinkingOptimizer: true,
  cacheInjection: true,
  cacheTtl: "1h",
};

describe("RectifierConfigPanel", () => {
  beforeEach(() => {
    getRectifierConfigMock.mockReset();
    setRectifierConfigMock.mockReset();
    getOptimizerConfigMock.mockReset();
    setOptimizerConfigMock.mockReset();
    localGetRectifierConfigMock.mockReset();
    localSetRectifierConfigMock.mockReset();
    localGetOptimizerConfigMock.mockReset();
    localSetOptimizerConfigMock.mockReset();

    getRectifierConfigMock.mockResolvedValue(rectifierConfig);
    setRectifierConfigMock.mockResolvedValue(true);
    getOptimizerConfigMock.mockResolvedValue(optimizerConfig);
    setOptimizerConfigMock.mockResolvedValue(true);
    localGetRectifierConfigMock.mockResolvedValue(rectifierConfig);
    localGetOptimizerConfigMock.mockResolvedValue(optimizerConfig);
  });

  it("loads and saves rectifier and optimizer settings through the remote target", async () => {
    const user = userEvent.setup();

    render(<RectifierConfigPanel target={remoteTarget} />);

    await waitFor(() => {
      expect(getRectifierConfigMock).toHaveBeenCalledWith(
        profile,
        remoteTarget.secret,
      );
      expect(getOptimizerConfigMock).toHaveBeenCalledWith(
        profile,
        remoteTarget.secret,
      );
    });

    const switches = await screen.findAllByRole("switch");
    expect(switches).toHaveLength(8);

    await user.click(switches[0]);
    await waitFor(() => {
      expect(setRectifierConfigMock).toHaveBeenCalledWith(
        profile,
        { ...rectifierConfig, enabled: false },
        remoteTarget.secret,
      );
    });

    await user.click(switches[5]);
    await waitFor(() => {
      expect(setOptimizerConfigMock).toHaveBeenCalledWith(
        profile,
        { ...optimizerConfig, enabled: true },
        remoteTarget.secret,
      );
    });

    expect(localSetRectifierConfigMock).not.toHaveBeenCalled();
    expect(localSetOptimizerConfigMock).not.toHaveBeenCalled();
  });
});
