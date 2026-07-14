import { beforeEach, describe, expect, it, vi } from "vitest";
import { profilesApi } from "./profiles";
import type { ManagementTarget, RemoteHostProfile } from "./remote";

const invokeMock = vi.hoisted(() => vi.fn());
const remoteListProjectProfilesMock = vi.hoisted(() => vi.fn());
const remoteCreateProjectProfileMock = vi.hoisted(() => vi.fn());
const remoteApplyProjectProfileMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("./remote", async () => {
  const actual = await vi.importActual<typeof import("./remote")>("./remote");
  return {
    ...actual,
    remoteApi: {
      ...actual.remoteApi,
      listProjectProfiles: (...args: unknown[]) =>
        remoteListProjectProfilesMock(...args),
      createProjectProfile: (...args: unknown[]) =>
        remoteCreateProjectProfileMock(...args),
      applyProjectProfile: (...args: unknown[]) =>
        remoteApplyProjectProfileMock(...args),
    },
  };
});

const remoteProfile: RemoteHostProfile = {
  id: "remote-host",
  name: "Remote Host",
  host: "192.0.2.10",
  port: 22,
  username: "root",
  authMethod: { type: "sshAgent" },
  helperPath: "/root/.local/bin/cc-switch-remote-helper",
  createdAt: 1,
  updatedAt: 1,
};

const remoteTarget: ManagementTarget = {
  type: "remote",
  profile: remoteProfile,
  secret: { password: "secret" },
};

describe("profilesApi target routing", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    remoteListProjectProfilesMock.mockReset();
    remoteCreateProjectProfileMock.mockReset();
    remoteApplyProjectProfileMock.mockReset();
  });

  it("uses local Tauri commands by default", async () => {
    invokeMock.mockResolvedValueOnce({ profiles: [], currentIds: {} });

    await profilesApi.list();

    expect(invokeMock).toHaveBeenCalledWith("list_profiles");
    expect(remoteListProjectProfilesMock).not.toHaveBeenCalled();
  });

  it("uses the remote helper for remote profile reads", async () => {
    remoteListProjectProfilesMock.mockResolvedValueOnce({
      profiles: [],
      currentIds: {},
    });

    await profilesApi.list(remoteTarget);

    expect(remoteListProjectProfilesMock).toHaveBeenCalledWith(
      remoteProfile,
      remoteTarget.secret,
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("uses the remote helper for remote profile mutations", async () => {
    remoteCreateProjectProfileMock.mockResolvedValueOnce({
      id: "project-1",
      name: "Project",
      payload: {},
    });
    remoteApplyProjectProfileMock.mockResolvedValueOnce([]);

    await profilesApi.create("Project", "codex", remoteTarget);
    await profilesApi.apply("project-1", "codex", remoteTarget);

    expect(remoteCreateProjectProfileMock).toHaveBeenCalledWith(
      remoteProfile,
      "Project",
      "codex",
      remoteTarget.secret,
    );
    expect(remoteApplyProjectProfileMock).toHaveBeenCalledWith(
      remoteProfile,
      "project-1",
      "codex",
      remoteTarget.secret,
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
