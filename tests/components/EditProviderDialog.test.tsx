import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Provider } from "@/types";
import type { AppId, ManagementTarget } from "@/lib/api";

const apiMocks = vi.hoisted(() => ({
  getCurrent: vi.fn(),
  getLiveProviderSettings: vi.fn(),
  getOpenClawLiveProvider: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  providersApi: {
    getCurrent: apiMocks.getCurrent,
  },
  vscodeApi: {
    getLiveProviderSettings: apiMocks.getLiveProviderSettings,
  },
  openclawApi: {
    getLiveProvider: apiMocks.getOpenClawLiveProvider,
  },
}));

vi.mock("@/components/common/FullScreenPanel", () => ({
  FullScreenPanel: ({
    isOpen,
    children,
    footer,
  }: {
    isOpen: boolean;
    children: React.ReactNode;
    footer?: React.ReactNode;
  }) =>
    isOpen ? (
      <div>
        <div>{children}</div>
        <div>{footer}</div>
      </div>
    ) : null,
}));

vi.mock("@/components/providers/forms/ProviderForm", () => ({
  ProviderForm: ({
    initialData,
    onSubmit,
    isProxyTakeover,
  }: {
    initialData: {
      name?: string;
      websiteUrl?: string;
      notes?: string;
      settingsConfig?: Record<string, unknown>;
      meta?: Record<string, unknown>;
      icon?: string;
      iconColor?: string;
    };
    onSubmit: (values: {
      name: string;
      websiteUrl: string;
      notes?: string;
      settingsConfig: string;
      meta?: Record<string, unknown>;
      icon?: string;
      iconColor?: string;
    }) => void;
    isProxyTakeover?: boolean;
  }) => (
    <form
      id="provider-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({
          name: initialData.name ?? "",
          websiteUrl: initialData.websiteUrl ?? "",
          notes: initialData.notes,
          settingsConfig: JSON.stringify(initialData.settingsConfig ?? {}),
          meta: initialData.meta,
          icon: initialData.icon,
          iconColor: initialData.iconColor,
        });
      }}
    >
      <output data-testid="settings-config">
        {JSON.stringify(initialData.settingsConfig ?? {})}
      </output>
      <output data-testid="is-proxy-takeover">
        {isProxyTakeover ? "true" : "false"}
      </output>
    </form>
  ),
}));

import { EditProviderDialog } from "@/components/providers/EditProviderDialog";

describe("EditProviderDialog", () => {
  beforeEach(() => {
    apiMocks.getCurrent.mockReset();
    apiMocks.getLiveProviderSettings.mockReset();
    apiMocks.getOpenClawLiveProvider.mockReset();
  });

  it("保留 Codex 数据库中的 modelCatalog，避免 live 配置缺字段时清空模型映射", async () => {
    const dbModelCatalog = {
      models: [
        {
          model: "deepseek-v4-flash",
          displayName: "DeepSeek V4 Flash",
          contextWindow: 1000000,
        },
      ],
    };
    const provider: Provider = {
      id: "deepseek",
      name: "DeepSeek",
      category: "aggregator",
      settingsConfig: {
        auth: {
          OPENAI_API_KEY: "db-key",
        },
        config: 'model_provider = "custom"\nmodel = "deepseek-v4-flash"\n',
        modelCatalog: dbModelCatalog,
      },
    };
    const liveSettings = {
      auth: {
        OPENAI_API_KEY: "live-key",
      },
      config: 'model_provider = "custom"\nmodel = "deepseek-v4-pro"\n',
    };
    const handleSubmit = vi.fn().mockResolvedValue(undefined);

    apiMocks.getCurrent.mockResolvedValue(provider.id);
    apiMocks.getLiveProviderSettings.mockResolvedValue(liveSettings);

    render(
      <EditProviderDialog
        open
        provider={provider}
        onOpenChange={vi.fn()}
        onSubmit={handleSubmit}
        appId="codex"
      />,
    );

    await waitFor(() => {
      expect(
        JSON.parse(screen.getByTestId("settings-config").textContent ?? "{}"),
      ).toEqual({
        ...liveSettings,
        modelCatalog: dbModelCatalog,
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() => expect(handleSubmit).toHaveBeenCalledTimes(1));
    expect(handleSubmit.mock.calls[0][0].provider.settingsConfig).toEqual({
      ...liveSettings,
      modelCatalog: dbModelCatalog,
    });
  });

  it("代理接管中编辑 Codex 供应商时展示数据库配置而不是读取 live 代理配置", async () => {
    const provider: Provider = {
      id: "deepseek",
      name: "DeepSeek",
      category: "custom",
      settingsConfig: {
        auth: {
          OPENAI_API_KEY: "db-key",
        },
        config:
          'model_provider = "custom"\n[model_providers.custom]\nbase_url = "https://api.deepseek.com/v1"\n',
      },
    };

    apiMocks.getCurrent.mockResolvedValue(provider.id);
    apiMocks.getLiveProviderSettings.mockResolvedValue({
      auth: {
        OPENAI_API_KEY: "PROXY_MANAGED",
      },
      config:
        'model_provider = "custom"\n[model_providers.custom]\nbase_url = "http://127.0.0.1:15721/v1"\nexperimental_bearer_token = "PROXY_MANAGED"\n',
    });

    render(
      <EditProviderDialog
        open
        provider={provider}
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
        appId="codex"
        isProxyTakeover
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("is-proxy-takeover").textContent).toBe("true");
    });

    expect(apiMocks.getLiveProviderSettings).not.toHaveBeenCalled();
    expect(
      JSON.parse(screen.getByTestId("settings-config").textContent ?? "{}"),
    ).toEqual(provider.settingsConfig);
  });

  it.each<[AppId, Record<string, unknown>, Record<string, unknown>, string]>([
    [
      "claude",
      {
        env: {
          ANTHROPIC_BASE_URL: "https://api.example.com",
          ANTHROPIC_AUTH_TOKEN: "[redacted]",
        },
      },
      {
        env: {
          ANTHROPIC_BASE_URL: "https://api.example.com",
          ANTHROPIC_AUTH_TOKEN: "",
        },
      },
      "Claude",
    ],
    [
      "gemini",
      {
        env: {
          GOOGLE_GEMINI_BASE_URL: "https://api.example.com",
          GEMINI_API_KEY: "[redacted]",
        },
        config: {},
      },
      {
        env: {
          GOOGLE_GEMINI_BASE_URL: "https://api.example.com",
          GEMINI_API_KEY: "",
        },
        config: {},
      },
      "Gemini",
    ],
    [
      "opencode",
      {
        npm: "@ai-sdk/openai-compatible",
        options: {
          baseURL: "https://api.example.com/v1",
          apiKey: "[redacted]",
        },
        models: {},
      },
      {
        npm: "@ai-sdk/openai-compatible",
        options: {
          baseURL: "https://api.example.com/v1",
          apiKey: "",
        },
        models: {},
      },
      "OpenCode",
    ],
    [
      "openclaw",
      {
        baseUrl: "https://api.example.com/v1",
        apiKey: "[redacted]",
        api: "openai-completions",
        models: [],
      },
      {
        baseUrl: "https://api.example.com/v1",
        apiKey: "",
        api: "openai-completions",
        models: [],
      },
      "OpenClaw",
    ],
    [
      "hermes",
      {
        base_url: "https://api.example.com/v1",
        api_key: "[redacted]",
      },
      {
        base_url: "https://api.example.com/v1",
        api_key: "",
      },
      "Hermes",
    ],
    [
      "codex",
      {
        auth: {
          OPENAI_API_KEY: "[redacted]",
        },
        config:
          'model_provider = "custom"\n[model_providers.custom]\nbase_url = "https://api.example.com/v1"\nexperimental_bearer_token = "[redacted]"\n',
      },
      {
        auth: {
          OPENAI_API_KEY: "",
        },
        config:
          'model_provider = "custom"\n[model_providers.custom]\nbase_url = "https://api.example.com/v1"\nexperimental_bearer_token = ""\n',
      },
      "Codex",
    ],
  ])(
    "远程编辑 %s 供应商时隐藏 redacted secret 但提交保留哨兵",
    async (appId, settingsConfig, hiddenConfig, label) => {
      const remoteTarget: ManagementTarget = {
        type: "remote",
        profile: {
          id: "remote-host",
          name: "Remote Host",
          host: "192.0.2.10",
          port: 22,
          username: "root",
          authMethod: { type: "sshAgent" },
          helperPath: "/root/.local/bin/cc-switch-remote-helper",
          createdAt: 1,
          updatedAt: 1,
        },
      };
      const provider: Provider = {
        id: `${appId}-provider`,
        name: `${label} Provider`,
        category: "custom",
        settingsConfig,
      };
      const handleSubmit = vi.fn().mockResolvedValue(undefined);

      render(
        <EditProviderDialog
          open
          provider={provider}
          onOpenChange={vi.fn()}
          onSubmit={handleSubmit}
          appId={appId}
          target={remoteTarget}
        />,
      );

      await waitFor(() => {
        expect(
          JSON.parse(screen.getByTestId("settings-config").textContent ?? "{}"),
        ).toEqual(hiddenConfig);
      });

      fireEvent.click(screen.getByRole("button", { name: "common.save" }));

      await waitFor(() => expect(handleSubmit).toHaveBeenCalledTimes(1));
      expect(handleSubmit.mock.calls[0][0].provider.settingsConfig).toEqual(
        settingsConfig,
      );
    },
  );
});
