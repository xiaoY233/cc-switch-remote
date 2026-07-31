import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAddProviderMutation } from "./mutations";
import type { ManagementTarget, RemoteHostProfile } from "@/lib/api";
import { GROKBUILD_OFFICIAL_PROVIDER_ID } from "@/utils/providerCapabilities";

const providersApiMock = vi.hoisted(() => ({
  ensureGrokBuildOfficialProvider: vi.fn(),
  getAll: vi.fn(),
  add: vi.fn(),
  updateTrayMenu: vi.fn(),
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    providersApi: providersApiMock,
  };
});

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

const remoteTarget: ManagementTarget = {
  type: "remote",
  profile: remoteProfile,
  secret: { password: "secret" },
};

function wrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("provider mutations target routing", () => {
  beforeEach(() => {
    providersApiMock.ensureGrokBuildOfficialProvider.mockReset();
    providersApiMock.getAll.mockReset();
    providersApiMock.add.mockReset();
    providersApiMock.updateTrayMenu.mockReset();
  });

  it("restores the fixed Grok Build official seed on the remote target instead of adding a random provider", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    providersApiMock.ensureGrokBuildOfficialProvider.mockResolvedValueOnce(
      true,
    );
    providersApiMock.getAll.mockResolvedValueOnce({
      [GROKBUILD_OFFICIAL_PROVIDER_ID]: {
        id: GROKBUILD_OFFICIAL_PROVIDER_ID,
        name: "Grok Official",
        category: "official",
        settingsConfig: {},
      },
    });

    const { result } = renderHook(
      () => useAddProviderMutation("grokbuild", remoteTarget),
      { wrapper: wrapper(queryClient) },
    );

    await act(async () => {
      await result.current.mutateAsync({
        name: "Grok Official",
        settingsConfig: {},
        category: "official",
        ensureGrokBuildOfficialSeed: true,
      });
    });

    expect(
      providersApiMock.ensureGrokBuildOfficialProvider,
    ).toHaveBeenCalledWith(remoteTarget);
    expect(providersApiMock.getAll).toHaveBeenCalledWith(
      "grokbuild",
      remoteTarget,
    );
    expect(providersApiMock.add).not.toHaveBeenCalled();
  });
});
