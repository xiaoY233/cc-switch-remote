import { Suspense, type ComponentType } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { providersApi } from "@/lib/api/providers";
import {
  resetProviderState,
  getLastRemoteSaveSecret,
  getRemoteHermesMemory,
  getRemoteOpenClawDefaultModel,
  setCurrentProviderId,
  setLiveProviderIds,
  setProviders,
  setRemoteHermesMemoryFixtures,
  setRemoteProviderStateError,
  setRemoteProfiles,
  setRemoteSettings,
  setRemoteSessionFixtures,
  setSettings,
} from "../msw/state";
import { emitTauriEvent } from "../msw/tauriMocks";

const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

vi.mock("@/components/providers/ProviderList", () => ({
  ProviderList: ({
    providers,
    currentProviderId,
    target,
    onSwitch,
    onEdit,
    onDuplicate,
    onConfigureUsage,
    onOpenWebsite,
    onCreate,
    onSetAsDefault,
  }: any) => (
    <div>
      <div data-testid="provider-list">{JSON.stringify(providers)}</div>
      <div data-testid="current-provider">{currentProviderId}</div>
      <div data-testid="provider-target">{target?.type ?? "local"}</div>
      <button onClick={() => onSwitch(providers[currentProviderId])}>
        switch
      </button>
      <button onClick={() => onEdit(providers[currentProviderId])}>edit</button>
      <button onClick={() => onDuplicate(providers[currentProviderId])}>
        duplicate
      </button>
      <button onClick={() => onConfigureUsage(providers[currentProviderId])}>
        usage
      </button>
      <button onClick={() => onOpenWebsite("https://example.com")}>
        open-website
      </button>
      <button onClick={() => onCreate?.()}>create</button>
      <button onClick={() => onSetAsDefault?.(providers[currentProviderId])}>
        set-default
      </button>
    </div>
  ),
}));

vi.mock("@/components/providers/AddProviderDialog", () => ({
  AddProviderDialog: ({ open, onOpenChange, onSubmit, appId }: any) =>
    open ? (
      <div data-testid="add-provider-dialog">
        <button
          onClick={() =>
            onSubmit({
              name: `New ${appId} Provider`,
              settingsConfig: {},
              category: "custom",
              sortIndex: 99,
            })
          }
        >
          confirm-add
        </button>
        <button onClick={() => onOpenChange(false)}>close-add</button>
      </div>
    ) : null,
}));

vi.mock("@/components/providers/EditProviderDialog", () => ({
  EditProviderDialog: ({ open, provider, onSubmit, onOpenChange }: any) =>
    open ? (
      <div data-testid="edit-provider-dialog">
        <button
          onClick={() =>
            onSubmit({
              provider: {
                ...provider,
                name: `${provider.name}-edited`,
              },
              originalId: provider.id,
            })
          }
        >
          confirm-edit
        </button>
        <button onClick={() => onOpenChange(false)}>close-edit</button>
      </div>
    ) : null,
}));

vi.mock("@/components/UsageScriptModal", () => ({
  default: ({ isOpen, provider, onSave, onClose }: any) =>
    isOpen ? (
      <div data-testid="usage-modal">
        <span data-testid="usage-provider">{provider?.id}</span>
        <button onClick={() => onSave("script-code")}>save-script</button>
        <button onClick={() => onClose()}>close-usage</button>
      </div>
    ) : null,
}));

vi.mock("@/components/ConfirmDialog", () => ({
  ConfirmDialog: ({ isOpen, onConfirm, onCancel }: any) =>
    isOpen ? (
      <div data-testid="confirm-dialog">
        <button onClick={() => onConfirm()}>confirm-delete</button>
        <button onClick={() => onCancel()}>cancel-delete</button>
      </div>
    ) : null,
}));

vi.mock("@/components/AppSwitcher", () => ({
  AppSwitcher: ({ activeApp, onSwitch, visibleApps }: any) => (
    <div data-testid="app-switcher">
      <span>{activeApp}</span>
      <span data-testid="app-switcher-visible-apps">
        {JSON.stringify(visibleApps)}
      </span>
      <button onClick={() => onSwitch("claude")}>switch-claude</button>
      <button onClick={() => onSwitch("codex")}>switch-codex</button>
      <button onClick={() => onSwitch("openclaw")}>switch-openclaw</button>
    </div>
  ),
}));

vi.mock("@/components/remote/ManagementTargetSwitcher", () => ({
  ManagementTargetSwitcher: ({ profiles, onTargetChange }: any) => (
    <div data-testid="management-target-switcher">
      <button onClick={() => onTargetChange("local")}>target-local</button>
      {profiles.map((profile: any) => (
        <button
          key={profile.id}
          onClick={() => onTargetChange(`remote:${profile.id}`)}
        >
          {profile.name}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("@/components/UpdateBadge", () => ({
  UpdateBadge: ({ onClick }: any) => (
    <button onClick={onClick}>update-badge</button>
  ),
}));

vi.mock("@/components/proxy/ProxyToggle", () => ({
  ProxyToggle: () => <div data-testid="proxy-toggle" />,
}));

vi.mock("@/components/proxy/FailoverToggle", () => ({
  FailoverToggle: () => <div data-testid="failover-toggle" />,
}));

vi.mock("@/components/proxy/RemoteRoutingToggle", () => ({
  RemoteRoutingToggle: () => <div data-testid="remote-routing-toggle" />,
}));

vi.mock("@/components/proxy/RemoteAppRoutingToggle", () => ({
  RemoteAppRoutingToggle: () => <div data-testid="remote-app-routing-toggle" />,
}));

vi.mock("@/components/proxy/ClaudeDesktopRouteToggle", () => ({
  ClaudeDesktopRouteToggle: () => <div data-testid="desktop-route-toggle" />,
}));

vi.mock("@/components/settings/SettingsPage", () => ({
  SettingsPage: ({ defaultTab, onImportSuccess, target }: any) => (
    <div data-testid="settings-page">
      <span data-testid="settings-target">{target?.type ?? "local"}</span>
      <span data-testid="settings-default-tab">{defaultTab}</span>
      <button onClick={() => onImportSuccess?.()}>
        simulate-import-success
      </button>
    </div>
  ),
}));

vi.mock("@/components/settings/RemoteSettingsPage", () => ({
  RemoteSettingsPage: ({
    onImportSuccess,
    onOpenChange,
    onSettingsSaved,
    defaultTab,
    target,
  }: any) => (
    <div data-testid="settings-page">
      <span data-testid="settings-target">{target?.type ?? "local"}</span>
      <span data-testid="settings-default-tab">{defaultTab}</span>
      <button
        onClick={() =>
          onSettingsSaved?.({
            visibleApps: {
              claude: false,
              "claude-desktop": false,
              codex: false,
              gemini: true,
              opencode: false,
              openclaw: false,
              hermes: false,
            },
          })
        }
      >
        simulate-remote-settings-saved
      </button>
      <button onClick={() => onImportSuccess?.()}>
        simulate-import-success
      </button>
      <button onClick={() => onOpenChange?.(false)}>close-settings</button>
    </div>
  ),
}));

vi.mock("@/components/mcp/McpPanel", () => ({
  default: ({ open, onOpenChange }: any) =>
    open ? (
      <div data-testid="mcp-panel">
        <button onClick={() => onOpenChange(false)}>close-mcp</button>
      </div>
    ) : (
      <button onClick={() => onOpenChange(true)}>open-mcp</button>
    ),
}));

vi.mock("@/components/MarkdownEditor", () => ({
  default: ({ value, onChange }: any) => (
    <textarea
      data-testid="markdown-editor"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

const renderApp = (AppComponent: ComponentType) => {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <Suspense fallback={<div data-testid="loading">loading</div>}>
        <AppComponent />
      </Suspense>
    </QueryClientProvider>,
  );
};

describe("App integration with MSW", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    resetProviderState();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
  });

  it("covers basic provider flows via real hooks", async () => {
    const { default: App } = await import("@/App");
    renderApp(App);

    await waitFor(() =>
      expect(screen.getByTestId("provider-list").textContent).toContain(
        "claude-1",
      ),
    );

    fireEvent.click(screen.getByText("switch-codex"));
    await waitFor(() =>
      expect(screen.getByTestId("provider-list").textContent).toContain(
        "codex-1",
      ),
    );

    fireEvent.click(screen.getByText("usage"));
    expect(screen.getByTestId("usage-modal")).toBeInTheDocument();
    fireEvent.click(screen.getByText("save-script"));
    fireEvent.click(screen.getByText("close-usage"));

    fireEvent.click(screen.getByText("create"));
    expect(screen.getByTestId("add-provider-dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByText("confirm-add"));
    await waitFor(() =>
      expect(screen.getByTestId("provider-list").textContent).toMatch(
        /New codex Provider/,
      ),
    );

    fireEvent.click(screen.getByText("edit"));
    expect(screen.getByTestId("edit-provider-dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByText("confirm-edit"));
    await waitFor(() =>
      expect(screen.getByTestId("provider-list").textContent).toMatch(
        /-edited/,
      ),
    );

    fireEvent.click(screen.getByText("switch"));
    fireEvent.click(screen.getByText("duplicate"));
    await waitFor(() =>
      expect(screen.getByTestId("provider-list").textContent).toMatch(/copy/),
    );

    fireEvent.click(screen.getByText("open-website"));

    emitTauriEvent("provider-switched", {
      appType: "codex",
      providerId: "codex-2",
    });

    expect(toastErrorMock).not.toHaveBeenCalled();
    expect(toastSuccessMock).toHaveBeenCalled();
  });

  it("shows toast when auto sync fails in background", async () => {
    const { default: App } = await import("@/App");
    renderApp(App);

    await waitFor(() =>
      expect(screen.getByTestId("provider-list").textContent).toContain(
        "claude-1",
      ),
    );

    expect(() => {
      emitTauriEvent("webdav-sync-status-updated", null);
    }).not.toThrow();
    expect(toastErrorMock).not.toHaveBeenCalled();

    emitTauriEvent("webdav-sync-status-updated", {
      source: "auto",
      status: "error",
      error: "network timeout",
    });

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalled();
    });

    toastErrorMock.mockReset();
    expect(() => {
      emitTauriEvent("s3-sync-status-updated", null);
    }).not.toThrow();
    expect(toastErrorMock).not.toHaveBeenCalled();

    emitTauriEvent("s3-sync-status-updated", {
      source: "auto",
      status: "error",
      error: "s3 timeout",
    });

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalled();
    });
  });

  it("duplicates openclaw providers with a generated key that avoids live-only ids", async () => {
    setProviders("openclaw", {
      deepseek: {
        id: "deepseek",
        name: "DeepSeek",
        settingsConfig: {
          baseUrl: "https://api.deepseek.com",
          apiKey: "test-key",
          api: "openai-completions",
          models: [],
        },
        category: "custom",
        sortIndex: 0,
        createdAt: Date.now(),
      },
    });
    setCurrentProviderId("openclaw", "deepseek");
    setLiveProviderIds("openclaw", ["deepseek-copy"]);

    const { default: App } = await import("@/App");
    renderApp(App);

    fireEvent.click(screen.getByText("switch-openclaw"));

    await waitFor(() =>
      expect(screen.getByTestId("provider-list").textContent).toContain(
        "deepseek",
      ),
    );

    fireEvent.click(screen.getByText("duplicate"));

    await waitFor(() => {
      const providerList = screen.getByTestId("provider-list").textContent;
      expect(providerList).toContain("deepseek-copy-2");
      expect(providerList).toContain("DeepSeek copy");
    });

    expect(toastErrorMock).not.toHaveBeenCalledWith(
      expect.stringContaining("Provider key is required for openclaw"),
    );
  });

  it("shows toast when duplicate cannot load live provider ids", async () => {
    setProviders("openclaw", {
      deepseek: {
        id: "deepseek",
        name: "DeepSeek",
        settingsConfig: {
          baseUrl: "https://api.deepseek.com",
          apiKey: "test-key",
          api: "openai-completions",
          models: [],
        },
        category: "custom",
        sortIndex: 0,
        createdAt: Date.now(),
      },
    });
    setCurrentProviderId("openclaw", "deepseek");

    const liveIdsSpy = vi
      .spyOn(providersApi, "getOpenClawLiveProviderIds")
      .mockRejectedValueOnce(new Error("broken config"));

    const { default: App } = await import("@/App");
    renderApp(App);

    fireEvent.click(screen.getByText("switch-openclaw"));

    await waitFor(() =>
      expect(screen.getByTestId("provider-list").textContent).toContain(
        "deepseek",
      ),
    );

    fireEvent.click(screen.getByText("duplicate"));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        expect.stringContaining("读取配置中的供应商标识失败"),
      );
    });

    expect(screen.getByTestId("provider-list").textContent).not.toContain(
      "deepseek-copy",
    );

    liveIdsSpy.mockRestore();
  });

  it("wires remote OpenClaw default model actions through the provider list", async () => {
    setRemoteProfiles([
      {
        id: "remote-1",
        name: "Remote 1",
        host: "192.168.1.20",
        port: 22,
        username: "root",
        authMethod: { type: "sshAgent" },
        helperPath: "~/.local/bin/cc-switch-remote-helper",
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    setProviders("openclaw", {
      deepseek: {
        id: "deepseek",
        name: "DeepSeek",
        settingsConfig: {
          baseUrl: "https://api.deepseek.com",
          apiKey: "test-key",
          api: "openai-completions",
          models: [{ id: "deepseek-chat" }, { id: "deepseek-reasoner" }],
        },
        category: "custom",
        sortIndex: 0,
        createdAt: Date.now(),
      },
    });
    setCurrentProviderId("openclaw", "deepseek");

    const { default: App } = await import("@/App");
    renderApp(App);

    fireEvent.click(screen.getByText("switch-openclaw"));
    await waitFor(() =>
      expect(screen.getByTestId("provider-list").textContent).toContain(
        "deepseek",
      ),
    );

    fireEvent.click(await screen.findByText("Remote 1"));
    await waitFor(() =>
      expect(screen.getByTestId("provider-list").textContent).toContain(
        "deepseek",
      ),
    );

    fireEvent.click(screen.getByText("set-default"));

    await waitFor(() => {
      expect(getRemoteOpenClawDefaultModel()).toEqual({
        primary: "deepseek/deepseek-chat",
        fallbacks: ["deepseek/deepseek-reasoner"],
      });
    });
  });

  it("uses the stored backend password when activating a password remote target", async () => {
    setRemoteProfiles([
      {
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
    ]);

    const { default: App } = await import("@/App");
    renderApp(App);

    await waitFor(() =>
      expect(screen.getByTestId("provider-target")).toHaveTextContent("local"),
    );

    fireEvent.click(await screen.findByText("Remote 1"));

    await waitFor(() =>
      expect(screen.getByTestId("provider-target")).toHaveTextContent("remote"),
    );
    expect(
      screen.queryByTestId("remote-session-password-dialog"),
    ).not.toBeInTheDocument();
    expect(getLastRemoteSaveSecret()).toBeNull();
  });

  it("prompts and persists a password when the remote backend reports it missing", async () => {
    setRemoteProfiles([
      {
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
    ]);
    setRemoteProviderStateError("Remote SSH password is required");

    const { default: App } = await import("@/App");
    renderApp(App);

    await waitFor(() =>
      expect(screen.getByTestId("provider-target")).toHaveTextContent("local"),
    );

    fireEvent.click(await screen.findByText("Remote 1"));

    expect(
      await screen.findByTestId("remote-session-password-dialog"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("provider-target")).toHaveTextContent("remote");

    fireEvent.change(screen.getByTestId("remote-session-password-input"), {
      target: { value: "secret-password" },
    });
    setRemoteProviderStateError(null);
    fireEvent.click(screen.getByTestId("remote-session-password-confirm"));

    await waitFor(() =>
      expect(screen.getByTestId("provider-target")).toHaveTextContent("remote"),
    );
    expect(getLastRemoteSaveSecret()).toEqual({
      password: "secret-password",
    });
  });

  it("keeps the user on remote server management after saving a profile", async () => {
    localStorage.setItem("cc-switch-last-view", "remoteServers");
    setSettings({ firstRunNoticeConfirmed: true });
    setRemoteProfiles([]);

    const { default: App } = await import("@/App");
    renderApp(App);

    await waitFor(() =>
      expect(
        screen.getByTestId("remote-server-list-panel"),
      ).toBeInTheDocument(),
    );

    fireEvent.click(screen.getAllByRole("button", { name: "新增服务器" })[0]);
    fireEvent.change(screen.getByLabelText("名称"), {
      target: { value: "测试服务器" },
    });
    fireEvent.change(screen.getByPlaceholderText("10.0.0.10"), {
      target: { value: "192.0.2.10" },
    });
    fireEvent.change(screen.getByPlaceholderText("deploy"), {
      target: { value: "root" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("remote-server-list-panel"),
      ).toBeInTheDocument(),
    );
    expect(screen.getAllByText("测试服务器").length).toBeGreaterThan(0);
    expect(localStorage.getItem("cc-switch-last-view")).toBe("remoteServers");
    expect(screen.queryByTestId("provider-target")).not.toBeInTheDocument();
  });

  it("does not refresh the local tray after remote import success", async () => {
    const updateTrayMenuSpy = vi
      .spyOn(providersApi, "updateTrayMenu")
      .mockResolvedValue(true);
    setRemoteProfiles([
      {
        id: "remote-1",
        name: "Remote 1",
        host: "192.168.1.20",
        port: 22,
        username: "root",
        authMethod: { type: "sshAgent" },
        helperPath: "~/.local/bin/cc-switch-remote-helper",
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    const { default: App } = await import("@/App");
    renderApp(App);

    fireEvent.click(await screen.findByText("Remote 1"));
    fireEvent.click(screen.getByTitle("common.settings"));
    await waitFor(() =>
      expect(screen.getByTestId("settings-target")).toHaveTextContent("remote"),
    );
    expect(
      screen.getByTestId("management-target-switcher"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText("simulate-import-success"));

    await waitFor(() =>
      expect(screen.getByTestId("settings-page")).toBeInTheDocument(),
    );
    expect(updateTrayMenuSpy).not.toHaveBeenCalled();
    updateTrayMenuSpy.mockRestore();
  });

  it("refreshes remote providers after remote universal provider sync without touching the local tray", async () => {
    const updateTrayMenuSpy = vi
      .spyOn(providersApi, "updateTrayMenu")
      .mockResolvedValue(true);
    setRemoteProfiles([
      {
        id: "remote-1",
        name: "Remote 1",
        host: "192.168.1.20",
        port: 22,
        username: "root",
        authMethod: { type: "sshAgent" },
        helperPath: "~/.local/bin/cc-switch-remote-helper",
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    const { default: App } = await import("@/App");
    renderApp(App);

    fireEvent.click(await screen.findByText("Remote 1"));
    await waitFor(() =>
      expect(screen.getByTestId("provider-target")).toHaveTextContent("remote"),
    );
    expect(screen.getByTestId("provider-list").textContent).not.toContain(
      "Remote Synced",
    );

    setProviders("claude", {
      "claude-1": {
        id: "claude-1",
        name: "Claude Default",
        settingsConfig: {},
        category: "official",
        sortIndex: 0,
        createdAt: 1,
      },
      "remote-synced": {
        id: "remote-synced",
        name: "Remote Synced",
        settingsConfig: {},
        category: "custom",
        sortIndex: 1,
        createdAt: 2,
      },
    });

    emitTauriEvent("remote-universal-provider-synced", {
      action: "sync",
      id: "universal-1",
    });

    await waitFor(() =>
      expect(screen.getByTestId("provider-list").textContent).toContain(
        "Remote Synced",
      ),
    );
    expect(updateTrayMenuSpy).not.toHaveBeenCalled();
    updateTrayMenuSpy.mockRestore();
  });

  it("opens the local About settings from the update badge while managing a remote target", async () => {
    localStorage.setItem("cc-switch-last-view", "providers");
    setRemoteProfiles([
      {
        id: "remote-1",
        name: "Remote 1",
        host: "192.168.1.20",
        port: 22,
        username: "root",
        authMethod: { type: "sshAgent" },
        helperPath: "~/.local/bin/cc-switch-remote-helper",
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    const { default: App } = await import("@/App");
    renderApp(App);

    fireEvent.click(await screen.findByText("Remote 1"));
    fireEvent.click(screen.getByText("update-badge"));

    await waitFor(() =>
      expect(screen.getByTestId("settings-target")).toHaveTextContent("local"),
    );
    expect(screen.getByTestId("settings-default-tab")).toHaveTextContent(
      "about",
    );
  });

  it("uses per-host remote app visibility while managing a remote target", async () => {
    localStorage.setItem("cc-switch-last-app", "claude");
    localStorage.setItem("cc-switch-last-view", "providers");
    setSettings({
      firstRunNoticeConfirmed: true,
      visibleApps: {
        claude: true,
        "claude-desktop": false,
        codex: false,
        gemini: false,
        opencode: false,
        openclaw: false,
        hermes: false,
      },
    });
    setRemoteSettings({
      visibleApps: {
        claude: false,
        "claude-desktop": false,
        codex: true,
        gemini: false,
        opencode: false,
        openclaw: false,
        hermes: false,
      },
    });
    setRemoteProfiles([
      {
        id: "remote-1",
        name: "Remote 1",
        host: "192.168.1.20",
        port: 22,
        username: "root",
        authMethod: { type: "sshAgent" },
        helperPath: "~/.local/bin/cc-switch-remote-helper",
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    const { default: App } = await import("@/App");
    renderApp(App);

    await waitFor(() =>
      expect(screen.getByTestId("app-switcher-visible-apps")).toHaveTextContent(
        '"claude":true',
      ),
    );

    fireEvent.click(await screen.findByText("Remote 1"));

    await waitFor(() =>
      expect(screen.getByTestId("app-switcher-visible-apps")).toHaveTextContent(
        '"codex":true',
      ),
    );
    expect(screen.getByTestId("app-switcher-visible-apps")).toHaveTextContent(
      '"claude":false',
    );
    await waitFor(() =>
      expect(screen.getByTestId("app-switcher")).toHaveTextContent("codex"),
    );
  });

  it("updates remote app visibility immediately after remote settings save", async () => {
    localStorage.setItem("cc-switch-last-app", "codex");
    localStorage.setItem("cc-switch-last-view", "providers");
    setSettings({ firstRunNoticeConfirmed: true });
    setRemoteSettings({
      visibleApps: {
        claude: false,
        "claude-desktop": false,
        codex: true,
        gemini: false,
        opencode: false,
        openclaw: false,
        hermes: false,
      },
    });
    setRemoteProfiles([
      {
        id: "remote-1",
        name: "Remote 1",
        host: "192.168.1.20",
        port: 22,
        username: "root",
        authMethod: { type: "sshAgent" },
        helperPath: "~/.local/bin/cc-switch-remote-helper",
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    const { default: App } = await import("@/App");
    renderApp(App);

    fireEvent.click(await screen.findByText("Remote 1"));
    await waitFor(() =>
      expect(screen.getByTestId("app-switcher-visible-apps")).toHaveTextContent(
        '"codex":true',
      ),
    );

    fireEvent.click(screen.getByTitle("common.settings"));
    await screen.findByTestId("settings-page");
    fireEvent.click(screen.getByText("simulate-remote-settings-saved"));
    fireEvent.click(screen.getByText("close-settings"));

    await waitFor(() =>
      expect(screen.getByTestId("app-switcher-visible-apps")).toHaveTextContent(
        '"gemini":true',
      ),
    );
    expect(screen.getByTestId("app-switcher-visible-apps")).toHaveTextContent(
      '"codex":false',
    );
    await waitFor(() =>
      expect(screen.getByTestId("app-switcher")).toHaveTextContent("gemini"),
    );
  });

  it("hides homepage routing controls while managing a remote target until remote settings enable them", async () => {
    localStorage.setItem("cc-switch-last-app", "claude");
    localStorage.setItem("cc-switch-last-view", "providers");
    setSettings({
      enableLocalProxy: true,
      enableFailoverToggle: true,
      firstRunNoticeConfirmed: true,
    });
    setRemoteProfiles([
      {
        id: "remote-1",
        name: "Remote 1",
        host: "192.168.1.20",
        port: 22,
        username: "root",
        authMethod: { type: "sshAgent" },
        helperPath: "~/.local/bin/cc-switch-remote-helper",
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    const { default: App } = await import("@/App");
    renderApp(App);

    await waitFor(() =>
      expect(screen.getByTestId("proxy-toggle")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("failover-toggle")).toBeInTheDocument();
    expect(screen.getByTitle("sessionManager.title")).toBeInTheDocument();

    fireEvent.click(await screen.findByText("Remote 1"));

    await waitFor(() =>
      expect(screen.queryByTestId("proxy-toggle")).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByTestId("remote-routing-toggle"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("remote-app-routing-toggle"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("failover-toggle")).not.toBeInTheDocument();
    expect(screen.getByTitle("sessionManager.title")).toBeInTheDocument();
  });

  it("shows only remote app routing and failover homepage controls when enabled per remote host", async () => {
    localStorage.setItem("cc-switch-last-app", "claude");
    localStorage.setItem("cc-switch-last-view", "providers");
    setSettings({
      enableLocalProxy: true,
      enableFailoverToggle: true,
      firstRunNoticeConfirmed: true,
    });
    setRemoteSettings({
      enableRemoteRoutingToggle: true,
      enableRemoteFailoverToggle: true,
    });
    setRemoteProfiles([
      {
        id: "remote-1",
        name: "Remote 1",
        host: "192.168.1.20",
        port: 22,
        username: "root",
        authMethod: { type: "sshAgent" },
        helperPath: "~/.local/bin/cc-switch-remote-helper",
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    const { default: App } = await import("@/App");
    renderApp(App);

    fireEvent.click(await screen.findByText("Remote 1"));

    await waitFor(() =>
      expect(screen.queryByTestId("proxy-toggle")).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByTestId("remote-routing-toggle"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("remote-app-routing-toggle")).toBeInTheDocument();
    expect(screen.getByTestId("failover-toggle")).toBeInTheDocument();
  });

  it("opens remote session management without using local session data", async () => {
    localStorage.setItem("cc-switch-last-app", "codex");
    localStorage.setItem("cc-switch-last-view", "providers");
    setSettings({ firstRunNoticeConfirmed: true });
    setRemoteProfiles([
      {
        id: "remote-1",
        name: "Remote 1",
        host: "192.168.1.20",
        port: 22,
        username: "root",
        authMethod: { type: "sshAgent" },
        helperPath: "~/.local/bin/cc-switch-remote-helper",
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    setRemoteSessionFixtures(
      [
        {
          providerId: "codex",
          sessionId: "remote-codex-session",
          title: "Remote Codex Session",
          summary: "Remote summary",
          projectDir: "/remote/project",
          createdAt: 1000,
          lastActiveAt: 2000,
          sourcePath: "/remote/codex/session.jsonl",
          resumeCommand: "codex resume remote-codex-session",
        },
      ],
      {
        "codex:/remote/codex/session.jsonl": [
          {
            role: "user",
            content: "Remote session message",
            ts: 2000,
          },
        ],
      },
    );

    const { default: App } = await import("@/App");
    renderApp(App);

    await waitFor(() =>
      expect(screen.getByTestId("provider-target")).toHaveTextContent("local"),
    );

    fireEvent.click(await screen.findByText("Remote 1"));

    await waitFor(() =>
      expect(screen.getByTestId("provider-target")).toHaveTextContent("remote"),
    );
    fireEvent.click(screen.getByTitle("sessionManager.title"));

    expect(await screen.findByText("Remote Codex Session")).toBeInTheDocument();
    expect(screen.queryByText("Codex Session One")).not.toBeInTheDocument();
  });

  it("keeps Hermes memory remote-capable while hiding local-only WebUI controls", async () => {
    localStorage.setItem("cc-switch-last-app", "hermes");
    localStorage.setItem("cc-switch-last-view", "providers");
    setSettings({ firstRunNoticeConfirmed: true });
    setRemoteProfiles([
      {
        id: "remote-1",
        name: "Remote 1",
        host: "192.168.1.20",
        port: 22,
        username: "root",
        authMethod: { type: "sshAgent" },
        helperPath: "~/.local/bin/cc-switch-remote-helper",
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    setRemoteHermesMemoryFixtures(
      {
        memory: "Remote Hermes agent memory",
        user: "Remote Hermes user profile",
      },
      {
        memory: 3000,
        user: 1800,
      },
    );

    const { default: App } = await import("@/App");
    renderApp(App);

    await waitFor(() =>
      expect(screen.getByTestId("provider-target")).toHaveTextContent("local"),
    );
    expect(screen.getByTitle("hermes.memory.title")).toBeInTheDocument();
    expect(screen.getByTitle("hermes.webui.open")).toBeInTheDocument();

    fireEvent.click(await screen.findByText("Remote 1"));

    await waitFor(() =>
      expect(screen.getByTestId("provider-target")).toHaveTextContent("remote"),
    );
    expect(screen.getByTitle("hermes.memory.title")).toBeInTheDocument();
    expect(screen.queryByTitle("hermes.webui.open")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTitle("hermes.memory.title"));

    await waitFor(() =>
      expect(screen.getByTestId("markdown-editor")).toHaveValue(
        "Remote Hermes agent memory",
      ),
    );
    expect(
      screen.queryByText("hermes.memory.openConfig"),
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId("markdown-editor"), {
      target: { value: "Updated remote Hermes memory" },
    });
    fireEvent.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() =>
      expect(getRemoteHermesMemory("memory")).toBe(
        "Updated remote Hermes memory",
      ),
    );
  });
});
