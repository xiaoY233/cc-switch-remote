import { useCallback, useMemo } from "react";
import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import type { Provider } from "@/types";
import { providersApi, type AppId, type ManagementTarget } from "@/lib/api";

const getProviderTargetKey = (target: ManagementTarget) =>
  target.type === "remote" ? `remote:${target.profile.id}` : "local";

export function useDragSort(
  providers: Record<string, Provider>,
  appId: AppId,
  target: ManagementTarget = { type: "local" },
) {
  const queryClient = useQueryClient();
  const { t, i18n } = useTranslation();

  const sortedProviders = useMemo(() => {
    const locale =
      i18n.language === "zh"
        ? "zh-CN"
        : i18n.language === "zh-TW"
          ? "zh-TW"
          : "en-US";
    return Object.values(providers).sort((a, b) => {
      if (a.sortIndex !== undefined && b.sortIndex !== undefined) {
        return a.sortIndex - b.sortIndex;
      }
      if (a.sortIndex !== undefined) return -1;
      if (b.sortIndex !== undefined) return 1;

      const timeA = a.createdAt ?? 0;
      const timeB = b.createdAt ?? 0;
      if (timeA && timeB && timeA !== timeB) {
        return timeA - timeB;
      }

      return a.name.localeCompare(b.name, locale);
    });
  }, [providers, i18n.language]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) {
        return;
      }

      const oldIndex = sortedProviders.findIndex(
        (provider) => provider.id === active.id,
      );
      const newIndex = sortedProviders.findIndex(
        (provider) => provider.id === over.id,
      );

      if (oldIndex === -1 || newIndex === -1) {
        return;
      }

      const reordered = arrayMove(sortedProviders, oldIndex, newIndex);
      const updates = reordered.map((provider, index) => ({
        id: provider.id,
        sortIndex: index,
      }));

      try {
        await providersApi.updateSortOrder(updates, appId, target);
        const targetKey = getProviderTargetKey(target);
        await queryClient.invalidateQueries({
          queryKey: ["providers", appId, targetKey],
        });
        // 刷新故障转移队列（队列顺序依赖 sort_index），本地与远程都按
        // target 隔离缓存，避免远程排序后继续展示旧队列顺序。
        await queryClient.invalidateQueries({
          queryKey: ["failoverQueue", targetKey, appId],
        });

        if (target.type === "local") {
          // 更新托盘菜单以反映新的排序（失败不影响主操作）
          try {
            await providersApi.updateTrayMenu();
          } catch (trayError) {
            console.error("Failed to update tray menu after sort", trayError);
            // 托盘菜单更新失败不影响排序成功
          }
        }

        toast.success(
          t("provider.sortUpdated", {
            defaultValue: "排序已更新",
          }),
          { closeButton: true },
        );
      } catch (error) {
        console.error("Failed to update provider sort order", error);
        toast.error(
          t("provider.sortUpdateFailed", {
            defaultValue: "排序更新失败",
          }),
        );
      }
    },
    [sortedProviders, appId, queryClient, t, target],
  );

  return {
    sortedProviders,
    sensors,
    handleDragEnd,
  };
}
