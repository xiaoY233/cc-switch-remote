import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { UniversalProvider } from "@/types";
import type { ManagementTarget } from "@/lib/api";
import { UniversalProviderFormModal } from "@/components/universal/UniversalProviderFormModal";

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

vi.mock("@/components/JsonEditor", () => ({
  default: ({ value }: { value: unknown }) => (
    <pre data-testid="json-editor">{JSON.stringify(value)}</pre>
  ),
}));

vi.mock("@/components/ConfirmDialog", () => ({
  ConfirmDialog: () => null,
}));

const remoteTarget: ManagementTarget = {
  type: "remote",
  profile: {
    id: "remote-1",
    name: "Remote",
    host: "192.168.123.206",
    port: 22,
    username: "root",
    authMethod: { type: "password" },
    helperPath: "~/.local/bin/cc-switch-remote-helper",
    createdAt: 1,
    updatedAt: 1,
  },
};

const editingProvider: UniversalProvider = {
  id: "u1",
  name: "NewAPI",
  providerType: "newapi",
  apps: {
    claude: true,
    codex: true,
    gemini: true,
  },
  baseUrl: "https://api.example.com",
  apiKey: "sk-existing",
  models: {},
};

describe("UniversalProviderFormModal", () => {
  it("allows remote edits to leave API Key blank and preserves the existing key", async () => {
    const handleSave = vi.fn();

    render(
      <UniversalProviderFormModal
        isOpen
        onClose={vi.fn()}
        onSave={handleSave}
        editingProvider={editingProvider}
        target={remoteTarget}
      />,
    );

    fireEvent.change(screen.getByLabelText("API Key"), {
      target: { value: "" },
    });

    fireEvent.click(screen.getByRole("button", { name: "添加" }));

    await waitFor(() => expect(handleSave).toHaveBeenCalledTimes(1));
    expect(handleSave.mock.calls[0][0].apiKey).toBe("sk-existing");
  });
});
