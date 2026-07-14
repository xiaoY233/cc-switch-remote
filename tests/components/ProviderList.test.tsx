import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";
import type { Provider } from "@/types";
import { ProviderList } from "@/components/providers/ProviderList";
import type { ManagementTarget } from "@/lib/api";

const useDragSortMock = vi.fn();
const useSortableMock = vi.fn();
const providerCardRenderSpy = vi.fn();
const useAutoFailoverEnabledMock = vi.fn();
const useFailoverQueueMock = vi.fn();
const useAddToFailoverQueueMock = vi.fn();
const useRemoveFromFailoverQueueMock = vi.fn();
const getOpenCodeLiveProviderIdsMock = vi.fn();
const useCurrentOmoProviderIdMock = vi.fn();
const useCurrentOmoSlimProviderIdMock = vi.fn();
const useOpenClawLiveProviderIdsMock = vi.fn();
const useOpenClawDefaultModelMock = vi.fn();
const importCurrentProviderMock = vi.fn();
const checkProviderMock = vi.fn();

vi.mock("@/hooks/useDragSort", () => ({
  useDragSort: (...args: unknown[]) => useDragSortMock(...args),
}));

vi.mock("@/components/providers/ProviderCard", () => ({
  ProviderCard: (props: any) => {
    providerCardRenderSpy(props);
    const {
      provider,
      onSwitch,
      onEdit,
      onDelete,
      onDuplicate,
      onConfigureUsage,
    } = props;

    return (
      <div data-testid={`provider-card-${provider.id}`}>
        <button
          data-testid={`switch-${provider.id}`}
          onClick={() => onSwitch(provider)}
        >
          switch
        </button>
        <button
          data-testid={`edit-${provider.id}`}
          onClick={() => onEdit(provider)}
        >
          edit
        </button>
        <button
          data-testid={`duplicate-${provider.id}`}
          onClick={() => onDuplicate(provider)}
        >
          duplicate
        </button>
        <button
          data-testid={`usage-${provider.id}`}
          onClick={() => onConfigureUsage(provider)}
        >
          usage
        </button>
        <button
          data-testid={`delete-${provider.id}`}
          onClick={() => onDelete(provider)}
        >
          delete
        </button>
        <button
          data-testid={`test-${provider.id}`}
          onClick={() => props.onTest?.(provider)}
        >
          test
        </button>
        <button
          data-testid={`toggle-failover-${provider.id}`}
          onClick={() => props.onToggleFailover?.(!props.isInFailoverQueue)}
        >
          toggle failover
        </button>
        <button
          data-testid={`remove-from-config-${provider.id}`}
          onClick={() => props.onRemoveFromConfig?.(provider)}
        >
          remove from config
        </button>
        <span data-testid={`is-current-${provider.id}`}>
          {props.isCurrent ? "current" : "inactive"}
        </span>
        <span data-testid={`drag-attr-${provider.id}`}>
          {props.dragHandleProps?.attributes?.["data-dnd-id"] ?? "none"}
        </span>
      </div>
    );
  },
}));

vi.mock("@/components/UsageFooter", () => ({
  default: () => <div data-testid="usage-footer" />,
}));

vi.mock("@dnd-kit/sortable", async () => {
  const actual = await vi.importActual<any>("@dnd-kit/sortable");

  return {
    ...actual,
    useSortable: (...args: unknown[]) => useSortableMock(...args),
  };
});

// Mock hooks that use QueryClient
vi.mock("@/hooks/useStreamCheck", () => ({
  useStreamCheck: (...args: unknown[]) => ({
    checkProvider: (...checkArgs: unknown[]) => checkProviderMock(...checkArgs),
    isChecking: () => false,
    args,
  }),
}));

vi.mock("@/lib/query/failover", () => ({
  useAutoFailoverEnabled: (...args: unknown[]) =>
    useAutoFailoverEnabledMock(...args),
  useFailoverQueue: (...args: unknown[]) => useFailoverQueueMock(...args),
  useAddToFailoverQueue: (...args: unknown[]) => useAddToFailoverQueueMock(...args),
  useRemoveFromFailoverQueue: (...args: unknown[]) =>
    useRemoveFromFailoverQueueMock(...args),
  useReorderFailoverQueue: () => ({ mutate: vi.fn() }),
}));

vi.mock("@/lib/query/omo", () => ({
  useCurrentOmoProviderId: (...args: unknown[]) =>
    useCurrentOmoProviderIdMock(...args),
  useCurrentOmoSlimProviderId: (...args: unknown[]) =>
    useCurrentOmoSlimProviderIdMock(...args),
}));

vi.mock("@/hooks/useOpenClaw", () => ({
  useOpenClawLiveProviderIds: (...args: unknown[]) =>
    useOpenClawLiveProviderIdsMock(...args),
  useOpenClawDefaultModel: (...args: unknown[]) =>
    useOpenClawDefaultModelMock(...args),
}));

vi.mock("@/lib/api/providers", () => ({
  providersApi: {
    importCurrent: (...args: unknown[]) => importCurrentProviderMock(...args),
    getOpenCodeLiveProviderIds: (...args: unknown[]) =>
      getOpenCodeLiveProviderIdsMock(...args),
  },
}));

function createProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: overrides.id ?? "provider-1",
    name: overrides.name ?? "Test Provider",
    settingsConfig: overrides.settingsConfig ?? {},
    category: overrides.category,
    createdAt: overrides.createdAt,
    sortIndex: overrides.sortIndex,
    meta: overrides.meta,
    websiteUrl: overrides.websiteUrl,
  };
}

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

function renderWithQueryClient(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

beforeEach(() => {
  useDragSortMock.mockReset();
  useSortableMock.mockReset();
  providerCardRenderSpy.mockClear();
  useAutoFailoverEnabledMock.mockReset();
  useFailoverQueueMock.mockReset();
  useAddToFailoverQueueMock.mockReset();
  useRemoveFromFailoverQueueMock.mockReset();
  getOpenCodeLiveProviderIdsMock.mockReset();
  useCurrentOmoProviderIdMock.mockReset();
  useCurrentOmoSlimProviderIdMock.mockReset();
  useOpenClawLiveProviderIdsMock.mockReset();
  useOpenClawDefaultModelMock.mockReset();
  importCurrentProviderMock.mockReset();
  checkProviderMock.mockReset();

  useAutoFailoverEnabledMock.mockReturnValue({ data: false });
  useFailoverQueueMock.mockReturnValue({ data: [] });
  useAddToFailoverQueueMock.mockReturnValue({ mutate: vi.fn() });
  useRemoveFromFailoverQueueMock.mockReturnValue({ mutate: vi.fn() });
  getOpenCodeLiveProviderIdsMock.mockResolvedValue([]);
  useCurrentOmoProviderIdMock.mockReturnValue({ data: undefined });
  useCurrentOmoSlimProviderIdMock.mockReturnValue({ data: undefined });
  useOpenClawLiveProviderIdsMock.mockReturnValue({ data: undefined });
  useOpenClawDefaultModelMock.mockReturnValue({ data: undefined });

  useSortableMock.mockImplementation(({ id }: { id: string }) => ({
    setNodeRef: vi.fn(),
    attributes: { "data-dnd-id": id },
    listeners: { onPointerDown: vi.fn() },
    transform: null,
    transition: null,
    isDragging: false,
  }));

  useDragSortMock.mockReturnValue({
    sortedProviders: [],
    sensors: [],
    handleDragEnd: vi.fn(),
  });
});

describe("ProviderList Component", () => {
  it("should render skeleton placeholders when loading", () => {
    const { container } = renderWithQueryClient(
      <ProviderList
        providers={{}}
        currentProviderId=""
        appId="claude"
        onSwitch={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onDuplicate={vi.fn()}
        onOpenWebsite={vi.fn()}
        isLoading
      />,
    );

    const placeholders = container.querySelectorAll(
      ".border-dashed.border-muted-foreground\\/40",
    );
    expect(placeholders).toHaveLength(3);
  });

  it("should show empty state and trigger create callback when no providers exist", () => {
    const handleCreate = vi.fn();
    useDragSortMock.mockReturnValueOnce({
      sortedProviders: [],
      sensors: [],
      handleDragEnd: vi.fn(),
    });

    renderWithQueryClient(
      <ProviderList
        providers={{}}
        currentProviderId=""
        appId="claude"
        onSwitch={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onDuplicate={vi.fn()}
        onOpenWebsite={vi.fn()}
        onCreate={handleCreate}
      />,
    );

    const addButton = screen.getByRole("button", {
      name: "provider.addProvider",
    });
    fireEvent.click(addButton);

    expect(handleCreate).toHaveBeenCalledTimes(1);
  });

  it("should render in order returned by useDragSort and pass through action callbacks", () => {
    const providerA = createProvider({ id: "a", name: "A" });
    const providerB = createProvider({ id: "b", name: "B" });

    const handleSwitch = vi.fn();
    const handleEdit = vi.fn();
    const handleDelete = vi.fn();
    const handleDuplicate = vi.fn();
    const handleUsage = vi.fn();
    const handleOpenWebsite = vi.fn();

    useDragSortMock.mockReturnValue({
      sortedProviders: [providerB, providerA],
      sensors: [],
      handleDragEnd: vi.fn(),
    });

    renderWithQueryClient(
      <ProviderList
        providers={{ a: providerA, b: providerB }}
        currentProviderId="b"
        appId="claude"
        onSwitch={handleSwitch}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onDuplicate={handleDuplicate}
        onConfigureUsage={handleUsage}
        onOpenWebsite={handleOpenWebsite}
      />,
    );

    // Verify sort order
    expect(providerCardRenderSpy).toHaveBeenCalledTimes(2);
    expect(providerCardRenderSpy.mock.calls[0][0].provider.id).toBe("b");
    expect(providerCardRenderSpy.mock.calls[1][0].provider.id).toBe("a");

    // Verify current provider marker
    expect(providerCardRenderSpy.mock.calls[0][0].isCurrent).toBe(true);

    // Drag attributes from useSortable
    expect(
      providerCardRenderSpy.mock.calls[0][0].dragHandleProps?.attributes[
      "data-dnd-id"
      ],
    ).toBe("b");
    expect(
      providerCardRenderSpy.mock.calls[1][0].dragHandleProps?.attributes[
      "data-dnd-id"
      ],
    ).toBe("a");

    // Trigger action buttons
    fireEvent.click(screen.getByTestId("switch-b"));
    fireEvent.click(screen.getByTestId("edit-b"));
    fireEvent.click(screen.getByTestId("duplicate-b"));
    fireEvent.click(screen.getByTestId("usage-b"));
    fireEvent.click(screen.getByTestId("delete-a"));

    expect(handleSwitch).toHaveBeenCalledWith(providerB);
    expect(handleEdit).toHaveBeenCalledWith(providerB);
    expect(handleDuplicate).toHaveBeenCalledWith(providerB);
    expect(handleUsage).toHaveBeenCalledWith(providerB);
    expect(handleDelete).toHaveBeenCalledWith(providerA);

    // Verify useDragSort call parameters
    expect(useDragSortMock).toHaveBeenCalledWith(
      { a: providerA, b: providerB },
      "claude",
      { type: "local" },
    );
  });

  it("should import current config against the remote target from the empty state", async () => {
    useDragSortMock.mockReturnValueOnce({
      sortedProviders: [],
      sensors: [],
      handleDragEnd: vi.fn(),
    });
    importCurrentProviderMock.mockResolvedValueOnce(true);

    renderWithQueryClient(
      <ProviderList
        providers={{}}
        currentProviderId=""
        appId="claude"
        target={remoteTarget}
        onSwitch={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onDuplicate={vi.fn()}
        onOpenWebsite={vi.fn()}
        onCreate={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("provider.importCurrent"));

    await waitFor(() => {
      expect(importCurrentProviderMock).toHaveBeenCalledWith(
        "claude",
        remoteTarget,
      );
    });
    expect(useDragSortMock).toHaveBeenCalledWith(
      {},
      "claude",
      remoteTarget,
    );
    expect(useAutoFailoverEnabledMock).toHaveBeenCalledWith(
      "claude",
      remoteTarget,
    );
    expect(useFailoverQueueMock).toHaveBeenCalledWith("claude", remoteTarget);
    expect(useCurrentOmoProviderIdMock).toHaveBeenCalledWith(
      false,
      remoteTarget,
    );
    expect(useCurrentOmoSlimProviderIdMock).toHaveBeenCalledWith(
      false,
      remoteTarget,
    );
  });

  it("wires remote provider cards to remote failover queue state and mutations", () => {
    const provider = createProvider({ id: "remote-provider", name: "Remote" });
    const addMutate = vi.fn();
    const removeMutate = vi.fn();
    useDragSortMock.mockReturnValue({
      sortedProviders: [provider],
      sensors: [],
      handleDragEnd: vi.fn(),
    });
    useAutoFailoverEnabledMock.mockReturnValue({ data: true });
    useFailoverQueueMock.mockReturnValue({
      data: [
        {
          providerId: "remote-provider",
          providerName: "Remote",
          sortIndex: 1,
        },
      ],
    });
    useAddToFailoverQueueMock.mockReturnValue({ mutate: addMutate });
    useRemoveFromFailoverQueueMock.mockReturnValue({ mutate: removeMutate });

    renderWithQueryClient(
      <ProviderList
        providers={{ "remote-provider": provider }}
        currentProviderId="remote-provider"
        appId="codex"
        target={remoteTarget}
        isProxyRunning
        isProxyTakeover
        onSwitch={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onDuplicate={vi.fn()}
        onOpenWebsite={vi.fn()}
      />,
    );

    expect(useAutoFailoverEnabledMock).toHaveBeenCalledWith(
      "codex",
      remoteTarget,
    );
    expect(useFailoverQueueMock).toHaveBeenCalledWith("codex", remoteTarget);
    expect(useAddToFailoverQueueMock).toHaveBeenCalledWith(remoteTarget);
    expect(useRemoveFromFailoverQueueMock).toHaveBeenCalledWith(remoteTarget);
    expect(providerCardRenderSpy.mock.calls[0][0]).toMatchObject({
      isAutoFailoverEnabled: true,
      isInFailoverQueue: true,
      failoverPriority: 1,
      target: remoteTarget,
    });

    fireEvent.click(screen.getByTestId("toggle-failover-remote-provider"));
    expect(removeMutate).toHaveBeenCalledWith({
      appType: "codex",
      providerId: "remote-provider",
    });
  });

  it("keeps provider testing available on remote targets", () => {
    const provider = createProvider({ id: "remote-provider", name: "Remote" });
    useDragSortMock.mockReturnValue({
      sortedProviders: [provider],
      sensors: [],
      handleDragEnd: vi.fn(),
    });

    renderWithQueryClient(
      <ProviderList
        providers={{ "remote-provider": provider }}
        currentProviderId="remote-provider"
        appId="claude"
        target={remoteTarget}
        onSwitch={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onDuplicate={vi.fn()}
        onOpenWebsite={vi.fn()}
      />,
    );

    expect(providerCardRenderSpy.mock.calls[0][0].onTest).toEqual(
      expect.any(Function),
    );
    fireEvent.click(screen.getByTestId("test-remote-provider"));
    expect(checkProviderMock).toHaveBeenCalledWith(
      "remote-provider",
      "Remote",
    );
  });

  it("passes the remote remove-from-config action to additive provider cards", () => {
    const provider = createProvider({ id: "remote-openclaw", name: "Remote" });
    const handleDelete = vi.fn();
    const handleSwitch = vi.fn();
    const handleRemoveFromConfig = vi.fn();
    useDragSortMock.mockReturnValue({
      sortedProviders: [provider],
      sensors: [],
      handleDragEnd: vi.fn(),
    });

    renderWithQueryClient(
      <ProviderList
        providers={{ "remote-openclaw": provider }}
        currentProviderId=""
        appId="openclaw"
        target={remoteTarget}
        onSwitch={handleSwitch}
        onEdit={vi.fn()}
        onDelete={handleDelete}
        onRemoveFromConfig={handleRemoveFromConfig}
        onDuplicate={vi.fn()}
        onOpenWebsite={vi.fn()}
      />,
    );

    expect(providerCardRenderSpy.mock.calls[0][0].onRemoveFromConfig).toEqual(
      expect.any(Function),
    );
    fireEvent.click(screen.getByTestId("remove-from-config-remote-openclaw"));
    expect(handleDelete).not.toHaveBeenCalled();
    expect(handleRemoveFromConfig).toHaveBeenCalledWith(provider);
  });

  it("should read remote OpenClaw default model and mark the default provider", () => {
    const providerA = createProvider({ id: "a", name: "A" });
    const providerB = createProvider({ id: "b", name: "B" });
    useDragSortMock.mockReturnValue({
      sortedProviders: [providerA, providerB],
      sensors: [],
      handleDragEnd: vi.fn(),
    });
    useOpenClawDefaultModelMock.mockReturnValue({
      data: { primary: "b/gpt-4.1" },
    });

    renderWithQueryClient(
      <ProviderList
        providers={{ a: providerA, b: providerB }}
        currentProviderId=""
        appId="openclaw"
        target={remoteTarget}
        onSwitch={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onDuplicate={vi.fn()}
        onOpenWebsite={vi.fn()}
      />,
    );

    expect(useOpenClawDefaultModelMock).toHaveBeenCalledWith(
      true,
      remoteTarget,
    );
    expect(providerCardRenderSpy.mock.calls[0][0].isDefaultModel).toBe(false);
    expect(providerCardRenderSpy.mock.calls[1][0].isDefaultModel).toBe(true);
  });

  it("filters providers with the search input", () => {
    const providerAlpha = createProvider({ id: "alpha", name: "Alpha Labs" });
    const providerBeta = createProvider({ id: "beta", name: "Beta Works" });

    useDragSortMock.mockReturnValue({
      sortedProviders: [providerAlpha, providerBeta],
      sensors: [],
      handleDragEnd: vi.fn(),
    });

    renderWithQueryClient(
      <ProviderList
        providers={{ alpha: providerAlpha, beta: providerBeta }}
        currentProviderId=""
        appId="claude"
        onSwitch={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onDuplicate={vi.fn()}
        onOpenWebsite={vi.fn()}
      />,
    );

    fireEvent.keyDown(window, { key: "f", metaKey: true });
    const searchInput = screen.getByPlaceholderText(
      "Search name, notes, or URL...",
    );
    // Initially both providers are rendered
    expect(screen.getByTestId("provider-card-alpha")).toBeInTheDocument();
    expect(screen.getByTestId("provider-card-beta")).toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: "beta" } });
    expect(screen.queryByTestId("provider-card-alpha")).not.toBeInTheDocument();
    expect(screen.getByTestId("provider-card-beta")).toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: "gamma" } });
    expect(screen.queryByTestId("provider-card-alpha")).not.toBeInTheDocument();
    expect(screen.queryByTestId("provider-card-beta")).not.toBeInTheDocument();
    expect(
      screen.getByText("No providers match your search."),
    ).toBeInTheDocument();
  });
});
