import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useOmoModelSource } from "@/components/providers/forms/hooks/useOmoModelSource";
import {
  providersApi,
  type ManagementTarget,
  type RemoteHostProfile,
} from "@/lib/api";
import { LOCAL_MANAGEMENT_TARGET } from "@/lib/managementTarget";

const getOpenCodeModelsMock = vi.hoisted(() => vi.fn());

const remoteProfile: RemoteHostProfile = {
  id: "remote-host",
  name: "Remote Host",
  host: "192.0.2.10",
  port: 22,
  username: "root",
  authMethod: { type: "sshAgent" },
  helperPath: "/root/.local/bin/cc-switch-remote-helper",
  createdAt: 1,
  updatedAt: 1,
};

const remoteTarget = {
  type: "remote" as const,
  profile: remoteProfile,
  secret: { password: "secret" },
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? _key,
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    warning: vi.fn(),
  },
}));

vi.mock("@/lib/api/model-fetch", () => ({
  getOpenCodeModels: (...args: unknown[]) => getOpenCodeModelsMock(...args),
}));

vi.mock("@/lib/query/queries", () => ({
  useProvidersQuery: () => ({
    data: {
      providers: {
        enabledProvider: {
          id: "enabledProvider",
          name: "Enabled Provider",
          category: "third_party",
          settingsConfig: {
            npm: "@ai-sdk/openai-compatible",
            models: {
              "gpt-5": {
                name: "GPT-5",
              },
            },
          },
        },
        disabledProvider: {
          id: "disabledProvider",
          name: "Disabled Provider",
          category: "third_party",
          settingsConfig: {
            npm: "@ai-sdk/openai-compatible",
            models: {
              "gpt-4.1": {
                name: "GPT-4.1",
              },
            },
          },
        },
      },
    },
  }),
}));

describe("useOmoModelSource", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    getOpenCodeModelsMock.mockReset();
    getOpenCodeModelsMock.mockResolvedValue([]);
  });

  function createWrapper() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }

  function wrapperFor(queryClient: QueryClient) {
    return ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }

  it("uses remote OpenCode live provider ids when target is remote", async () => {
    const liveIdsSpy = vi
      .spyOn(providersApi, "getOpenCodeLiveProviderIds")
      .mockResolvedValue(["enabledProvider"]);

    const { result } = renderHook(
      () =>
        useOmoModelSource({
          isOmoCategory: true,
          target: remoteTarget,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(liveIdsSpy).toHaveBeenCalledWith(remoteTarget);
    });

    await waitFor(() => {
      expect(result.current.omoModelOptions).toEqual([
        {
          value: "enabledProvider/gpt-5",
          label: "Enabled Provider / GPT-5 (gpt-5)",
        },
      ]);
    });
  });

  it("loads remote runtime models for the selected target", async () => {
    vi.spyOn(providersApi, "getOpenCodeLiveProviderIds").mockResolvedValue([]);
    getOpenCodeModelsMock.mockResolvedValue([
      { providerId: "remote-oauth", modelId: "gpt-5-remote" },
    ]);

    const { result } = renderHook(
      () =>
        useOmoModelSource({
          isOmoCategory: true,
          target: remoteTarget,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(getOpenCodeModelsMock).toHaveBeenCalledWith(remoteTarget);
      expect(result.current.omoModelOptions).toContainEqual({
        value: "remote-oauth/gpt-5-remote",
        label: "remote-oauth / gpt-5-remote",
      });
    });
  });

  it("does not reuse local runtime models after switching to a remote target", async () => {
    vi.spyOn(providersApi, "getOpenCodeLiveProviderIds").mockResolvedValue([]);
    getOpenCodeModelsMock.mockImplementation((target: ManagementTarget) =>
      Promise.resolve(
        target.type === "remote"
          ? [{ providerId: "remote-oauth", modelId: "remote-model" }]
          : [{ providerId: "local-oauth", modelId: "local-model" }],
      ),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = wrapperFor(queryClient);

    const local = renderHook(
      () =>
        useOmoModelSource({
          isOmoCategory: true,
          target: LOCAL_MANAGEMENT_TARGET,
        }),
      { wrapper },
    );
    await waitFor(() => {
      expect(local.result.current.omoModelOptions).toContainEqual({
        value: "local-oauth/local-model",
        label: "local-oauth / local-model",
      });
    });
    local.unmount();

    const remote = renderHook(
      () =>
        useOmoModelSource({
          isOmoCategory: true,
          target: remoteTarget,
        }),
      { wrapper },
    );
    await waitFor(() => {
      expect(getOpenCodeModelsMock).toHaveBeenCalledWith(remoteTarget);
      expect(remote.result.current.omoModelOptions).toContainEqual({
        value: "remote-oauth/remote-model",
        label: "remote-oauth / remote-model",
      });
    });
  });
});
