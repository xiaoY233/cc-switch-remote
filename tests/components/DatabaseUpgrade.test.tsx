import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DatabaseUpgrade } from "@/components/DatabaseUpgrade";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  exit: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: mocks.listen,
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  exit: mocks.exit,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | { defaultValue?: string }) =>
      typeof fallback === "string" ? fallback : (fallback?.defaultValue ?? key),
  }),
}));

describe("DatabaseUpgrade recovery actions", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.listen.mockReset();
    mocks.exit.mockReset();
    mocks.listen.mockResolvedValue(vi.fn());
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "check_app_update_available") return null;
      return true;
    });
  });

  it("keeps recovery actions state-free and points release fallback at the fork", async () => {
    render(
      <DatabaseUpgrade
        payload={{
          kind: "database_too_new",
          path: "/tmp/cc-switch.db",
          db_version: 18,
          supported_version: 17,
        }}
      />,
    );

    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("check_app_update_available"),
    );

    fireEvent.click(screen.getByRole("button", { name: "打开配置目录" }));
    expect(mocks.invoke).toHaveBeenCalledWith("open_app_config_folder");

    fireEvent.click(screen.getByRole("button", { name: "退出" }));
    expect(mocks.exit).toHaveBeenCalledWith(0);

    const releases = await screen.findByRole("button", { name: "打开发布页" });
    fireEvent.click(releases);
    expect(mocks.invoke).toHaveBeenCalledWith("open_external", {
      url: "https://github.com/xiaoY233/cc-switch-remote/releases",
    });
  });
});
