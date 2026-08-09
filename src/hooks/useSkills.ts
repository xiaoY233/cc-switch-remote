import {
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import {
  skillsApi,
  type SkillBackupEntry,
  type DiscoverableSkill,
  type ImportSkillSelection,
  type InstalledSkill,
  type SkillRepo,
  type SkillUpdateInfo,
  type SkillsShSearchResult,
} from "@/lib/api/skills";
import type { AppId } from "@/lib/api/types";
import type { ManagementTarget } from "@/lib/api/remote";
import { mergeImportedSkills } from "@/hooks/useSkills.helpers";
import { runSequentialBulkAction } from "@/lib/utils/sequentialBulkAction";

const LOCAL_TARGET: ManagementTarget = { type: "local" };

const getTargetKey = (target: ManagementTarget) =>
  target.type === "remote" ? `remote:${target.profile.id}` : "local";

/**
 * 查询所有已安装的 Skills
 * 使用 staleTime: Infinity 实现首次进入使用缓存，只有刷新时才重新获取。
 * 不跨 query key 保留占位数据，避免切换管理目标时短暂显示另一目标的 Skill。
 */
export function useInstalledSkills(target: ManagementTarget = LOCAL_TARGET) {
  const targetKey = getTargetKey(target);
  return useQuery({
    queryKey: ["skills", "installed", targetKey],
    queryFn: () => skillsApi.getInstalled(target),
    staleTime: Infinity,
  });
}

export function useSkillBackups(target: ManagementTarget = LOCAL_TARGET) {
  const targetKey = getTargetKey(target);
  return useQuery({
    queryKey: ["skills", "backups", targetKey],
    queryFn: () => skillsApi.getBackups(target),
    enabled: false,
  });
}

export function useDeleteSkillBackup(target: ManagementTarget = LOCAL_TARGET) {
  const queryClient = useQueryClient();
  const targetKey = getTargetKey(target);
  return useMutation({
    mutationFn: (backupId: string) => skillsApi.deleteBackup(backupId, target),
    onSuccess: (_result, backupId) => {
      queryClient.setQueryData<SkillBackupEntry[]>(
        ["skills", "backups", targetKey],
        (oldData) => oldData?.filter((backup) => backup.backupId !== backupId),
      );
    },
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: ["skills", "backups", targetKey],
      }),
  });
}

/**
 * 发现可安装的 Skills（从仓库获取）
 * 使用 staleTime: Infinity 实现首次进入使用缓存，只有刷新时才重新获取。
 * 不跨 query key 保留占位数据，避免切换管理目标时短暂显示另一目标的 Skill。
 */
export function useDiscoverableSkills(target: ManagementTarget = LOCAL_TARGET) {
  const targetKey = getTargetKey(target);
  return useQuery({
    queryKey: ["skills", "discoverable", targetKey],
    queryFn: () => skillsApi.discoverAvailable(target),
    staleTime: Infinity,
  });
}

/**
 * 安装 Skill
 * 成功后直接更新缓存，不触发重新加载/刷新
 */
export function useInstallSkill(target: ManagementTarget = LOCAL_TARGET) {
  const queryClient = useQueryClient();
  const targetKey = getTargetKey(target);
  return useMutation({
    mutationFn: ({
      skill,
      currentApp,
    }: {
      skill: DiscoverableSkill;
      currentApp: AppId;
    }) => skillsApi.installUnified(skill, currentApp, target),
    onSuccess: (installedSkill, _vars) => {
      const { skill } = _vars;
      // 直接更新 installed 缓存
      queryClient.setQueryData<InstalledSkill[]>(
        ["skills", "installed", targetKey],
        (oldData) => {
          return mergeImportedSkills(oldData, [installedSkill]);
        },
      );

      // 更新 discoverable 缓存中对应技能的 installed 状态
      const installName =
        skill.directory.split(/[/\\]/).pop()?.toLowerCase() ||
        skill.directory.toLowerCase();
      const skillKey = `${installName}:${skill.repoOwner.toLowerCase()}:${skill.repoName.toLowerCase()}`;

      queryClient.setQueryData<DiscoverableSkill[]>(
        ["skills", "discoverable", targetKey],
        (oldData) => {
          if (!oldData) return oldData;
          return oldData.map((s) => {
            if (s.key === skillKey) {
              return { ...s, installed: true };
            }
            return s;
          });
        },
      );
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["skills", "installed", targetKey],
        }),
        queryClient.invalidateQueries({
          queryKey: ["skills", "unmanaged", targetKey],
        }),
      ]),
  });
}

/**
 * 卸载 Skill
 * 成功后直接更新缓存，不触发重新加载/刷新
 */
export function useUninstallSkill(target: ManagementTarget = LOCAL_TARGET) {
  const queryClient = useQueryClient();
  const targetKey = getTargetKey(target);
  return useMutation({
    mutationFn: ({ id, skillKey }: { id: string; skillKey: string }) => {
      return skillsApi
        .uninstallUnified(id, target)
        .then((result) => ({ ...result, skillKey }));
    },
    onSuccess: ({ skillKey }, { id }) => {
      // 直接更新 installed 缓存，移除该 skill
      queryClient.setQueryData<InstalledSkill[]>(
        ["skills", "installed", targetKey],
        (oldData) => {
          if (!oldData) return oldData;
          return oldData.filter((s) => s.id !== id);
        },
      );

      // 更新 discoverable 缓存中对应技能的 installed 状态
      queryClient.setQueryData<DiscoverableSkill[]>(
        ["skills", "discoverable", targetKey],
        (oldData) => {
          if (!oldData) return oldData;
          return oldData.map((s) => {
            if (s.key === skillKey) {
              return { ...s, installed: false };
            }
            return s;
          });
        },
      );
      queryClient.setQueryData<SkillUpdateInfo[]>(
        ["skills", "updates", targetKey],
        (oldData) => oldData?.filter((update) => update.id !== id),
      );
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["skills", "backups", targetKey],
        }),
        queryClient.invalidateQueries({
          queryKey: ["skills", "unmanaged", targetKey],
        }),
      ]),
  });
}

export function useRestoreSkillBackup(target: ManagementTarget = LOCAL_TARGET) {
  const queryClient = useQueryClient();
  const targetKey = getTargetKey(target);
  return useMutation({
    mutationFn: ({
      backupId,
      currentApp,
    }: {
      backupId: string;
      currentApp: AppId;
    }) => skillsApi.restoreBackup(backupId, currentApp, target),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["skills", "installed", targetKey],
        }),
        queryClient.invalidateQueries({
          queryKey: ["skills", "backups", targetKey],
        }),
      ]),
  });
}

/**
 * 切换 Skill 在特定应用的启用状态
 */
export function useToggleSkillApp(target: ManagementTarget = LOCAL_TARGET) {
  const queryClient = useQueryClient();
  const targetKey = getTargetKey(target);
  return useMutation({
    mutationFn: ({
      id,
      app,
      enabled,
    }: {
      id: string;
      app: AppId;
      enabled: boolean;
    }) => skillsApi.toggleApp(id, app, enabled, target),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["skills", "installed", targetKey],
      });
    },
  });
}

/** Toggle multiple Skills serially because each operation writes app files. */
export function useBulkToggleSkillApp(target: ManagementTarget = LOCAL_TARGET) {
  const queryClient = useQueryClient();
  const targetKey = getTargetKey(target);
  return useMutation({
    mutationFn: ({
      ids,
      app,
      enabled,
    }: {
      ids: string[];
      app: AppId;
      enabled: boolean;
    }) =>
      runSequentialBulkAction(ids, (id) =>
        skillsApi.toggleApp(id, app, enabled, target),
      ),
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: ["skills", "installed", targetKey],
      }),
  });
}

/**
 * 扫描未管理的 Skills
 *
 * - 传 { enabled: true }（Skill 面板挂载时）会在进入页面时自动静默扫描一次，
 *   30s 内复用结果，避免来回切页时重复磁盘 IO。
 * - 默认 enabled: false：仅订阅共享缓存（如顶栏「导入」按钮的绿点提示），
 *   不主动触发扫描。两者共用同一 queryKey，面板扫描完成后绿点会自动亮起。
 */
export function useScanUnmanagedSkills(
  target: ManagementTarget = LOCAL_TARGET,
  options?: { enabled?: boolean },
) {
  const targetKey = getTargetKey(target);
  return useQuery({
    queryKey: ["skills", "unmanaged", targetKey],
    queryFn: () => skillsApi.scanUnmanaged(target),
    enabled: options?.enabled ?? false,
    staleTime: 30 * 1000,
  });
}

/**
 * 从应用目录导入 Skills
 * 成功后直接更新缓存，不触发重新加载/刷新
 */
export function useImportSkillsFromApps(
  target: ManagementTarget = LOCAL_TARGET,
) {
  const queryClient = useQueryClient();
  const targetKey = getTargetKey(target);
  return useMutation({
    mutationFn: (imports: ImportSkillSelection[]) =>
      skillsApi.importFromApps(imports, target),
    onSuccess: (importedSkills) => {
      // 直接更新 installed 缓存
      queryClient.setQueryData<InstalledSkill[]>(
        ["skills", "installed", targetKey],
        (oldData) => mergeImportedSkills(oldData, importedSkills),
      );
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["skills", "installed", targetKey],
        }),
        queryClient.invalidateQueries({
          queryKey: ["skills", "unmanaged", targetKey],
        }),
        queryClient.invalidateQueries({
          queryKey: ["skills", "repos", targetKey],
        }),
        queryClient.invalidateQueries({
          queryKey: ["skills", "discoverable", targetKey],
        }),
      ]),
  });
}

/**
 * 获取仓库列表
 */
export function useSkillRepos(target: ManagementTarget = LOCAL_TARGET) {
  const targetKey = getTargetKey(target);
  return useQuery({
    queryKey: ["skills", "repos", targetKey],
    queryFn: () => skillsApi.getRepos(target),
  });
}

/**
 * 添加仓库
 */
export function useAddSkillRepo(target: ManagementTarget = LOCAL_TARGET) {
  const queryClient = useQueryClient();
  const targetKey = getTargetKey(target);
  return useMutation({
    mutationFn: (repo: SkillRepo) => skillsApi.addRepo(repo, target),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["skills", "repos", targetKey],
      });
      queryClient.invalidateQueries({
        queryKey: ["skills", "discoverable", targetKey],
      });
    },
  });
}

/**
 * 删除仓库
 */
export function useRemoveSkillRepo(target: ManagementTarget = LOCAL_TARGET) {
  const queryClient = useQueryClient();
  const targetKey = getTargetKey(target);
  return useMutation({
    mutationFn: ({ owner, name }: { owner: string; name: string }) =>
      skillsApi.removeRepo(owner, name, target),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["skills", "repos", targetKey],
      });
      queryClient.invalidateQueries({
        queryKey: ["skills", "discoverable", targetKey],
      });
    },
  });
}

/**
 * 从 ZIP 文件安装 Skills
 * 成功后直接更新缓存，不触发重新加载/刷新
 */
export function useInstallSkillsFromZip() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      filePath,
      currentApp,
    }: {
      filePath: string;
      currentApp: AppId;
    }) => skillsApi.installFromZip(filePath, currentApp),
    onSuccess: (installedSkills) => {
      // 直接更新 installed 缓存
      queryClient.setQueryData<InstalledSkill[]>(
        ["skills", "installed", "local"],
        (oldData) => {
          return mergeImportedSkills(oldData, installedSkills);
        },
      );
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["skills", "installed", "local"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["skills", "unmanaged", "local"],
        }),
      ]),
  });
}

// ========== 更新检测 ==========

/**
 * 检查 Skills 更新（手动触发）
 */
export function useCheckSkillUpdates(target: ManagementTarget = LOCAL_TARGET) {
  const targetKey = getTargetKey(target);
  return useQuery({
    queryKey: ["skills", "updates", targetKey],
    queryFn: () => skillsApi.checkUpdates(target),
    enabled: false,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * 更新单个 Skill
 */
export function useUpdateSkill(target: ManagementTarget = LOCAL_TARGET) {
  const queryClient = useQueryClient();
  const targetKey = getTargetKey(target);
  return useMutation({
    mutationFn: (id: string) => skillsApi.updateSkill(id, target),
    onSuccess: (updatedSkill) => {
      queryClient.setQueryData<InstalledSkill[]>(
        ["skills", "installed", targetKey],
        (oldData) => {
          if (!oldData) return [updatedSkill];
          return oldData.map((s) =>
            s.id === updatedSkill.id ? updatedSkill : s,
          );
        },
      );
      queryClient.setQueryData<SkillUpdateInfo[]>(
        ["skills", "updates", targetKey],
        (oldData) => {
          if (!oldData) return oldData;
          return oldData.filter((u) => u.id !== updatedSkill.id);
        },
      );
    },
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: ["skills", "backups", targetKey],
      }),
  });
}

// ========== skills.sh 搜索 ==========

/**
 * 搜索 skills.sh 公共目录
 * 使用 300ms staleTime 和 keepPreviousData 实现平滑搜索体验
 */
export function useSearchSkillsSh(
  query: string,
  limit: number,
  offset: number,
) {
  return useQuery({
    queryKey: ["skills", "skillssh", query, limit, offset],
    queryFn: () => skillsApi.searchSkillsSh(query, limit, offset),
    enabled: query.length >= 2,
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
  });
}

// ========== 辅助类型 ==========

export type {
  InstalledSkill,
  DiscoverableSkill,
  ImportSkillSelection,
  SkillBackupEntry,
  SkillUpdateInfo,
  SkillsShSearchResult,
  AppId,
};
