import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GlobalProxySettings } from "@/components/settings/GlobalProxySettings";
import type { ManagementTarget, RemoteHostProfile } from "@/lib/api";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const mutateAsyncMock = vi.fn();
const testMutateAsyncMock = vi.fn();
const scanMutateAsyncMock = vi.fn();

const useGlobalProxyUrlMock = vi.fn();
const useSetGlobalProxyUrlMock = vi.fn();

vi.mock("@/hooks/useGlobalProxy", () => ({
  useGlobalProxyUrl: (...args: unknown[]) => useGlobalProxyUrlMock(...args),
  useSetGlobalProxyUrl: (...args: unknown[]) => useSetGlobalProxyUrlMock(...args),
  useTestProxy: () => ({
    mutateAsync: testMutateAsyncMock,
    isPending: false,
  }),
  useScanProxies: () => ({
    mutateAsync: scanMutateAsyncMock,
    isPending: false,
  }),
}));

const profile: RemoteHostProfile = {
  id: "remote-1",
  name: "Swarm01",
  host: "192.168.123.203",
  port: 22,
  username: "root",
  authMethod: { type: "password" },
  helperPath: "~/.local/bin/cc-switch-remote-helper",
  createdAt: 1,
  updatedAt: 1,
};

const remoteTarget: ManagementTarget = {
  type: "remote",
  profile,
  secret: { password: "secret" },
};

function mockGlobalProxyHooks() {
  useGlobalProxyUrlMock.mockReturnValue({
    data: "http://127.0.0.1:7890",
    isLoading: false,
  });
  useSetGlobalProxyUrlMock.mockReturnValue({
    mutateAsync: mutateAsyncMock,
    isPending: false,
  });
}

describe("GlobalProxySettings", () => {
  beforeEach(() => {
    mutateAsyncMock.mockReset();
    testMutateAsyncMock.mockReset();
    scanMutateAsyncMock.mockReset();
    useGlobalProxyUrlMock.mockReset();
    useSetGlobalProxyUrlMock.mockReset();
    mockGlobalProxyHooks();
  });

  it("renders proxy URL input with saved value", async () => {
    render(<GlobalProxySettings />);

    const urlInput = screen.getByPlaceholderText(
      "http://127.0.0.1:7890 / socks5://127.0.0.1:1080",
    );
    // URL 对象会在末尾添加斜杠
    await waitFor(() =>
      expect(urlInput).toHaveValue("http://127.0.0.1:7890/"),
    );
  });

  it("saves proxy URL when save button is clicked", async () => {
    render(<GlobalProxySettings />);

    const urlInput = screen.getByPlaceholderText(
      "http://127.0.0.1:7890 / socks5://127.0.0.1:1080",
    );

    fireEvent.change(urlInput, { target: { value: "http://localhost:8080" } });

    const saveButton = screen.getByRole("button", { name: "common.save" });
    fireEvent.click(saveButton);

    await waitFor(() => expect(mutateAsyncMock).toHaveBeenCalled());
    // 没有用户名时，URL 不经过 URL 对象解析，所以没有尾部斜杠
    expect(mutateAsyncMock).toHaveBeenCalledWith("http://localhost:8080");
  });

  it("clears proxy URL when clear button is clicked", async () => {
    render(<GlobalProxySettings />);

    const urlInput = screen.getByPlaceholderText(
      "http://127.0.0.1:7890 / socks5://127.0.0.1:1080",
    );

    // Wait for initial value to load
    await waitFor(() =>
      expect(urlInput).toHaveValue("http://127.0.0.1:7890/"),
    );

    // Click clear button
    const clearButton = screen.getByTitle("settings.globalProxy.clear");
    fireEvent.click(clearButton);

    expect(urlInput).toHaveValue("");
  });

  it("uses the remote target and hides local scan/test actions for remote management", async () => {
    render(<GlobalProxySettings target={remoteTarget} />);

    expect(useGlobalProxyUrlMock).toHaveBeenCalledWith(remoteTarget);
    expect(useSetGlobalProxyUrlMock).toHaveBeenCalledWith(remoteTarget);
    expect(screen.queryByTitle("settings.globalProxy.scan")).toBeNull();
    expect(screen.queryByTitle("settings.globalProxy.test")).toBeNull();
    expect(
      screen.getByText("remote.settings.routing.globalProxyHint"),
    ).toBeInTheDocument();
  });
});
