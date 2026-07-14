import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUpdateProviderMutation } from "@/lib/query/mutations";
import { LOCAL_MANAGEMENT_TARGET } from "@/lib/managementTarget";
import { usageKeys } from "@/lib/query/usage";
import type { Provider } from "@/types";
import { invalidateHermesProviderCaches } from "@/hooks/useHermes";
import type { ManagementTarget } from "@/lib/api";

const apiMocks = vi.hoisted(() => ({
  update: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  providersApi: {
    update: (...args: unknown[]) => apiMocks.update(...args),
  },
  sessionsApi: {},
  settingsApi: {},
}));

vi.mock("@/hooks/useHermes", () => ({
  invalidateHermesProviderCaches: vi.fn(),
}));

vi.mock("@/hooks/useOpenClaw", () => ({
  openclawKeys: {
    health: ["openclaw", "health"],
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? _key,
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return { wrapper, invalidateSpy };
}

function createProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: "provider-1",
    name: "Test Provider",
    settingsConfig: {},
    ...overrides,
  };
}

beforeEach(() => {
  apiMocks.update.mockReset().mockResolvedValue(true);
  vi.mocked(invalidateHermesProviderCaches).mockReset();
});

describe("useUpdateProviderMutation", () => {
  it("invalidates the updated provider usage query", async () => {
    const { wrapper, invalidateSpy } = createWrapper();
    const provider = createProvider({ id: "provider-b" });
    const { result } = renderHook(() => useUpdateProviderMutation("codex"), {
      wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({ provider });
    });

    expect(apiMocks.update).toHaveBeenCalledWith(
      provider,
      "codex",
      undefined,
      LOCAL_MANAGEMENT_TARGET,
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["providers", "codex", "local"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: usageKeys.script("provider-b", "codex"),
    });
    expect(invalidateSpy).not.toHaveBeenCalledWith({
      queryKey: usageKeys.all,
    });
  });

  it("also invalidates the previous usage query when provider id changes", async () => {
    const { wrapper, invalidateSpy } = createWrapper();
    const provider = createProvider({ id: "provider-new" });
    const { result } = renderHook(() => useUpdateProviderMutation("openclaw"), {
      wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({
        provider,
        originalId: "provider-old",
      });
    });

    expect(apiMocks.update).toHaveBeenCalledWith(
      provider,
      "openclaw",
      "provider-old",
      LOCAL_MANAGEMENT_TARGET,
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: usageKeys.script("provider-new", "openclaw"),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: usageKeys.script("provider-old", "openclaw"),
    });
    expect(invalidateSpy).not.toHaveBeenCalledWith({
      queryKey: usageKeys.all,
    });
  });

  it("invalidates Hermes provider caches for the selected remote target", async () => {
    const { wrapper } = createWrapper();
    const remoteTarget: ManagementTarget = {
      type: "remote",
      profile: {
        id: "remote-hermes",
        name: "Remote Hermes",
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
    const provider = createProvider({ id: "provider-hermes" });
    const { result } = renderHook(
      () => useUpdateProviderMutation("hermes", remoteTarget),
      { wrapper },
    );

    await act(async () => {
      await result.current.mutateAsync({ provider });
    });

    expect(apiMocks.update).toHaveBeenCalledWith(
      provider,
      "hermes",
      undefined,
      remoteTarget,
    );
    expect(invalidateHermesProviderCaches).toHaveBeenCalledWith(
      expect.any(QueryClient),
      remoteTarget,
    );
  });
});
