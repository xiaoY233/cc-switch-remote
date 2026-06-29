import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps, PropsWithChildren } from "react";
import { useForm } from "react-hook-form";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClaudeFormFields } from "@/components/providers/forms/ClaudeFormFields";
import { Form } from "@/components/ui/form";

const copilotApiMock = vi.hoisted(() => ({
  copilotGetModelsForTarget: vi.fn(),
}));

const modelFetchApiMock = vi.hoisted(() => ({
  canUseStoredRemoteProviderApiKey: vi.fn(),
  fetchCodexOauthModels: vi.fn(),
  fetchModelsForConfig: vi.fn(),
  fetchModelsForProviderConfig: vi.fn(),
  showFetchModelsError: vi.fn(),
}));

const codexOAuthSectionMock = vi.hoisted(() => vi.fn());
const copilotAuthSectionMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/copilot", () => ({
  copilotGetModelsForTarget: copilotApiMock.copilotGetModelsForTarget,
}));

vi.mock("@/lib/api/model-fetch", () => ({
  canUseStoredRemoteProviderApiKey:
    modelFetchApiMock.canUseStoredRemoteProviderApiKey,
  fetchCodexOauthModels: modelFetchApiMock.fetchCodexOauthModels,
  fetchModelsForConfig: modelFetchApiMock.fetchModelsForConfig,
  fetchModelsForProviderConfig: modelFetchApiMock.fetchModelsForProviderConfig,
  showFetchModelsError: modelFetchApiMock.showFetchModelsError,
}));

vi.mock("@/components/providers/forms/CopilotAuthSection", () => ({
  CopilotAuthSection: (props: unknown) => {
    copilotAuthSectionMock(props);
    return <div data-testid="copilot-auth-section" />;
  },
}));

vi.mock("@/components/providers/forms/CodexOAuthSection", () => ({
  CodexOAuthSection: (props: unknown) => {
    codexOAuthSectionMock(props);
    return <div data-testid="codex-oauth-section" />;
  },
}));

type ClaudeFormFieldsProps = ComponentProps<typeof ClaudeFormFields>;

const FormShell = ({ children }: PropsWithChildren) => {
  const form = useForm();

  return <Form {...form}>{children}</Form>;
};

const renderCopilotForm = (overrides: Partial<ClaudeFormFieldsProps> = {}) => {
  const props: ClaudeFormFieldsProps = {
    shouldShowApiKey: false,
    apiKey: "",
    onApiKeyChange: vi.fn(),
    category: "official",
    shouldShowApiKeyLink: false,
    websiteUrl: "",
    isCopilotPreset: true,
    usesOAuth: true,
    isCopilotAuthenticated: true,
    selectedGitHubAccountId: "gh-1",
    onGitHubAccountSelect: vi.fn(),
    isCodexOauthPreset: false,
    isCodexOauthAuthenticated: false,
    selectedCodexAccountId: null,
    onCodexAccountSelect: vi.fn(),
    codexFastMode: false,
    onCodexFastModeChange: vi.fn(),
    templateValueEntries: [],
    templateValues: {},
    templatePresetName: "",
    onTemplateValueChange: vi.fn(),
    shouldShowSpeedTest: false,
    baseUrl: "",
    onBaseUrlChange: vi.fn(),
    isEndpointModalOpen: false,
    onEndpointModalToggle: vi.fn(),
    onCustomEndpointsChange: vi.fn(),
    autoSelect: false,
    onAutoSelectChange: vi.fn(),
    showEndpointTools: true,
    shouldShowModelSelector: true,
    claudeModel: "",
    defaultHaikuModel: "",
    defaultHaikuModelName: "",
    defaultSonnetModel: "claude-sonnet",
    defaultSonnetModelName: "Claude Sonnet",
    defaultOpusModel: "",
    defaultOpusModelName: "",
    defaultFableModel: "",
    defaultFableModelName: "",
    onModelChange: vi.fn(),
    speedTestEndpoints: [],
    apiFormat: "anthropic",
    onApiFormatChange: vi.fn(),
    apiKeyField: "ANTHROPIC_AUTH_TOKEN",
    onApiKeyFieldChange: vi.fn(),
    isFullUrl: false,
    onFullUrlChange: vi.fn(),
    customUserAgent: "",
    onCustomUserAgentChange: vi.fn(),
    localProxyHeadersOverride: "",
    onLocalProxyHeadersOverrideChange: vi.fn(),
    localProxyBodyOverride: "",
    onLocalProxyBodyOverrideChange: vi.fn(),
    ...overrides,
  };

  return render(
    <FormShell>
      <ClaudeFormFields {...props} />
    </FormShell>,
  );
};

const renderCodexOauthForm = (overrides: Partial<ClaudeFormFieldsProps> = {}) =>
  renderCopilotForm({
    isCopilotPreset: false,
    isCopilotAuthenticated: false,
    selectedGitHubAccountId: null,
    isCodexOauthPreset: true,
    isCodexOauthAuthenticated: true,
    selectedCodexAccountId: "chatgpt-1",
    ...overrides,
  });

describe("ClaudeFormFields", () => {
  beforeEach(() => {
    codexOAuthSectionMock.mockReset();
    copilotAuthSectionMock.mockReset();
    copilotApiMock.copilotGetModelsForTarget.mockReset();
    copilotApiMock.copilotGetModelsForTarget.mockResolvedValue([]);
    modelFetchApiMock.fetchCodexOauthModels.mockResolvedValue([]);
    modelFetchApiMock.fetchModelsForConfig.mockResolvedValue([]);
    modelFetchApiMock.fetchModelsForProviderConfig.mockResolvedValue([]);
    modelFetchApiMock.canUseStoredRemoteProviderApiKey.mockImplementation(
      (target, providerId) => target?.type === "remote" && Boolean(providerId),
    );
    modelFetchApiMock.showFetchModelsError.mockReset();
  });

  it("不会在 Copilot 表单打开时自动获取模型列表", () => {
    renderCopilotForm();

    expect(copilotApiMock.copilotGetModelsForTarget).not.toHaveBeenCalled();
  });

  it("点击获取模型列表后才请求当前 Copilot 账号的模型", async () => {
    renderCopilotForm();

    fireEvent.click(
      screen.getByRole("button", {
        name: "providerForm.fetchModels",
      }),
    );

    await waitFor(() => {
      expect(copilotApiMock.copilotGetModelsForTarget).toHaveBeenCalledWith(
        "gh-1",
        undefined,
      );
    });
  });

  it("远程 Copilot 表单使用远端账号并从远端获取模型列表", async () => {
    const remoteTarget: ClaudeFormFieldsProps["modelFetchTarget"] = {
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

    renderCopilotForm({ modelFetchTarget: remoteTarget });

    expect(copilotAuthSectionMock).toHaveBeenCalledWith(
      expect.objectContaining({ target: remoteTarget }),
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "providerForm.fetchModels",
      }),
    );

    await waitFor(() => {
      expect(copilotApiMock.copilotGetModelsForTarget).toHaveBeenCalledWith(
        "gh-1",
        remoteTarget,
      );
    });
  });

  it("不会在 Codex OAuth 表单打开时自动获取模型列表", () => {
    renderCodexOauthForm();

    expect(modelFetchApiMock.fetchCodexOauthModels).not.toHaveBeenCalled();
  });

  it("点击获取模型列表后才请求当前 Codex OAuth 账号的模型", async () => {
    renderCodexOauthForm();

    fireEvent.click(
      screen.getByRole("button", {
        name: "providerForm.fetchModels",
      }),
    );

    await waitFor(() => {
      expect(modelFetchApiMock.fetchCodexOauthModels).toHaveBeenCalledWith(
        "chatgpt-1",
        undefined,
      );
    });
  });

  it("远程 Codex OAuth 表单使用远端账号并从远端获取模型列表", async () => {
    const remoteTarget: ClaudeFormFieldsProps["modelFetchTarget"] = {
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

    renderCodexOauthForm({ modelFetchTarget: remoteTarget });

    expect(codexOAuthSectionMock).toHaveBeenCalledWith(
      expect.objectContaining({ target: remoteTarget }),
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "providerForm.fetchModels",
      }),
    );

    await waitFor(() => {
      expect(modelFetchApiMock.fetchCodexOauthModels).toHaveBeenCalledWith(
        "chatgpt-1",
        remoteTarget,
      );
    });
  });

  it("远程编辑已保存供应商时 API Key 留空也能用远端已保存密钥获取模型", async () => {
    const remoteTarget: ClaudeFormFieldsProps["modelFetchTarget"] = {
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

    renderCopilotForm({
      providerId: "remote-claude",
      isCopilotPreset: false,
      usesOAuth: false,
      isCopilotAuthenticated: false,
      selectedGitHubAccountId: null,
      shouldShowApiKey: true,
      apiKey: "",
      baseUrl: "https://api.example.com/anthropic",
      modelFetchTarget: remoteTarget,
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "providerForm.fetchModels",
      }),
    );

    await waitFor(() => {
      expect(modelFetchApiMock.fetchModelsForProviderConfig).toHaveBeenCalled();
    });
    expect(modelFetchApiMock.showFetchModelsError).not.toHaveBeenCalledWith(
      null,
      expect.any(Function),
      expect.objectContaining({ hasApiKey: false }),
    );
  });
});
