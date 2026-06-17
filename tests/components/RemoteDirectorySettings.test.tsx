import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RemoteDirectorySettings } from "@/components/settings/RemoteDirectorySettings";
import type { Settings } from "@/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
  },
}));

function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    claudeConfigDir: "/srv/claude",
    codexConfigDir: "/srv/codex",
    geminiConfigDir: undefined,
    opencodeConfigDir: undefined,
    openclawConfigDir: undefined,
    hermesConfigDir: undefined,
    ...overrides,
  } as Settings;
}

describe("RemoteDirectorySettings", () => {
  it("edits remote app config directory overrides without local browse buttons", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    render(<RemoteDirectorySettings settings={settings()} onSave={onSave} />);

    expect(screen.queryByTitle("settings.browseDirectory")).toBeNull();
    expect(screen.getByDisplayValue("/srv/claude")).toBeInTheDocument();

    const codexInput = screen.getByDisplayValue("/srv/codex");
    fireEvent.change(codexInput, { target: { value: " /remote/codex " } });

    const saveButtons = screen.getAllByTitle("common.save");
    fireEvent.click(saveButtons[1]);

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        codexConfigDir: "/remote/codex",
      }),
    );
  });
});
