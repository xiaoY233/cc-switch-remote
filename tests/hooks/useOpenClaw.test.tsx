import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useOpenClawAgentsDefaults,
  useOpenClawDefaultModel,
  useOpenClawEnv,
  useOpenClawHealth,
  useOpenClawTools,
  useSaveOpenClawAgentsDefaults,
  useSaveOpenClawEnv,
  useSaveOpenClawTools,
} from "@/hooks/useOpenClaw";
import type { ManagementTarget } from "@/lib/api";

const openclawApiGetDefaultModelMock = vi.fn();
const openclawApiGetEnvMock = vi.fn();
const openclawApiSetEnvMock = vi.fn();
const openclawApiGetToolsMock = vi.fn();
const openclawApiSetToolsMock = vi.fn();
const openclawApiGetAgentsDefaultsMock = vi.fn();
const openclawApiSetAgentsDefaultsMock = vi.fn();
const openclawApiScanHealthMock = vi.fn();
const remoteApiGetOpenClawDefaultModelMock = vi.fn();
const remoteApiGetOpenClawEnvMock = vi.fn();
const remoteApiSetOpenClawEnvMock = vi.fn();
const remoteApiGetOpenClawToolsMock = vi.fn();
const remoteApiSetOpenClawToolsMock = vi.fn();
const remoteApiGetOpenClawAgentsDefaultsMock = vi.fn();
const remoteApiSetOpenClawAgentsDefaultsMock = vi.fn();
const remoteApiScanOpenClawHealthMock = vi.fn();

vi.mock("@/lib/api/openclaw", () => ({
  openclawApi: {
    getDefaultModel: (...args: unknown[]) =>
      openclawApiGetDefaultModelMock(...args),
    getEnv: (...args: unknown[]) => openclawApiGetEnvMock(...args),
    setEnv: (...args: unknown[]) => openclawApiSetEnvMock(...args),
    getTools: (...args: unknown[]) => openclawApiGetToolsMock(...args),
    setTools: (...args: unknown[]) => openclawApiSetToolsMock(...args),
    getAgentsDefaults: (...args: unknown[]) =>
      openclawApiGetAgentsDefaultsMock(...args),
    setAgentsDefaults: (...args: unknown[]) =>
      openclawApiSetAgentsDefaultsMock(...args),
    scanHealth: (...args: unknown[]) => openclawApiScanHealthMock(...args),
  },
}));

vi.mock("@/lib/api/remote", () => ({
  remoteApi: {
    getOpenClawDefaultModel: (...args: unknown[]) =>
      remoteApiGetOpenClawDefaultModelMock(...args),
    getOpenClawEnv: (...args: unknown[]) =>
      remoteApiGetOpenClawEnvMock(...args),
    setOpenClawEnv: (...args: unknown[]) =>
      remoteApiSetOpenClawEnvMock(...args),
    getOpenClawTools: (...args: unknown[]) =>
      remoteApiGetOpenClawToolsMock(...args),
    setOpenClawTools: (...args: unknown[]) =>
      remoteApiSetOpenClawToolsMock(...args),
    getOpenClawAgentsDefaults: (...args: unknown[]) =>
      remoteApiGetOpenClawAgentsDefaultsMock(...args),
    setOpenClawAgentsDefaults: (...args: unknown[]) =>
      remoteApiSetOpenClawAgentsDefaultsMock(...args),
    scanOpenClawHealth: (...args: unknown[]) =>
      remoteApiScanOpenClawHealthMock(...args),
  },
}));

const remoteTarget: ManagementTarget = {
  type: "remote",
  profile: {
    id: "remote-1",
    name: "Remote 1",
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

interface WrapperProps {
  children: ReactNode;
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: WrapperProps) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { wrapper };
}

describe("useOpenClawDefaultModel", () => {
  beforeEach(() => {
    openclawApiGetDefaultModelMock.mockReset();
    openclawApiGetEnvMock.mockReset();
    openclawApiSetEnvMock.mockReset();
    openclawApiGetToolsMock.mockReset();
    openclawApiSetToolsMock.mockReset();
    openclawApiGetAgentsDefaultsMock.mockReset();
    openclawApiSetAgentsDefaultsMock.mockReset();
    openclawApiScanHealthMock.mockReset();
    remoteApiGetOpenClawDefaultModelMock.mockReset();
    remoteApiGetOpenClawEnvMock.mockReset();
    remoteApiSetOpenClawEnvMock.mockReset();
    remoteApiGetOpenClawToolsMock.mockReset();
    remoteApiSetOpenClawToolsMock.mockReset();
    remoteApiGetOpenClawAgentsDefaultsMock.mockReset();
    remoteApiSetOpenClawAgentsDefaultsMock.mockReset();
    remoteApiScanOpenClawHealthMock.mockReset();
  });

  it("queries the remote helper for remote targets", async () => {
    remoteApiGetOpenClawDefaultModelMock.mockResolvedValueOnce({
      primary: "remote-provider/gpt-4.1",
    });
    const { wrapper } = createWrapper();

    const { result } = renderHook(
      () => useOpenClawDefaultModel(true, remoteTarget),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.data?.primary).toBe("remote-provider/gpt-4.1");
    });

    expect(remoteApiGetOpenClawDefaultModelMock).toHaveBeenCalledWith(
      remoteTarget.profile,
      remoteTarget.secret,
    );
    expect(openclawApiGetDefaultModelMock).not.toHaveBeenCalled();
  });

  it("queries remote env, tools, and agents defaults for remote targets", async () => {
    remoteApiGetOpenClawEnvMock.mockResolvedValueOnce({
      vars: { NODE_ENV: "remote" },
    });
    remoteApiGetOpenClawToolsMock.mockResolvedValueOnce({
      profile: "coding",
      allow: ["Bash(*)"],
    });
    remoteApiGetOpenClawAgentsDefaultsMock.mockResolvedValueOnce({
      workspace: "~/remote",
    });
    const { wrapper } = createWrapper();

    const env = renderHook(() => useOpenClawEnv(remoteTarget), { wrapper });
    const tools = renderHook(() => useOpenClawTools(remoteTarget), {
      wrapper,
    });
    const agents = renderHook(() => useOpenClawAgentsDefaults(remoteTarget), {
      wrapper,
    });

    await waitFor(() => {
      expect(env.result.current.data?.vars).toEqual({ NODE_ENV: "remote" });
      expect(tools.result.current.data?.profile).toBe("coding");
      expect(agents.result.current.data?.workspace).toBe("~/remote");
    });

    expect(remoteApiGetOpenClawEnvMock).toHaveBeenCalledWith(
      remoteTarget.profile,
      remoteTarget.secret,
    );
    expect(remoteApiGetOpenClawToolsMock).toHaveBeenCalledWith(
      remoteTarget.profile,
      remoteTarget.secret,
    );
    expect(remoteApiGetOpenClawAgentsDefaultsMock).toHaveBeenCalledWith(
      remoteTarget.profile,
      remoteTarget.secret,
    );
    expect(openclawApiGetEnvMock).not.toHaveBeenCalled();
    expect(openclawApiGetToolsMock).not.toHaveBeenCalled();
    expect(openclawApiGetAgentsDefaultsMock).not.toHaveBeenCalled();
  });

  it("saves remote env, tools, and agents defaults through the remote helper", async () => {
    remoteApiSetOpenClawEnvMock.mockResolvedValue({
      warnings: [],
    });
    remoteApiSetOpenClawToolsMock.mockResolvedValue({
      warnings: [],
    });
    remoteApiSetOpenClawAgentsDefaultsMock.mockResolvedValue({
      warnings: [],
    });
    const { wrapper } = createWrapper();
    const env = renderHook(() => useSaveOpenClawEnv(remoteTarget), {
      wrapper,
    });
    const tools = renderHook(() => useSaveOpenClawTools(remoteTarget), {
      wrapper,
    });
    const agents = renderHook(
      () => useSaveOpenClawAgentsDefaults(remoteTarget),
      { wrapper },
    );

    await env.result.current.mutateAsync({ vars: { NODE_ENV: "remote" } });
    await tools.result.current.mutateAsync({ profile: "coding" });
    await agents.result.current.mutateAsync({ workspace: "~/remote" });

    expect(remoteApiSetOpenClawEnvMock).toHaveBeenCalledWith(
      remoteTarget.profile,
      { vars: { NODE_ENV: "remote" } },
      remoteTarget.secret,
    );
    expect(remoteApiSetOpenClawToolsMock).toHaveBeenCalledWith(
      remoteTarget.profile,
      { profile: "coding" },
      remoteTarget.secret,
    );
    expect(remoteApiSetOpenClawAgentsDefaultsMock).toHaveBeenCalledWith(
      remoteTarget.profile,
      { workspace: "~/remote" },
      remoteTarget.secret,
    );
    expect(openclawApiSetEnvMock).not.toHaveBeenCalled();
    expect(openclawApiSetToolsMock).not.toHaveBeenCalled();
    expect(openclawApiSetAgentsDefaultsMock).not.toHaveBeenCalled();
  });

  it("scans OpenClaw config health through the remote helper for remote targets", async () => {
    remoteApiScanOpenClawHealthMock.mockResolvedValueOnce([
      {
        code: "openclaw.config.missing",
        message: "Remote config missing",
      },
    ]);
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useOpenClawHealth(true, remoteTarget), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.data?.[0]?.message).toBe("Remote config missing");
    });

    expect(remoteApiScanOpenClawHealthMock).toHaveBeenCalledWith(
      remoteTarget.profile,
      remoteTarget.secret,
    );
    expect(openclawApiScanHealthMock).not.toHaveBeenCalled();
  });
});
