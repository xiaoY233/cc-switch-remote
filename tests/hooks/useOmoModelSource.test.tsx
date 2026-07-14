import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useOmoModelSource } from "@/components/providers/forms/hooks/useOmoModelSource";
import { providersApi, type RemoteHostProfile } from "@/lib/api";

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
  });

  it("uses remote OpenCode live provider ids when target is remote", async () => {
    const liveIdsSpy = vi
      .spyOn(providersApi, "getOpenCodeLiveProviderIds")
      .mockResolvedValue(["enabledProvider"]);

    const { result } = renderHook(() =>
      useOmoModelSource({
        isOmoCategory: true,
        target: remoteTarget,
      }),
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
});
