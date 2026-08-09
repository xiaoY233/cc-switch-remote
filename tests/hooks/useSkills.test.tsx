import type { ReactNode } from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useAddSkillRepo,
  useImportSkillsFromApps,
  useInstallSkill,
  useInstalledSkills,
  useRemoveSkillRepo,
  useToggleSkillApp,
  useUninstallSkill,
} from "@/hooks/useSkills";
import type { ManagementTarget } from "@/lib/api/remote";
import type {
  DiscoverableSkill,
  ImportSkillSelection,
  InstalledSkill,
  SkillRepo,
} from "@/lib/api/skills";

const getInstalledMock = vi.hoisted(() => vi.fn());
const installUnifiedMock = vi.hoisted(() => vi.fn());
const uninstallUnifiedMock = vi.hoisted(() => vi.fn());
const toggleAppMock = vi.hoisted(() => vi.fn());
const importFromAppsMock = vi.hoisted(() => vi.fn());
const addRepoMock = vi.hoisted(() => vi.fn());
const removeRepoMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/skills", async () => {
  const actual = await vi.importActual<any>("@/lib/api/skills");
  return {
    ...actual,
    skillsApi: {
      getInstalled: (...args: unknown[]) => getInstalledMock(...args),
      installUnified: (...args: unknown[]) => installUnifiedMock(...args),
      uninstallUnified: (...args: unknown[]) => uninstallUnifiedMock(...args),
      toggleApp: (...args: unknown[]) => toggleAppMock(...args),
      importFromApps: (...args: unknown[]) => importFromAppsMock(...args),
      addRepo: (...args: unknown[]) => addRepoMock(...args),
      removeRepo: (...args: unknown[]) => removeRepoMock(...args),
    },
  };
});

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

const installedSkill: InstalledSkill = {
  id: "skill-1",
  name: "Skill 1",
  directory: "skill-1",
  apps: {
    claude: true,
    codex: false,
    gemini: false,
    opencode: false,
    openclaw: false,
    hermes: false,
  },
  installedAt: 1,
  updatedAt: 1,
};

const discoverableSkill: DiscoverableSkill = {
  key: "skill-1:owner:repo",
  name: "Skill 1",
  description: "Remote skill",
  directory: "skill-1",
  repoOwner: "owner",
  repoName: "repo",
  repoBranch: "main",
};

interface WrapperProps {
  children: ReactNode;
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  const wrapper = ({ children }: WrapperProps) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return { queryClient, wrapper };
}

beforeEach(() => {
  getInstalledMock.mockReset();
  installUnifiedMock.mockReset();
  uninstallUnifiedMock.mockReset();
  toggleAppMock.mockReset();
  importFromAppsMock.mockReset();
  addRepoMock.mockReset();
  removeRepoMock.mockReset();
});

describe("useSkills remote target", () => {
  it("loads installed skills from the selected remote target", async () => {
    getInstalledMock.mockResolvedValueOnce([installedSkill]);
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useInstalledSkills(remoteTarget), {
      wrapper,
    });

    await waitFor(() => expect(result.current.data).toEqual([installedSkill]));
    expect(getInstalledMock).toHaveBeenCalledWith(remoteTarget);
  });

  it("reloads a same-profile target identity and ignores the old Skills response", async () => {
    const nextTarget: ManagementTarget = {
      ...remoteTarget,
      profile: {
        ...remoteTarget.profile,
        host: "192.168.1.21",
        updatedAt: 2,
      },
      secret: { password: "new-secret" },
    };
    const nextSkill = { ...installedSkill, id: "skill-2", name: "Skill 2" };
    let resolveOld!: (value: InstalledSkill[]) => void;
    let resolveNext!: (value: InstalledSkill[]) => void;
    const oldRequest = new Promise<InstalledSkill[]>((resolve) => {
      resolveOld = resolve;
    });
    const nextRequest = new Promise<InstalledSkill[]>((resolve) => {
      resolveNext = resolve;
    });
    getInstalledMock.mockImplementation((target: ManagementTarget) =>
      target === remoteTarget ? oldRequest : nextRequest,
    );
    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(
      ["skills", "discoverable", "remote:remote-1"],
      [discoverableSkill],
    );
    const { result, rerender } = renderHook(
      ({ target }: { target: ManagementTarget }) => useInstalledSkills(target),
      {
        initialProps: { target: remoteTarget },
        wrapper,
      },
    );

    await waitFor(() => expect(getInstalledMock).toHaveBeenCalledTimes(1));
    rerender({ target: nextTarget });
    await waitFor(() => expect(getInstalledMock).toHaveBeenCalledTimes(2));
    expect(
      queryClient.getQueryData(["skills", "discoverable", "remote:remote-1"]),
    ).toBeUndefined();

    resolveNext([nextSkill]);
    await waitFor(() => expect(result.current.data).toEqual([nextSkill]));
    resolveOld([installedSkill]);
    await act(async () => {
      await oldRequest;
    });

    expect(result.current.data).toEqual([nextSkill]);
    expect(getInstalledMock.mock.calls).toEqual([[remoteTarget], [nextTarget]]);
  });

  it("does not expose local Skills as remote data while the remote target loads", async () => {
    const localTarget: ManagementTarget = { type: "local" };
    getInstalledMock.mockImplementation((target: ManagementTarget) =>
      target.type === "local"
        ? Promise.resolve([installedSkill])
        : new Promise(() => {}),
    );
    const { wrapper } = createWrapper();
    const { result, rerender } = renderHook(
      ({ target }: { target: ManagementTarget }) => useInstalledSkills(target),
      {
        initialProps: { target: localTarget } as {
          target: ManagementTarget;
        },
        wrapper,
      },
    );

    await waitFor(() => expect(result.current.data).toEqual([installedSkill]));
    rerender({ target: remoteTarget });

    expect(result.current.data).toBeUndefined();
    expect(getInstalledMock).toHaveBeenLastCalledWith(remoteTarget);
  });

  it("installs and uninstalls skills through the selected remote target without touching local caches", async () => {
    installUnifiedMock.mockResolvedValueOnce(installedSkill);
    uninstallUnifiedMock.mockResolvedValueOnce({ backupPath: "/tmp/backup" });
    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData(["skills", "installed", "local"], []);
    queryClient.setQueryData(["skills", "installed", "remote:remote-1"], []);
    queryClient.setQueryData(
      ["skills", "discoverable", "remote:remote-1"],
      [discoverableSkill],
    );

    const install = renderHook(() => useInstallSkill(remoteTarget), {
      wrapper,
    });
    const uninstall = renderHook(() => useUninstallSkill(remoteTarget), {
      wrapper,
    });

    await act(async () => {
      await install.result.current.mutateAsync({
        skill: discoverableSkill,
        currentApp: "claude",
      });
      await uninstall.result.current.mutateAsync({
        id: installedSkill.id,
        skillKey: discoverableSkill.key,
      });
    });

    expect(installUnifiedMock).toHaveBeenCalledWith(
      discoverableSkill,
      "claude",
      remoteTarget,
    );
    expect(uninstallUnifiedMock).toHaveBeenCalledWith(
      installedSkill.id,
      remoteTarget,
    );
    expect(queryClient.getQueryData(["skills", "installed", "local"])).toEqual(
      [],
    );
    expect(
      queryClient.getQueryData(["skills", "installed", "remote:remote-1"]),
    ).toEqual([]);
    expect(
      queryClient.getQueryData(["skills", "discoverable", "remote:remote-1"]),
    ).toEqual([{ ...discoverableSkill, installed: false }]);
  });

  it("routes toggle, import, and repo mutations through the remote target", async () => {
    toggleAppMock.mockResolvedValueOnce(true);
    importFromAppsMock.mockResolvedValueOnce([installedSkill]);
    addRepoMock.mockResolvedValueOnce(true);
    removeRepoMock.mockResolvedValueOnce(true);
    const { wrapper } = createWrapper();
    const imports: ImportSkillSelection[] = [
      {
        directory: "skill-1",
        apps: installedSkill.apps,
      },
    ];
    const repo: SkillRepo = {
      owner: "owner",
      name: "repo",
      branch: "main",
      enabled: true,
    };

    const toggle = renderHook(() => useToggleSkillApp(remoteTarget), {
      wrapper,
    });
    const importSkills = renderHook(
      () => useImportSkillsFromApps(remoteTarget),
      {
        wrapper,
      },
    );
    const addRepo = renderHook(() => useAddSkillRepo(remoteTarget), {
      wrapper,
    });
    const removeRepo = renderHook(() => useRemoveSkillRepo(remoteTarget), {
      wrapper,
    });

    await act(async () => {
      await toggle.result.current.mutateAsync({
        id: "skill-1",
        app: "codex",
        enabled: true,
      });
      await importSkills.result.current.mutateAsync(imports);
      await addRepo.result.current.mutateAsync(repo);
      await removeRepo.result.current.mutateAsync({
        owner: "owner",
        name: "repo",
      });
    });

    expect(toggleAppMock).toHaveBeenCalledWith(
      "skill-1",
      "codex",
      true,
      remoteTarget,
    );
    expect(importFromAppsMock).toHaveBeenCalledWith(imports, remoteTarget);
    expect(addRepoMock).toHaveBeenCalledWith(repo, remoteTarget);
    expect(removeRepoMock).toHaveBeenCalledWith("owner", "repo", remoteTarget);
  });
});
