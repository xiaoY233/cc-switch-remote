import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import type { PropsWithChildren } from "react";
import { useForm } from "react-hook-form";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CodexFormFields } from "@/components/providers/forms/CodexFormFields";
import { GeminiFormFields } from "@/components/providers/forms/GeminiFormFields";
import { HermesFormFields } from "@/components/providers/forms/HermesFormFields";
import { OpenClawFormFields } from "@/components/providers/forms/OpenClawFormFields";
import { OpenCodeFormFields } from "@/components/providers/forms/OpenCodeFormFields";
import { Form } from "@/components/ui/form";
import type { AppId, ManagementTarget } from "@/lib/api";

const modelFetchApiMock = vi.hoisted(() => ({
  canUseStoredRemoteProviderApiKey: vi.fn(),
  fetchModelsForProviderConfig: vi.fn(),
  showFetchModelsError: vi.fn(),
}));

vi.mock("@/lib/api/model-fetch", () => ({
  canUseStoredRemoteProviderApiKey:
    modelFetchApiMock.canUseStoredRemoteProviderApiKey,
  fetchModelsForProviderConfig: modelFetchApiMock.fetchModelsForProviderConfig,
  showFetchModelsError: modelFetchApiMock.showFetchModelsError,
}));

vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}));

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

const clickFetchModels = async () => {
  let button =
    screen.queryByTitle("providerForm.fetchModels") ??
    screen.queryByRole("button", { name: "providerForm.fetchModels" });

  if (!button) {
    const advancedButton = screen.queryByRole("button", { name: "高级选项" });
    if (advancedButton) {
      fireEvent.click(advancedButton);
      button = await screen.findByRole("button", {
        name: "providerForm.fetchModels",
      });
    }
  }

  fireEvent.click(
    button ?? screen.getByRole("button", { name: "providerForm.fetchModels" }),
  );
};

const FormShell = ({ children }: PropsWithChildren) => {
  const form = useForm();
  return <Form {...form}>{children}</Form>;
};

const renderField = (node: React.ReactElement) => {
  render(<FormShell>{node}</FormShell>);
};

describe("provider model fetch fields", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    modelFetchApiMock.canUseStoredRemoteProviderApiKey.mockImplementation(
      (target, providerId) => target?.type === "remote" && Boolean(providerId),
    );
    modelFetchApiMock.fetchModelsForProviderConfig.mockResolvedValue([
      { id: "model-a", ownedBy: "test" },
    ]);
  });

  it.each([
    ["codex", "remote-codex"],
    ["gemini", "remote-gemini"],
    ["opencode", "remote-opencode"],
    ["openclaw", "remote-openclaw"],
    ["hermes", "remote-hermes"],
  ] as const)(
    "远程编辑 %s 供应商时 API Key 留空也用远端已保存密钥获取模型",
    async (appId, providerId) => {
      renderRemoteModelFetchField(appId, providerId);

      await clickFetchModels();

      await waitFor(() =>
        expect(
          modelFetchApiMock.fetchModelsForProviderConfig,
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            app: appId,
            providerId,
            target: remoteTarget,
            baseUrl: "https://api.example.com/v1",
            apiKey: "",
          }),
        ),
      );
      expect(modelFetchApiMock.showFetchModelsError).not.toHaveBeenCalledWith(
        null,
        expect.any(Function),
        expect.objectContaining({ hasApiKey: false }),
      );
    },
  );
});

function renderRemoteModelFetchField(appId: AppId, providerId: string) {
  const baseProps = {
    providerId,
    modelFetchTarget: remoteTarget,
    category: "custom" as const,
    apiKeyPlaceholder: "Leave blank to keep the current API key.",
    shouldShowApiKeyLink: false,
    websiteUrl: "",
    isPartner: false,
    partnerPromotionKey: undefined,
  };

  if (appId === "codex") {
    const props: ComponentProps<typeof CodexFormFields> = {
      ...baseProps,
      codexApiKey: "",
      onApiKeyChange: vi.fn(),
      shouldShowSpeedTest: false,
      codexBaseUrl: "https://api.example.com/v1",
      onBaseUrlChange: vi.fn(),
      isFullUrl: false,
      onFullUrlChange: vi.fn(),
      isEndpointModalOpen: false,
      onEndpointModalToggle: vi.fn(),
      onCustomEndpointsChange: vi.fn(),
      autoSelect: false,
      onAutoSelectChange: vi.fn(),
      apiFormat: "openai_chat",
      onApiFormatChange: vi.fn(),
      anthropicAuthField: "ANTHROPIC_AUTH_TOKEN",
      onAnthropicAuthFieldChange: vi.fn(),
      impersonateClaudeCode: false,
      onImpersonateClaudeCodeChange: vi.fn(),
      maxOutputTokens: "",
      onMaxOutputTokensChange: vi.fn(),
      promptCacheRouting: "auto",
      onPromptCacheRoutingChange: vi.fn(),
      catalogModels: [],
      onCatalogModelsChange: vi.fn(),
      speedTestEndpoints: [],
      customUserAgent: "",
      onCustomUserAgentChange: vi.fn(),
      localProxyHeadersOverride: "",
      onLocalProxyHeadersOverrideChange: vi.fn(),
      localProxyBodyOverride: "",
      onLocalProxyBodyOverrideChange: vi.fn(),
    };
    renderField(<CodexFormFields {...props} />);
    return;
  }

  if (appId === "gemini") {
    const props: ComponentProps<typeof GeminiFormFields> = {
      ...baseProps,
      shouldShowApiKey: true,
      apiKey: "",
      onApiKeyChange: vi.fn(),
      shouldShowSpeedTest: false,
      baseUrl: "https://api.example.com/v1",
      onBaseUrlChange: vi.fn(),
      isEndpointModalOpen: false,
      onEndpointModalToggle: vi.fn(),
      onCustomEndpointsChange: vi.fn(),
      autoSelect: false,
      onAutoSelectChange: vi.fn(),
      shouldShowModelField: true,
      model: "",
      onModelChange: vi.fn(),
      speedTestEndpoints: [],
    };
    renderField(<GeminiFormFields {...props} />);
    return;
  }

  if (appId === "opencode") {
    const props: ComponentProps<typeof OpenCodeFormFields> = {
      ...baseProps,
      npm: "@ai-sdk/openai-compatible",
      onNpmChange: vi.fn(),
      apiKey: "",
      onApiKeyChange: vi.fn(),
      baseUrl: "https://api.example.com/v1",
      onBaseUrlChange: vi.fn(),
      headers: {},
      onHeadersChange: vi.fn(),
      models: {},
      onModelsChange: vi.fn(),
      extraOptions: {},
      onExtraOptionsChange: vi.fn(),
    };
    renderField(<OpenCodeFormFields {...props} />);
    return;
  }

  if (appId === "openclaw") {
    const props: ComponentProps<typeof OpenClawFormFields> = {
      ...baseProps,
      baseUrl: "https://api.example.com/v1",
      onBaseUrlChange: vi.fn(),
      apiKey: "",
      onApiKeyChange: vi.fn(),
      api: "openai-completions",
      onApiChange: vi.fn(),
      models: [],
      onModelsChange: vi.fn(),
      userAgent: true,
      onUserAgentChange: vi.fn(),
    };
    renderField(<OpenClawFormFields {...props} />);
    return;
  }

  const props: ComponentProps<typeof HermesFormFields> = {
    ...baseProps,
    baseUrl: "https://api.example.com/v1",
    onBaseUrlChange: vi.fn(),
    apiKey: "",
    onApiKeyChange: vi.fn(),
    apiMode: "chat_completions",
    onApiModeChange: vi.fn(),
    models: [],
    onModelsChange: vi.fn(),
    rateLimitDelay: undefined,
    onRateLimitDelayChange: vi.fn(),
  };
  renderField(<HermesFormFields {...props} />);
}
