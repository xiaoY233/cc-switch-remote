import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AuthCenterPanel } from "@/components/settings/AuthCenterPanel";

vi.mock("@/components/providers/forms/CopilotAuthSection", () => ({
  CopilotAuthSection: ({ onBusyChange }: any) => (
    <button onClick={() => onBusyChange?.(true)}>copilot-busy</button>
  ),
}));
vi.mock("@/components/providers/forms/CodexOAuthSection", () => ({
  CodexOAuthSection: ({ onBusyChange }: any) => (
    <button onClick={() => onBusyChange?.(true)}>codex-busy</button>
  ),
}));
vi.mock("@/components/providers/forms/XaiOAuthSection", () => ({
  XaiOAuthSection: ({ onBusyChange }: any) => (
    <button onClick={() => onBusyChange?.(true)}>xai-busy</button>
  ),
}));

describe("AuthCenterPanel interaction lock", () => {
  it.each(["copilot", "codex", "xai"])(
    "reports %s section busy state to its owner",
    async (section) => {
      const user = userEvent.setup();
      const onBusyChange = vi.fn();
      render(<AuthCenterPanel onBusyChange={onBusyChange} />);

      await user.click(screen.getByRole("button", { name: `${section}-busy` }));

      await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(true));
    },
  );
});
