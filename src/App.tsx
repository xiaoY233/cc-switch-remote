import { useEffect, useMemo, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";
import { useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Settings,
  ArrowLeft,
  Minus,
  Maximize2,
  Minimize2,
  X,
  Book,
  Brain,
  Wrench,
  History,
  BarChart2,
  Download,
  FolderArchive,
  Search,
  Server,
  FolderOpen,
  KeyRound,
  Shield,
  Cpu,
  LayoutDashboard,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Provider, Settings as AppSettings, VisibleApps } from "@/types";
import type { EnvConflict } from "@/types/env";
import {
  proxyKeys,
  useProvidersQuery,
  useRemoteSessionStatus,
  useSettingsQuery,
} from "@/lib/query";
import {
  providersApi,
  remoteApi,
  settingsApi,
  type AppId,
  type ManagementTarget,
  type RemoteConnectionSecret,
  type RemoteHostProfile,
  type ProviderSwitchEvent,
} from "@/lib/api";
import { checkAllEnvConflicts, checkEnvConflicts } from "@/lib/api/env";
import { useProviderActions } from "@/hooks/useProviderActions";
import { openclawKeys, useOpenClawHealth } from "@/hooks/useOpenClaw";
import { hermesKeys, useOpenHermesWebUI } from "@/hooks/useHermes";
import { hermesApi } from "@/lib/api/hermes";
import { useProxyStatus } from "@/hooks/useProxyStatus";
import { useUsageCacheBridge } from "@/hooks/useUsageCacheBridge";
import { useTauriEvent } from "@/hooks/useTauriEvent";
import { useLastValidValue } from "@/hooks/useLastValidValue";
import { useScanUnmanagedSkills } from "@/hooks/useSkills";
import { useTargetQueryIdentityReset } from "@/hooks/useTargetQueryIdentityReset";
import {
  extractErrorMessage,
  isRemotePasswordRequiredError,
} from "@/utils/errorUtils";
import { isTextEditableTarget } from "@/utils/domUtils";
import { deepClone } from "@/utils/deepClone";
import { cn } from "@/lib/utils";
import {
  getManagementTargetKey,
  isRemoteSafeView,
  LOCAL_MANAGEMENT_TARGET,
} from "@/lib/managementTarget";
import { isManagementInteractionBusy } from "@/lib/managementBusy";
import {
  isWindows,
  isLinux,
  DRAG_REGION_ATTR,
  DRAG_REGION_STYLE,
} from "@/lib/platform";
import { AppSwitcher } from "@/components/AppSwitcher";
import { ProfileSwitcher } from "@/components/profiles/ProfileSwitcher";
import { ProviderList } from "@/components/providers/ProviderList";
import { AddProviderDialog } from "@/components/providers/AddProviderDialog";
import { EditProviderDialog } from "@/components/providers/EditProviderDialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { RemoteSettingsPage } from "@/components/settings/RemoteSettingsPage";
import { UpdateBadge } from "@/components/UpdateBadge";
import { EnvWarningBanner } from "@/components/env/EnvWarningBanner";
import { ProxyToggle } from "@/components/proxy/ProxyToggle";
import { ClaudeDesktopRouteToggle } from "@/components/proxy/ClaudeDesktopRouteToggle";
import { FailoverToggle } from "@/components/proxy/FailoverToggle";
import { RemoteAppRoutingToggle } from "@/components/proxy/RemoteAppRoutingToggle";
import { isRemoteRoutableApp } from "@/lib/remoteRoutingApps";
import { useAppProxyConfig } from "@/lib/query/proxy";
import UsageScriptModal from "@/components/UsageScriptModal";
import UnifiedMcpPanel from "@/components/mcp/UnifiedMcpPanel";
import PromptPanel from "@/components/prompts/PromptPanel";
import {
  SkillsPage,
  getSkillsPageHeaderActions,
  type SkillsPageSource,
} from "@/components/skills/SkillsPage";
import UnifiedSkillsPanel, {
  type SkillsCheckUpdatesState,
} from "@/components/skills/UnifiedSkillsPanel";
import { DeepLinkImportDialog } from "@/components/DeepLinkImportDialog";
import { FirstRunNoticeDialog } from "@/components/FirstRunNoticeDialog";
import { AgentsPanel } from "@/components/agents/AgentsPanel";
import { UniversalProviderPanel } from "@/components/universal";
import { McpIcon } from "@/components/BrandIcons";
import { Button } from "@/components/ui/button";
import { SessionManagerPage } from "@/components/sessions/SessionManagerPage";
import {
  useDisableCurrentOmo,
  useDisableCurrentOmoSlim,
} from "@/lib/query/omo";
import WorkspaceFilesPanel from "@/components/workspace/WorkspaceFilesPanel";
import EnvPanel from "@/components/openclaw/EnvPanel";
import ToolsPanel from "@/components/openclaw/ToolsPanel";
import AgentsDefaultsPanel from "@/components/openclaw/AgentsDefaultsPanel";
import OpenClawHealthBanner from "@/components/openclaw/OpenClawHealthBanner";
import HermesMemoryPanel from "@/components/hermes/HermesMemoryPanel";
import { RemoteServersPage } from "@/components/remote/RemoteServersPage";
import { ManagementTargetSwitcher } from "@/components/remote/ManagementTargetSwitcher";
import { RemoteSessionPasswordDialog } from "@/components/remote/RemoteSessionPasswordDialog";

type View =
  | "providers"
  | "settings"
  | "prompts"
  | "skills"
  | "skillsDiscovery"
  | "mcp"
  | "agents"
  | "universal"
  | "sessions"
  | "workspace"
  | "openclawEnv"
  | "openclawTools"
  | "openclawAgents"
  | "hermesMemory"
  | "remoteServers";

const TARGET_AWARE_VIEWS = new Set<View>([
  "settings",
  "prompts",
  "skills",
  "skillsDiscovery",
  "mcp",
  "sessions",
  "openclawEnv",
  "openclawTools",
  "openclawAgents",
  "hermesMemory",
]);

interface SyncStatusUpdatedPayload {
  source?: string;
  status?: string;
  error?: string;
}

const DEFAULT_DRAG_BAR_HEIGHT = isWindows() || isLinux() ? 0 : 28; // px
const HEADER_HEIGHT = 64; // px

const STORAGE_KEY = "cc-switch-last-app";
const VALID_APPS: AppId[] = [
  "claude",
  "claude-desktop",
  "codex",
  "gemini",
  "grokbuild",
  "opencode",
  "openclaw",
  "hermes",
];

const getInitialApp = (): AppId => {
  const saved = localStorage.getItem(STORAGE_KEY) as AppId | null;
  if (saved && VALID_APPS.includes(saved)) {
    return saved;
  }
  return "claude";
};

const VIEW_STORAGE_KEY = "cc-switch-last-view";
const VALID_VIEWS: View[] = [
  "providers",
  "settings",
  "prompts",
  "skills",
  "skillsDiscovery",
  "mcp",
  "agents",
  "universal",
  "sessions",
  "workspace",
  "openclawEnv",
  "openclawTools",
  "openclawAgents",
  "hermesMemory",
  "remoteServers",
];

const DEFAULT_VISIBLE_APPS: VisibleApps = {
  claude: true,
  "claude-desktop": true,
  codex: true,
  gemini: true,
  grokbuild: true,
  opencode: true,
  openclaw: true,
  hermes: true,
};

const getInitialView = (): View => {
  const saved = localStorage.getItem(VIEW_STORAGE_KEY) as View | null;
  if (saved && VALID_VIEWS.includes(saved)) {
    return saved;
  }
  return "providers";
};

function App() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [activeApp, setActiveApp] = useState<AppId>(getInitialApp);
  const [remoteProfiles, setRemoteProfiles] = useState<RemoteHostProfile[]>([]);
  const [remoteSecrets, setRemoteSecrets] = useState<
    Record<string, RemoteConnectionSecret>
  >({});
  const [activeRemoteSettings, setActiveRemoteSettings] =
    useState<AppSettings | null>(null);
  const [activeTargetKey, setActiveTargetKey] = useState("local");
  const [passwordPromptProfile, setPasswordPromptProfile] =
    useState<RemoteHostProfile | null>(null);
  const sharedFeatureApp: AppId =
    activeApp === "claude-desktop" ? "claude" : activeApp;
  const [currentView, setCurrentView] = useState<View>(getInitialView);
  const [skillsDiscoverySource, setSkillsDiscoverySource] =
    useState<SkillsPageSource>("repos");
  const [settingsDefaultTab, setSettingsDefaultTab] = useState("general");
  const [forceLocalSettings, setForceLocalSettings] = useState(false);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const [mcpManagementBusy, setMcpManagementBusy] = useState(false);
  const [skillsManagementBusy, setSkillsManagementBusy] = useState(false);
  const [skillsNavigationBusy, setSkillsNavigationBusy] = useState(false);
  const [promptManagementBusy, setPromptManagementBusy] = useState(false);
  const [promptNavigationBusy, setPromptNavigationBusy] = useState(false);
  const [remoteSettingsManagementBusy, setRemoteSettingsManagementBusy] =
    useState(false);
  const [skillsCheckUpdatesState, setSkillsCheckUpdatesState] =
    useState<SkillsCheckUpdatesState>({
      isChecking: false,
      hasSkills: false,
    });
  const managementBusy = isManagementInteractionBusy({
    mcp: mcpManagementBusy,
    skills: skillsManagementBusy,
    skillsNavigation: skillsNavigationBusy,
    promptsNavigation: promptNavigationBusy,
    // Managed OAuth/device polling lives inside these target-scoped forms.
    // Lock target navigation for the dialog lifetime so credentials and
    // device codes cannot be completed against another server.
    providerDialog: isAddOpen || Boolean(editingProvider),
    remoteSettings: remoteSettingsManagementBusy,
  });

  useEffect(() => {
    localStorage.setItem(VIEW_STORAGE_KEY, currentView);
  }, [currentView]);

  const { data: settingsData } = useSettingsQuery();
  const useAppWindowControls =
    isLinux() && (settingsData?.useAppWindowControls ?? false);
  const dragBarHeight = useAppWindowControls ? 32 : DEFAULT_DRAG_BAR_HEIGHT;
  const contentTopOffset = dragBarHeight + HEADER_HEIGHT;

  useEffect(() => {
    let active = true;
    void remoteApi
      .listProfiles()
      .then((profiles) => {
        if (!active) return;
        setRemoteProfiles(profiles);
      })
      .catch((error) => {
        console.error("[App] Failed to load remote profiles", error);
      });
    return () => {
      active = false;
    };
  }, []);

  const activeRemoteProfile = useMemo(
    () =>
      activeTargetKey.startsWith("remote:")
        ? remoteProfiles.find(
            (profile) => `remote:${profile.id}` === activeTargetKey,
          )
        : undefined,
    [activeTargetKey, remoteProfiles],
  );
  const { data: activeRemoteSessionStatus } =
    useRemoteSessionStatus(activeRemoteProfile);

  const visibleApps: VisibleApps = activeRemoteProfile
    ? (activeRemoteSettings?.visibleApps ?? DEFAULT_VISIBLE_APPS)
    : (settingsData?.visibleApps ?? DEFAULT_VISIBLE_APPS);

  const getFirstVisibleApp = (): AppId => {
    if (visibleApps.claude) return "claude";
    if (visibleApps["claude-desktop"]) return "claude-desktop";
    if (visibleApps.codex) return "codex";
    if (visibleApps.gemini) return "gemini";
    if (visibleApps.grokbuild) return "grokbuild";
    if (visibleApps.opencode) return "opencode";
    if (visibleApps.openclaw) return "openclaw";
    if (visibleApps.hermes) return "hermes";
    return "claude"; // fallback
  };

  useEffect(() => {
    if (activeTargetKey === "local") return;
    if (!activeRemoteProfile) {
      setActiveTargetKey("local");
    }
  }, [activeTargetKey, activeRemoteProfile]);

  const managementTarget: ManagementTarget = useMemo(() => {
    if (activeRemoteProfile) {
      return {
        type: "remote",
        profile: activeRemoteProfile,
        secret: remoteSecrets[activeRemoteProfile.id],
      };
    }
    return { type: "local" };
  }, [activeRemoteProfile, remoteSecrets]);
  const isRemoteTarget = managementTarget.type === "remote";
  const managementTargetKey = getManagementTargetKey(managementTarget);
  const managementConnectionRevision = useTargetQueryIdentityReset(
    "all",
    managementTarget,
    managementTargetKey,
  );

  useEffect(() => {
    if (managementTarget.type !== "remote") {
      setActiveRemoteSettings(null);
      return;
    }

    let active = true;
    setActiveRemoteSettings(null);
    void remoteApi
      .getSettings(managementTarget.profile, managementTarget.secret)
      .then((settings) => {
        if (active) {
          setActiveRemoteSettings(settings);
        }
      })
      .catch((error) => {
        console.warn("[App] Failed to load remote settings", error);
      });

    return () => {
      active = false;
    };
  }, [managementTarget]);

  const handleRemoteSettingsSaved = (settings: AppSettings) => {
    if (managementTarget.type === "remote") {
      setActiveRemoteSettings(settings);
    }
  };

  const handleManagementTargetChange = (targetKey: string) => {
    if (managementBusy) return;
    setForceLocalSettings(false);
    if (targetKey === "local") {
      setPasswordPromptProfile(null);
      setActiveTargetKey("local");
      return;
    }

    const profile = remoteProfiles.find(
      (item) => `remote:${item.id}` === targetKey,
    );
    if (!profile) {
      setPasswordPromptProfile(null);
      setActiveTargetKey("local");
      return;
    }

    setPasswordPromptProfile(null);
    setActiveTargetKey(targetKey);
  };

  const handleOpenRemoteServers = () => {
    if (managementBusy) return;
    setCurrentView("remoteServers");
  };

  const handleSessionPasswordSubmit = async (password: string) => {
    if (!passwordPromptProfile) return;
    const profile = passwordPromptProfile;
    const secret = { password };
    try {
      const saved = await remoteApi.saveProfile(profile, secret);
      setRemoteProfiles((current) =>
        current.map((item) => (item.id === saved.id ? saved : item)),
      );
    } catch (error) {
      const message =
        extractErrorMessage(error) ||
        t("remote.saveFailed", {
          defaultValue: "保存远程服务器失败",
        });
      toast.error(message);
      throw error;
    }
    setRemoteSecrets((current) => ({
      ...current,
      [profile.id]: secret,
    }));
    setPasswordPromptProfile(null);
    setActiveTargetKey(`remote:${profile.id}`);
    await queryClient.invalidateQueries({ queryKey: ["providers"] });
  };

  const handleRemoteProfileSaved = (
    profile: RemoteHostProfile,
    secret?: RemoteConnectionSecret,
  ) => {
    setRemoteProfiles((current) => {
      const next = current.filter((item) => item.id !== profile.id);
      return [profile, ...next];
    });
    setRemoteSecrets((current) => {
      const next = { ...current };
      if (profile.authMethod.type === "password" && secret?.password) {
        next[profile.id] = secret;
      } else {
        delete next[profile.id];
      }
      return next;
    });
  };

  const handleRemoteProfileActivated = (profileId: string | null) => {
    handleManagementTargetChange(profileId ? `remote:${profileId}` : "local");
  };

  useEffect(() => {
    if (!visibleApps[activeApp]) {
      setActiveApp(getFirstVisibleApp());
    }
  }, [visibleApps, activeApp]);

  // Fallback from sessions view when switching to an app without session support
  useEffect(() => {
    if (
      currentView === "sessions" &&
      sharedFeatureApp !== "claude" &&
      sharedFeatureApp !== "codex" &&
      sharedFeatureApp !== "grokbuild" &&
      sharedFeatureApp !== "opencode" &&
      sharedFeatureApp !== "openclaw" &&
      sharedFeatureApp !== "gemini" &&
      sharedFeatureApp !== "hermes"
    ) {
      setCurrentView("providers");
    }
  }, [sharedFeatureApp, currentView]);

  useEffect(() => {
    if (isRemoteTarget && !isRemoteSafeView(currentView)) {
      setCurrentView("providers");
    }
  }, [currentView, isRemoteTarget]);

  const [usageProvider, setUsageProvider] = useState<Provider | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    provider: Provider;
    action: "remove" | "delete";
  } | null>(null);
  const [envConflicts, setEnvConflicts] = useState<EnvConflict[]>([]);
  const [showEnvBanner, setShowEnvBanner] = useState(false);

  const effectiveEditingProvider = useLastValidValue(editingProvider);
  const effectiveUsageProvider = useLastValidValue(usageProvider);

  useUsageCacheBridge();

  const promptPanelRef = useRef<any>(null);
  const mcpPanelRef = useRef<any>(null);
  const skillsPageRef = useRef<any>(null);
  const unifiedSkillsPanelRef = useRef<any>(null);
  // 订阅未管理 Skill 的共享缓存（实际扫描由 UnifiedSkillsPanel 进入页面时触发）。
  // 这里 enabled 默认 false，仅用于「导入」按钮的绿点提示，不主动发起扫描。
  const { data: unmanagedSkills } = useScanUnmanagedSkills(managementTarget);
  const hasUnmanagedSkills = (unmanagedSkills?.length ?? 0) > 0;
  const addActionButtonClass =
    "bg-orange-500 hover:bg-orange-600 dark:bg-orange-500 dark:hover:bg-orange-600 text-white shadow-lg shadow-orange-500/30 dark:shadow-orange-500/40 rounded-full w-8 h-8";

  const {
    isRunning: isProxyRunning,
    takeoverStatus,
    status: proxyStatus,
  } = useProxyStatus(managementTarget);
  const isCurrentAppTakeoverActive = takeoverStatus?.[activeApp] || false;
  const remoteRoutableActiveApp = isRemoteRoutableApp(activeApp)
    ? activeApp
    : null;
  const { data: activeRemoteAppProxyConfig } = useAppProxyConfig(
    remoteRoutableActiveApp ?? "claude",
    managementTarget,
    managementTarget.type === "remote" && Boolean(remoteRoutableActiveApp),
  );
  const isCurrentRemoteAppRouteActive =
    managementTarget.type === "remote" &&
    isProxyRunning &&
    Boolean(remoteRoutableActiveApp) &&
    Boolean(activeRemoteAppProxyConfig?.enabled);
  const showRemoteHomepageRoutingToggle =
    activeRemoteSettings?.enableRemoteRoutingToggle === true;
  const showRemoteHomepageFailoverToggle =
    activeRemoteSettings?.enableRemoteFailoverToggle === true;
  const isCurrentAppRouteActive =
    managementTarget.type === "local"
      ? isCurrentAppTakeoverActive
      : isCurrentRemoteAppRouteActive;
  const activeProviderId = useMemo(() => {
    const target = proxyStatus?.active_targets?.find(
      (t) => t.app_type === activeApp,
    );
    return target?.provider_id;
  }, [proxyStatus?.active_targets, activeApp]);

  const {
    data,
    isLoading,
    error: providerLoadError,
    refetch,
  } = useProvidersQuery(activeApp, {
    isProxyRunning,
    target: managementTarget,
  });

  useEffect(() => {
    if (
      !activeRemoteProfile ||
      activeRemoteProfile.authMethod.type !== "password" ||
      remoteSecrets[activeRemoteProfile.id]?.password ||
      passwordPromptProfile?.id === activeRemoteProfile.id ||
      !isRemotePasswordRequiredError(providerLoadError)
    ) {
      return;
    }

    setPasswordPromptProfile(activeRemoteProfile);
  }, [
    activeRemoteProfile,
    passwordPromptProfile?.id,
    providerLoadError,
    remoteSecrets,
  ]);

  const providers = useMemo(() => data?.providers ?? {}, [data]);
  const currentProviderId = data?.currentProviderId ?? "";
  const isOpenClawView =
    activeApp === "openclaw" &&
    (currentView === "providers" ||
      currentView === "workspace" ||
      currentView === "sessions" ||
      currentView === "openclawEnv" ||
      currentView === "openclawTools" ||
      currentView === "openclawAgents");
  const { data: openclawHealthWarnings = [] } = useOpenClawHealth(
    isOpenClawView,
    managementTarget,
  );
  const hasSkillsSupport = sharedFeatureApp !== "openclaw";
  const hasSessionSupport =
    sharedFeatureApp === "claude" ||
    sharedFeatureApp === "codex" ||
    sharedFeatureApp === "grokbuild" ||
    sharedFeatureApp === "opencode" ||
    sharedFeatureApp === "openclaw" ||
    sharedFeatureApp === "gemini" ||
    sharedFeatureApp === "hermes";
  const canOpenSessions = hasSessionSupport;

  const {
    addProvider,
    updateProvider,
    switchProvider,
    deleteProvider,
    saveUsageScript,
    setAsDefaultModel,
  } = useProviderActions(
    activeApp,
    isProxyRunning,
    isProxyRunning && isCurrentAppRouteActive,
    managementTarget,
  );

  const disableOmoMutation = useDisableCurrentOmo(managementTarget);
  const handleDisableOmo = () => {
    disableOmoMutation.mutate(undefined, {
      onSuccess: () => {
        toast.success(t("omo.disabled", { defaultValue: "OMO 已停用" }));
      },
      onError: (error: Error) => {
        toast.error(
          t("omo.disableFailed", {
            defaultValue: "停用 OMO 失败: {{error}}",
            error: extractErrorMessage(error),
          }),
        );
      },
    });
  };

  const disableOmoSlimMutation = useDisableCurrentOmoSlim(managementTarget);
  const handleDisableOmoSlim = () => {
    disableOmoSlimMutation.mutate(undefined, {
      onSuccess: () => {
        toast.success(t("omo.disabled", { defaultValue: "OMO 已停用" }));
      },
      onError: (error: Error) => {
        toast.error(
          t("omo.disableFailed", {
            defaultValue: "停用 OMO 失败: {{error}}",
            error: extractErrorMessage(error),
          }),
        );
      },
    });
  };

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let active = true;

    const setupListener = async () => {
      try {
        const off = await providersApi.onSwitched(
          async (event: ProviderSwitchEvent) => {
            if (event.appType === activeApp) {
              await refetch();
            }
          },
        );
        if (!active) {
          off();
          return;
        }
        unsubscribe = off;
      } catch (error) {
        console.error("[App] Failed to subscribe provider switch event", error);
      }
    };

    void setupListener();
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [activeApp, refetch]);

  useTauriEvent("universal-provider-synced", async () => {
    await queryClient.invalidateQueries({ queryKey: ["providers"] });
    try {
      await providersApi.updateTrayMenu();
    } catch (error) {
      console.error("[App] Failed to update tray menu", error);
    }
  });

  useTauriEvent("remote-universal-provider-synced", async () => {
    await queryClient.invalidateQueries({ queryKey: ["providers"] });
  });

  // 应用项目后刷新相关缓存（providers 由既有 provider-switched 监听承接；
  // proxy 状态由后端直接改 DB，不走 mutation，必须显式刷新）
  useTauriEvent("profile-applied", async () => {
    await queryClient.invalidateQueries({ queryKey: ["profiles"] });
    await queryClient.invalidateQueries({ queryKey: ["mcp", "all"] });
    await queryClient.invalidateQueries({ queryKey: ["skills"] });
    await queryClient.invalidateQueries({
      queryKey: proxyKeys.takeoverStatus(LOCAL_MANAGEMENT_TARGET),
    });
    await queryClient.invalidateQueries({
      queryKey: proxyKeys.status(LOCAL_MANAGEMENT_TARGET),
    });
    await queryClient.invalidateQueries({
      queryKey: ["providers", "claude-desktop"],
    });
  });

  useTauriEvent<SyncStatusUpdatedPayload | null | undefined>(
    "webdav-sync-status-updated",
    async (payload) => {
      const statusPayload = payload ?? {};
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      if (statusPayload.source !== "auto" || statusPayload.status !== "error") {
        return;
      }
      toast.error(
        t("settings.webdavSync.autoSyncFailedToast", {
          error: statusPayload.error || t("common.unknown"),
        }),
      );
    },
  );

  useTauriEvent<SyncStatusUpdatedPayload | null | undefined>(
    "s3-sync-status-updated",
    async (payload) => {
      const statusPayload = payload ?? {};
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      if (statusPayload.source !== "auto" || statusPayload.status !== "error") {
        return;
      }
      toast.error(
        t("settings.s3Sync.autoSyncFailedToast", {
          error: statusPayload.error || t("common.unknown"),
        }),
      );
    },
  );

  useTauriEvent<{ appType: string; providerName: string }>(
    "proxy-official-warning",
    (payload) => {
      toast.warning(
        t("notifications.proxyOfficialWarning", {
          name: payload.providerName,
          defaultValue: `当前供应商 ${payload.providerName} 是官方供应商，建议切换到第三方供应商后再使用代理接管`,
        }),
        { duration: 8000 },
      );
    },
  );

  useEffect(() => {
    let active = true;
    let unlistenResize: (() => void) | undefined;

    const setupWindowStateSync = async () => {
      try {
        const currentWindow = getCurrentWindow();
        const syncWindowMaximizedState = async () => {
          const maximized = await currentWindow.isMaximized();
          if (active) {
            setIsWindowMaximized(maximized);
          }
        };

        await syncWindowMaximizedState();
        unlistenResize = await currentWindow.onResized(() => {
          void syncWindowMaximizedState();
        });
      } catch (error) {
        console.error("[App] Failed to sync window maximized state", error);
      }
    };

    void setupWindowStateSync();
    return () => {
      active = false;
      unlistenResize?.();
    };
  }, []);

  useEffect(() => {
    // settingsData 未加载时跳过，避免用 fallback false 覆盖 Rust 侧已设好的装饰状态
    if (!settingsData) return;

    const syncWindowDecorations = async () => {
      try {
        await getCurrentWindow().setDecorations(!useAppWindowControls);
      } catch (error) {
        console.error("[App] Failed to update window decorations", error);
      }
    };

    void syncWindowDecorations();
  }, [useAppWindowControls, settingsData]);

  useEffect(() => {
    const checkEnvOnStartup = async () => {
      try {
        const allConflicts = await checkAllEnvConflicts();
        const flatConflicts = Object.values(allConflicts).flat();

        if (flatConflicts.length > 0) {
          setEnvConflicts(flatConflicts);
          const dismissed = sessionStorage.getItem("env_banner_dismissed");
          if (!dismissed) {
            setShowEnvBanner(true);
          }
        }
      } catch (error) {
        console.error(
          "[App] Failed to check environment conflicts on startup:",
          error,
        );
      }
    };

    checkEnvOnStartup();
  }, []);

  useEffect(() => {
    const checkMigration = async () => {
      try {
        const migrated = await invoke<boolean>("get_migration_result");
        if (migrated) {
          toast.success(
            t("migration.success", { defaultValue: "配置迁移成功" }),
            { closeButton: true },
          );
        }
      } catch (error) {
        console.error("[App] Failed to check migration result:", error);
      }
    };

    checkMigration();
  }, [t]);

  useEffect(() => {
    const checkSkillsMigration = async () => {
      try {
        const result = await invoke<{ count: number; error?: string } | null>(
          "get_skills_migration_result",
        );
        if (result?.error) {
          toast.error(t("migration.skillsFailed"), {
            description: t("migration.skillsFailedDescription"),
            closeButton: true,
          });
          console.error("[App] Skills SSOT migration failed:", result.error);
          return;
        }
        if (result && result.count > 0) {
          toast.success(t("migration.skillsSuccess", { count: result.count }), {
            closeButton: true,
          });
          await queryClient.invalidateQueries({ queryKey: ["skills"] });
        }
      } catch (error) {
        console.error("[App] Failed to check skills migration result:", error);
      }
    };

    checkSkillsMigration();
  }, [t, queryClient]);

  useEffect(() => {
    const checkEnvOnSwitch = async () => {
      try {
        const conflicts = await checkEnvConflicts(activeApp);

        if (conflicts.length > 0) {
          setEnvConflicts((prev) => {
            const existingKeys = new Set(
              prev.map((c) => `${c.varName}:${c.sourcePath}`),
            );
            const newConflicts = conflicts.filter(
              (c) => !existingKeys.has(`${c.varName}:${c.sourcePath}`),
            );
            return [...prev, ...newConflicts];
          });
          const dismissed = sessionStorage.getItem("env_banner_dismissed");
          if (!dismissed) {
            setShowEnvBanner(true);
          }
        }
      } catch (error) {
        console.error(
          "[App] Failed to check environment conflicts on app switch:",
          error,
        );
      }
    };

    checkEnvOnSwitch();
  }, [activeApp]);

  const currentViewRef = useRef(currentView);
  const managementBusyRef = useRef(false);
  managementBusyRef.current = managementBusy;

  useEffect(() => {
    currentViewRef.current = currentView;
  }, [currentView]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "," && (event.metaKey || event.ctrlKey)) {
        if (managementBusyRef.current) {
          event.preventDefault();
          return;
        }
        event.preventDefault();
        setCurrentView("settings");
        return;
      }

      if (event.key !== "Escape" || event.defaultPrevented) return;

      if (document.body.style.overflow === "hidden") return;

      const view = currentViewRef.current;
      if (view === "providers") return;
      if (managementBusyRef.current) return;

      if (isTextEditableTarget(event.target)) return;

      event.preventDefault();
      setCurrentView(view === "skillsDiscovery" ? "skills" : "providers");
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const [launchDashboardOpen, setLaunchDashboardOpen] = useState(false);
  const openHermesWebUI = useOpenHermesWebUI(() =>
    setLaunchDashboardOpen(true),
  );

  const handleOpenWebsite = async (url: string) => {
    try {
      await settingsApi.openExternal(url);
    } catch (error) {
      const detail =
        extractErrorMessage(error) ||
        t("notifications.openLinkFailed", {
          defaultValue: "链接打开失败",
        });
      toast.error(detail);
    }
  };

  const handleEditProvider = async ({
    provider,
    originalId,
  }: {
    provider: Provider;
    originalId?: string;
  }) => {
    await updateProvider(provider, originalId);
    setEditingProvider(null);
  };

  const handleConfirmAction = async () => {
    if (!confirmAction) return;
    const { provider, action } = confirmAction;

    if (action === "remove") {
      // Remove from live config only (for additive mode apps like OpenCode/OpenClaw)
      // Does NOT delete from database - provider remains in the list
      await providersApi.removeFromLiveConfig(
        provider.id,
        activeApp,
        managementTarget,
      );
      // Invalidate queries to refresh the isInConfig state
      if (activeApp === "opencode") {
        await queryClient.invalidateQueries({
          queryKey: [
            "opencodeLiveProviderIds",
            getManagementTargetKey(managementTarget),
          ],
        });
      } else if (activeApp === "openclaw") {
        await queryClient.invalidateQueries({
          queryKey: openclawKeys.liveProviderIds(
            getManagementTargetKey(managementTarget),
          ),
        });
        await queryClient.invalidateQueries({
          queryKey: openclawKeys.health,
        });
      } else if (activeApp === "hermes") {
        await queryClient.invalidateQueries({
          queryKey: hermesKeys.liveProviderIds(
            getManagementTargetKey(managementTarget),
          ),
        });
      }
      toast.success(
        t("notifications.removeFromConfigSuccess", {
          defaultValue: "已从配置移除",
        }),
        { closeButton: true },
      );
    } else {
      await deleteProvider(provider.id);
    }
    setConfirmAction(null);
  };

  const generateUniqueProviderCopyKey = (
    originalKey: string,
    existingKeys: string[],
  ): string => {
    const baseKey = `${originalKey}-copy`;

    if (!existingKeys.includes(baseKey)) {
      return baseKey;
    }

    let counter = 2;
    while (existingKeys.includes(`${baseKey}-${counter}`)) {
      counter++;
    }
    return `${baseKey}-${counter}`;
  };

  const handleDuplicateProvider = async (provider: Provider) => {
    const newSortIndex =
      provider.sortIndex !== undefined ? provider.sortIndex + 1 : undefined;

    const duplicatedProvider: Omit<Provider, "id" | "createdAt"> & {
      providerKey?: string;
      addToLive?: boolean;
    } = {
      name: `${provider.name} copy`,
      settingsConfig: deepClone(provider.settingsConfig),
      websiteUrl: provider.websiteUrl,
      category: provider.category,
      sortIndex: newSortIndex, // 复制原 sortIndex + 1
      meta: provider.meta ? deepClone(provider.meta) : undefined,
      icon: provider.icon,
      iconColor: provider.iconColor,
    };

    if (
      activeApp === "opencode" ||
      activeApp === "openclaw" ||
      activeApp === "hermes"
    ) {
      let liveProviderIds: string[] = [];
      try {
        liveProviderIds =
          activeApp === "opencode"
            ? await queryClient.ensureQueryData({
                queryKey: [
                  "opencodeLiveProviderIds",
                  getManagementTargetKey(managementTarget),
                ],
                queryFn: () =>
                  providersApi.getOpenCodeLiveProviderIds(managementTarget),
              })
            : activeApp === "openclaw"
              ? await queryClient.ensureQueryData({
                  queryKey: openclawKeys.liveProviderIds(
                    getManagementTargetKey(managementTarget),
                  ),
                  queryFn: () =>
                    providersApi.getOpenClawLiveProviderIds(managementTarget),
                })
              : await queryClient.ensureQueryData({
                  queryKey: hermesKeys.liveProviderIds(
                    getManagementTargetKey(managementTarget),
                  ),
                  queryFn: () =>
                    providersApi.getHermesLiveProviderIds(managementTarget),
                });
      } catch (error) {
        console.error(
          "[App] Failed to load live provider IDs for duplication",
          error,
        );
        const errorMessage = extractErrorMessage(error);
        toast.error(
          t("provider.duplicateLiveIdsLoadFailed", {
            defaultValue: "读取配置中的供应商标识失败，请先修复配置后再试",
          }) + (errorMessage ? `: ${errorMessage}` : ""),
        );
        return;
      }
      const existingKeys = Array.from(
        new Set([...Object.keys(providers), ...liveProviderIds]),
      );
      duplicatedProvider.providerKey = generateUniqueProviderCopyKey(
        provider.id,
        existingKeys,
      );
      duplicatedProvider.addToLive = managementTarget.type === "remote";
    }

    if (provider.sortIndex !== undefined) {
      const updates = Object.values(providers)
        .filter(
          (p) =>
            p.sortIndex !== undefined &&
            p.sortIndex >= newSortIndex! &&
            p.id !== provider.id,
        )
        .map((p) => ({
          id: p.id,
          sortIndex: p.sortIndex! + 1,
        }));

      if (updates.length > 0) {
        try {
          await providersApi.updateSortOrder(
            updates,
            activeApp,
            managementTarget,
          );
        } catch (error) {
          console.error("[App] Failed to update sort order", error);
          toast.error(
            t("provider.sortUpdateFailed", {
              defaultValue: "排序更新失败",
            }),
          );
          return; // 如果排序更新失败，不继续添加
        }
      }
    }

    await addProvider(duplicatedProvider);
  };

  const handleOpenTerminal = async (provider: Provider) => {
    try {
      const selectedDir = await settingsApi.pickDirectory();
      if (!selectedDir) {
        return;
      }

      await providersApi.openTerminal(provider.id, activeApp, {
        cwd: selectedDir,
      });
      toast.success(
        t("provider.terminalOpened", {
          defaultValue: "终端已打开",
        }),
      );
    } catch (error) {
      console.error("[App] Failed to open terminal", error);
      const errorMessage = extractErrorMessage(error);
      toast.error(
        t("provider.terminalOpenFailed", {
          defaultValue: "打开终端失败",
        }) + (errorMessage ? `: ${errorMessage}` : ""),
      );
    }
  };

  const handleImportSuccess = async () => {
    try {
      await queryClient.invalidateQueries({
        queryKey: ["providers"],
        refetchType: "all",
      });
      await queryClient.refetchQueries({
        queryKey: ["providers"],
        type: "all",
      });
    } catch (error) {
      console.error("[App] Failed to refresh providers after import", error);
      await refetch();
    }
    if (managementTarget.type === "local") {
      try {
        await providersApi.updateTrayMenu();
      } catch (error) {
        console.error("[App] Failed to refresh tray menu", error);
      }
    }
  };

  const notifyWindowControlError = (error: unknown) => {
    toast.error(
      t("notifications.windowControlFailed", {
        defaultValue: "窗口控制失败：{{error}}",
        error: extractErrorMessage(error),
      }),
    );
  };

  const handleWindowMinimize = async () => {
    try {
      await getCurrentWindow().minimize();
    } catch (error) {
      console.error("[App] Failed to minimize window", error);
      notifyWindowControlError(error);
    }
  };

  const handleWindowToggleMaximize = async () => {
    try {
      const currentWindow = getCurrentWindow();
      await currentWindow.toggleMaximize();
      setIsWindowMaximized(await currentWindow.isMaximized());
    } catch (error) {
      console.error("[App] Failed to toggle maximize", error);
      notifyWindowControlError(error);
    }
  };

  const handleWindowClose = async () => {
    try {
      await getCurrentWindow().close();
    } catch (error) {
      console.error("[App] Failed to close window", error);
      notifyWindowControlError(error);
    }
  };

  const handleOpenSkillsDiscovery = () => {
    setSkillsDiscoverySource("repos");
    setCurrentView("skillsDiscovery");
  };

  const renderContent = () => {
    const content = (() => {
      switch (currentView) {
        case "settings":
          const settingsTarget: ManagementTarget = forceLocalSettings
            ? { type: "local" }
            : managementTarget;
          if (settingsTarget.type === "remote") {
            return (
              <RemoteSettingsPage
                open={true}
                onOpenChange={() => {
                  setForceLocalSettings(false);
                  setCurrentView("providers");
                }}
                onImportSuccess={handleImportSuccess}
                onSettingsSaved={handleRemoteSettingsSaved}
                defaultTab={settingsDefaultTab}
                target={settingsTarget}
                onInteractionBlockedChange={setRemoteSettingsManagementBusy}
              />
            );
          }
          return (
            <SettingsPage
              open={true}
              onOpenChange={() => {
                setForceLocalSettings(false);
                setCurrentView("providers");
              }}
              onImportSuccess={handleImportSuccess}
              defaultTab={settingsDefaultTab}
              target={settingsTarget}
            />
          );
        case "prompts":
          return (
            <PromptPanel
              ref={promptPanelRef}
              open={true}
              onOpenChange={() => setCurrentView("providers")}
              appId={sharedFeatureApp}
              target={managementTarget}
              onInteractionBlockedChange={setPromptManagementBusy}
              onNavigationBlockedChange={setPromptNavigationBusy}
            />
          );
        case "hermesMemory":
          return <HermesMemoryPanel target={managementTarget} />;
        case "remoteServers":
          return (
            <RemoteServersPage
              profiles={remoteProfiles}
              activeProfileId={activeRemoteProfile?.id}
              activeSessionStatus={activeRemoteSessionStatus}
              activeSecret={
                activeRemoteProfile
                  ? remoteSecrets[activeRemoteProfile.id]
                  : undefined
              }
              secrets={remoteSecrets}
              onProfileSaved={handleRemoteProfileSaved}
              onProfileActivated={handleRemoteProfileActivated}
              onProfilesChanged={setRemoteProfiles}
            />
          );
        case "skills":
          return (
            <UnifiedSkillsPanel
              ref={unifiedSkillsPanelRef}
              onOpenDiscovery={handleOpenSkillsDiscovery}
              currentApp={
                sharedFeatureApp === "openclaw" ? "claude" : sharedFeatureApp
              }
              target={managementTarget}
              onInteractionBlockedChange={setSkillsManagementBusy}
              onNavigationBlockedChange={setSkillsNavigationBusy}
              onCheckUpdatesStateChange={setSkillsCheckUpdatesState}
            />
          );
        case "skillsDiscovery":
          return (
            <SkillsPage
              ref={skillsPageRef}
              initialApp={
                sharedFeatureApp === "openclaw" ? "claude" : sharedFeatureApp
              }
              target={managementTarget}
              onSourceChange={setSkillsDiscoverySource}
            />
          );
        case "mcp":
          return (
            <UnifiedMcpPanel
              ref={mcpPanelRef}
              onOpenChange={() => setCurrentView("providers")}
              target={managementTarget}
              onInteractionBlockedChange={setMcpManagementBusy}
            />
          );
        case "agents":
          return (
            <AgentsPanel onOpenChange={() => setCurrentView("providers")} />
          );
        case "universal":
          return (
            <div className="px-6 pt-4">
              <UniversalProviderPanel />
            </div>
          );

        case "sessions":
          return (
            <SessionManagerPage
              key={sharedFeatureApp}
              appId={sharedFeatureApp}
              target={managementTarget}
            />
          );
        case "workspace":
          return <WorkspaceFilesPanel />;
        case "openclawEnv":
          return <EnvPanel target={managementTarget} />;
        case "openclawTools":
          return <ToolsPanel target={managementTarget} />;
        case "openclawAgents":
          return <AgentsDefaultsPanel target={managementTarget} />;
        default:
          return (
            <div className="px-6 flex flex-col flex-1 min-h-0 overflow-hidden">
              <div className="flex-1 overflow-y-auto overflow-x-hidden pb-12 px-1">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={activeApp}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="space-y-4"
                  >
                    <ProviderList
                      providers={providers}
                      currentProviderId={currentProviderId}
                      appId={activeApp}
                      isLoading={isLoading}
                      isProxyRunning={isProxyRunning}
                      isProxyTakeover={
                        isProxyRunning && isCurrentAppRouteActive
                      }
                      loadError={providerLoadError}
                      activeProviderId={activeProviderId}
                      target={managementTarget}
                      onSwitch={switchProvider}
                      onEdit={(provider) => {
                        setEditingProvider(provider);
                      }}
                      onDelete={(provider) =>
                        setConfirmAction({ provider, action: "delete" })
                      }
                      onRemoveFromConfig={
                        activeApp === "opencode" ||
                        activeApp === "openclaw" ||
                        activeApp === "hermes"
                          ? (provider) =>
                              setConfirmAction({ provider, action: "remove" })
                          : undefined
                      }
                      onDisableOmo={
                        activeApp === "opencode" ? handleDisableOmo : undefined
                      }
                      onDisableOmoSlim={
                        activeApp === "opencode"
                          ? handleDisableOmoSlim
                          : undefined
                      }
                      onDuplicate={handleDuplicateProvider}
                      onConfigureUsage={setUsageProvider}
                      onOpenWebsite={handleOpenWebsite}
                      onOpenTerminal={
                        activeApp === "claude" &&
                        managementTarget.type === "local"
                          ? handleOpenTerminal
                          : undefined
                      }
                      onCreate={() => setIsAddOpen(true)}
                      onSetAsDefault={
                        activeApp === "openclaw"
                          ? setAsDefaultModel
                          : managementTarget.type === "local" &&
                              activeApp === "hermes"
                            ? switchProvider
                            : undefined
                      }
                    />
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          );
      }
    })();

    return (
      <AnimatePresence mode="wait">
        <motion.div
          key={`${currentView}:${managementTargetKey}:${managementConnectionRevision}`}
          className="flex-1 min-h-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {content}
        </motion.div>
      </AnimatePresence>
    );
  };

  return (
    <div
      className="flex flex-col h-screen overflow-hidden bg-background text-foreground selection:bg-primary/30 pb-4"
      style={{ overflowX: "hidden", paddingTop: contentTopOffset }}
    >
      {(dragBarHeight > 0 || useAppWindowControls) && (
        <div
          className="fixed top-0 left-0 right-0 z-[70] flex items-center justify-end px-2"
          data-tauri-drag-region
          style={{ WebkitAppRegion: "drag", height: dragBarHeight } as any}
        >
          {useAppWindowControls && (
            <div
              className="flex items-center gap-1"
              style={{ WebkitAppRegion: "no-drag" } as any}
            >
              <Button
                variant="ghost"
                size="icon"
                onClick={() => void handleWindowMinimize()}
                title={t("header.windowMinimize")}
                className="h-7 w-7"
              >
                <Minus className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => void handleWindowToggleMaximize()}
                title={
                  isWindowMaximized
                    ? t("header.windowRestore")
                    : t("header.windowMaximize")
                }
                className="h-7 w-7"
              >
                {isWindowMaximized ? (
                  <Minimize2 className="w-4 h-4" />
                ) : (
                  <Maximize2 className="w-4 h-4" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => void handleWindowClose()}
                title={t("header.windowClose")}
                className="h-7 w-7 hover:bg-red-500/15 hover:text-red-500"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>
      )}
      {showEnvBanner && envConflicts.length > 0 && (
        <EnvWarningBanner
          conflicts={envConflicts}
          onDismiss={() => {
            setShowEnvBanner(false);
            sessionStorage.setItem("env_banner_dismissed", "true");
          }}
          onDeleted={async () => {
            try {
              const allConflicts = await checkAllEnvConflicts();
              const flatConflicts = Object.values(allConflicts).flat();
              setEnvConflicts(flatConflicts);
              if (flatConflicts.length === 0) {
                setShowEnvBanner(false);
              }
            } catch (error) {
              console.error(
                "[App] Failed to re-check conflicts after deletion:",
                error,
              );
            }
          }}
        />
      )}

      <header
        className="fixed z-50 w-full transition-all duration-300 bg-background/80 backdrop-blur-md"
        {...DRAG_REGION_ATTR}
        style={
          {
            ...DRAG_REGION_STYLE,
            top: dragBarHeight,
            height: HEADER_HEIGHT,
          } as any
        }
      >
        <div
          className="flex h-full items-center justify-between gap-2 px-6"
          {...DRAG_REGION_ATTR}
          style={{ ...DRAG_REGION_STYLE } as any}
        >
          <div
            className="flex items-center gap-1"
            style={{ WebkitAppRegion: "no-drag" } as any}
          >
            {currentView !== "providers" ? (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  disabled={managementBusy}
                  onClick={() =>
                    setCurrentView(
                      currentView === "skillsDiscovery"
                        ? "skills"
                        : "providers",
                    )
                  }
                  className={cn(
                    "mr-2 rounded-lg",
                    managementBusy && "disabled:opacity-100",
                  )}
                >
                  <ArrowLeft className="w-4 h-4" />
                </Button>
                <h1 className="text-lg font-semibold">
                  {currentView === "settings" && t("settings.title")}
                  {currentView === "prompts" &&
                    t("prompts.title", {
                      appName: t(`apps.${sharedFeatureApp}`),
                    })}
                  {currentView === "skills" && t("skills.title")}
                  {currentView === "skillsDiscovery" && t("skills.title")}
                  {currentView === "mcp" && t("mcp.unifiedPanel.title")}
                  {currentView === "agents" && t("agents.title")}
                  {currentView === "universal" &&
                    t("universalProvider.title", {
                      defaultValue: "统一供应商",
                    })}
                  {currentView === "sessions" && t("sessionManager.title")}
                  {currentView === "workspace" && t("workspace.title")}
                  {currentView === "openclawEnv" && t("openclaw.env.title")}
                  {currentView === "openclawTools" && t("openclaw.tools.title")}
                  {currentView === "openclawAgents" &&
                    t("openclaw.agents.title")}
                  {currentView === "hermesMemory" && t("hermes.memory.title")}
                  {currentView === "remoteServers" &&
                    t("remote.title", { defaultValue: "远程服务器" })}
                </h1>
                {TARGET_AWARE_VIEWS.has(currentView) && (
                  <ManagementTargetSwitcher
                    profiles={remoteProfiles}
                    activeTargetKey={activeTargetKey}
                    onTargetChange={handleManagementTargetChange}
                    onManageServers={handleOpenRemoteServers}
                    className={cn(
                      "ml-2",
                      managementBusy && "pointer-events-none opacity-50",
                    )}
                    style={{ WebkitAppRegion: "no-drag" } as any}
                  />
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <div className="relative inline-flex items-center">
                  <a
                    href="https://github.com/xiaoY233/cc-switch-remote"
                    target="_blank"
                    rel="noreferrer"
                    className={cn(
                      "text-xl font-semibold transition-colors",
                      isProxyRunning && isCurrentAppRouteActive
                        ? "text-emerald-500 hover:text-emerald-600 dark:text-emerald-400 dark:hover:text-emerald-300"
                        : "text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300",
                    )}
                  >
                    CC Switch Remote
                  </a>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={managementBusy}
                  onClick={() => {
                    setForceLocalSettings(false);
                    setSettingsDefaultTab(
                      managementTarget.type === "remote"
                        ? "environment"
                        : "general",
                    );
                    setCurrentView("settings");
                  }}
                  title={t("common.settings")}
                  className="hover:bg-black/5 dark:hover:bg-white/5"
                >
                  <Settings className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={managementBusy}
                  onClick={handleOpenRemoteServers}
                  title={t("remote.manageServers", {
                    defaultValue: "远程服务器",
                  })}
                  className="hover:bg-black/5 dark:hover:bg-white/5"
                >
                  <Server className="w-4 h-4" />
                </Button>
                <ManagementTargetSwitcher
                  profiles={remoteProfiles}
                  activeTargetKey={activeTargetKey}
                  onTargetChange={handleManagementTargetChange}
                  onManageServers={handleOpenRemoteServers}
                  className={cn(
                    managementBusy && "pointer-events-none opacity-50",
                  )}
                  style={{ WebkitAppRegion: "no-drag" } as any}
                />
                <UpdateBadge
                  onClick={() => {
                    if (managementBusy) return;
                    setForceLocalSettings(true);
                    setSettingsDefaultTab("about");
                    setCurrentView("settings");
                  }}
                />
                {isCurrentAppRouteActive && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      setForceLocalSettings(false);
                      setSettingsDefaultTab("usage");
                      setCurrentView("settings");
                    }}
                    title={t("usage.title", {
                      defaultValue: "使用统计",
                    })}
                    className="hover:bg-black/5 dark:hover:bg-white/5"
                  >
                    <BarChart2 className="w-4 h-4" />
                  </Button>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-1 min-w-0 items-center justify-end gap-1.5">
            {currentView === "providers" &&
              managementTarget.type === "local" &&
              activeApp !== "opencode" &&
              activeApp !== "openclaw" &&
              activeApp !== "hermes" && (
                <div
                  className="flex shrink-0 items-center gap-1.5"
                  style={{ WebkitAppRegion: "no-drag" } as any}
                >
                  {activeApp === "claude-desktop" ? (
                    <ClaudeDesktopRouteToggle />
                  ) : (
                    settingsData?.enableLocalProxy && (
                      <ProxyToggle activeApp={activeApp} />
                    )
                  )}
                  {activeApp !== "claude-desktop" &&
                    settingsData?.enableFailoverToggle && (
                      <FailoverToggle activeApp={activeApp} />
                    )}
                </div>
              )}
            {currentView === "providers" &&
              (settingsData?.showProfileSwitcher ?? true) && (
                <div
                  className="flex shrink-0 items-center"
                  style={{ WebkitAppRegion: "no-drag" } as any}
                >
                  <ProfileSwitcher
                    activeApp={activeApp}
                    target={managementTarget}
                  />
                </div>
              )}
            {currentView === "providers" &&
              managementTarget.type === "remote" &&
              remoteRoutableActiveApp &&
              (showRemoteHomepageRoutingToggle ||
                showRemoteHomepageFailoverToggle) && (
                <div
                  className="flex shrink-0 items-center gap-1.5"
                  style={{ WebkitAppRegion: "no-drag" } as any}
                >
                  {showRemoteHomepageRoutingToggle && (
                    <RemoteAppRoutingToggle
                      activeApp={remoteRoutableActiveApp}
                      target={managementTarget}
                    />
                  )}
                  {showRemoteHomepageFailoverToggle && (
                    <FailoverToggle
                      activeApp={remoteRoutableActiveApp}
                      target={managementTarget}
                    />
                  )}
                </div>
              )}
            <div className="flex flex-1 min-w-0 items-center justify-end overflow-hidden py-4">
              {currentView === "providers" && (
                <AppSwitcher
                  activeApp={activeApp}
                  onSwitch={setActiveApp}
                  visibleApps={visibleApps}
                />
              )}
            </div>
            <div className="flex shrink-0 items-center py-4 pr-2">
              <div
                className="flex shrink-0 items-center gap-1.5"
                style={{ WebkitAppRegion: "no-drag" } as any}
              >
                {currentView === "prompts" && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={promptManagementBusy}
                      onClick={() => promptPanelRef.current?.openImport()}
                      className="hover:bg-black/5 disabled:opacity-100 dark:hover:bg-white/5"
                    >
                      <Download className="w-4 h-4 mr-2" />
                      {t("prompts.import")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={promptManagementBusy}
                      onClick={() => promptPanelRef.current?.openAdd()}
                      className="hover:bg-black/5 disabled:opacity-100 dark:hover:bg-white/5"
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      {t("prompts.add")}
                    </Button>
                  </>
                )}
                {currentView === "mcp" && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={mcpManagementBusy}
                      onClick={() => mcpPanelRef.current?.openImport()}
                      className="hover:bg-black/5 disabled:opacity-100 dark:hover:bg-white/5"
                    >
                      <Download className="w-4 h-4 mr-2" />
                      {t("mcp.importExisting")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={mcpManagementBusy}
                      onClick={() => mcpPanelRef.current?.openAdd()}
                      className="hover:bg-black/5 disabled:opacity-100 dark:hover:bg-white/5"
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      {t("mcp.addMcp")}
                    </Button>
                  </>
                )}
                {currentView === "skills" && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={
                        skillsManagementBusy ||
                        skillsCheckUpdatesState.isChecking ||
                        !skillsCheckUpdatesState.hasSkills
                      }
                      onClick={() =>
                        unifiedSkillsPanelRef.current?.checkUpdates()
                      }
                      className={cn(
                        "hover:bg-black/5 dark:hover:bg-white/5",
                        skillsManagementBusy && "disabled:opacity-100",
                      )}
                    >
                      {skillsCheckUpdatesState.isChecking ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <RefreshCw className="w-4 h-4 mr-2" />
                      )}
                      {skillsCheckUpdatesState.isChecking
                        ? t("skills.checkingUpdates")
                        : t("skills.checkUpdates")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={skillsManagementBusy}
                      onClick={() =>
                        unifiedSkillsPanelRef.current?.openRestoreFromBackup()
                      }
                      className="hover:bg-black/5 disabled:opacity-100 dark:hover:bg-white/5"
                    >
                      <History className="w-4 h-4 mr-2" />
                      {t("skills.restoreFromBackup.button")}
                    </Button>
                    {managementTarget.type === "local" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={skillsManagementBusy}
                        onClick={() =>
                          unifiedSkillsPanelRef.current?.openInstallFromZip()
                        }
                        className="hover:bg-black/5 disabled:opacity-100 dark:hover:bg-white/5"
                      >
                        <FolderArchive className="w-4 h-4 mr-2" />
                        {t("skills.installFromZip.button")}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={skillsManagementBusy}
                      onClick={() =>
                        unifiedSkillsPanelRef.current?.openImport()
                      }
                      className="relative hover:bg-black/5 disabled:opacity-100 dark:hover:bg-white/5"
                      title={
                        hasUnmanagedSkills
                          ? t("skills.unmanagedAvailable")
                          : undefined
                      }
                    >
                      <Download className="w-4 h-4 mr-2" />
                      {t("skills.import")}
                      {hasUnmanagedSkills && (
                        <span
                          className="absolute top-1 right-1 h-2 w-2 rounded-full bg-green-500"
                          aria-hidden="true"
                        />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={skillsManagementBusy}
                      onClick={() =>
                        unifiedSkillsPanelRef.current?.openDiscovery()
                      }
                      className="hover:bg-black/5 disabled:opacity-100 dark:hover:bg-white/5"
                    >
                      <Search className="w-4 h-4 mr-2" />
                      {t("skills.discover")}
                    </Button>
                  </>
                )}
                {currentView === "skillsDiscovery" && (
                  <>
                    {getSkillsPageHeaderActions(skillsDiscoverySource).map(
                      ({ key, labelKey, Icon, execute }) => (
                        <Button
                          key={key}
                          variant="ghost"
                          size="sm"
                          onClick={() => execute(skillsPageRef.current)}
                          className="hover:bg-black/5 dark:hover:bg-white/5"
                        >
                          <Icon className="w-4 h-4 mr-2" />
                          {t(labelKey)}
                        </Button>
                      ),
                    )}
                  </>
                )}
                {currentView === "providers" && (
                  <>
                    <div className="flex items-center gap-1 p-1 bg-muted rounded-xl">
                      <AnimatePresence mode="wait">
                        <motion.div
                          key={
                            activeApp === "openclaw"
                              ? "openclaw"
                              : activeApp === "hermes"
                                ? "hermes"
                                : activeApp === "grokbuild"
                                  ? "grokbuild"
                                  : "default"
                          }
                          className="flex items-center gap-1"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.15 }}
                        >
                          {activeApp === "hermes" ? (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setCurrentView("skills")}
                                className="text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 w-8 px-2"
                                title={t("skills.manage")}
                              >
                                <Wrench className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setCurrentView("hermesMemory")}
                                className="text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 w-8 px-2"
                                title={t("hermes.memory.title")}
                              >
                                <Brain className="w-4 h-4" />
                              </Button>
                              {!isRemoteTarget && (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => void openHermesWebUI()}
                                    className="text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 w-8 px-2"
                                    title={t("hermes.webui.open")}
                                  >
                                    <LayoutDashboard className="w-4 h-4" />
                                  </Button>
                                </>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setCurrentView("mcp")}
                                className="text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 w-8 px-2"
                                title={t("mcp.title")}
                              >
                                <McpIcon size={16} />
                              </Button>
                            </>
                          ) : activeApp === "openclaw" ? (
                            <>
                              {!isRemoteTarget && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setCurrentView("workspace")}
                                  className="text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 w-8 px-2"
                                  title={t("workspace.manage")}
                                >
                                  <FolderOpen className="w-4 h-4" />
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setCurrentView("openclawEnv")}
                                className="text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 w-8 px-2"
                                title={t("openclaw.env.title")}
                              >
                                <KeyRound className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setCurrentView("openclawTools")}
                                className="text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 w-8 px-2"
                                title={t("openclaw.tools.title")}
                              >
                                <Shield className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setCurrentView("openclawAgents")}
                                className="text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 w-8 px-2"
                                title={t("openclaw.agents.title")}
                              >
                                <Cpu className="w-4 h-4" />
                              </Button>
                              {canOpenSessions && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setCurrentView("sessions")}
                                  className="text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 w-8 px-2"
                                  title={t("sessionManager.title")}
                                >
                                  <History className="w-4 h-4" />
                                </Button>
                              )}
                            </>
                          ) : (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setCurrentView("skills")}
                                className={cn(
                                  "text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5",
                                  "transition-all duration-200 ease-in-out overflow-hidden",
                                  hasSkillsSupport
                                    ? "opacity-100 w-8 scale-100 px-2"
                                    : "opacity-0 w-0 scale-75 pointer-events-none px-0 -ml-1",
                                )}
                                title={t("skills.manage")}
                              >
                                <Wrench className="flex-shrink-0 w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setCurrentView("prompts")}
                                className="text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 w-8 px-2"
                                title={t("prompts.manage")}
                              >
                                <Book className="w-4 h-4" />
                              </Button>
                              {canOpenSessions && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setCurrentView("sessions")}
                                  className={cn(
                                    "text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5",
                                    "transition-all duration-200 ease-in-out overflow-hidden",
                                    hasSessionSupport
                                      ? "opacity-100 w-8 scale-100 px-2"
                                      : "opacity-0 w-0 scale-75 pointer-events-none px-0 -ml-1",
                                  )}
                                  title={t("sessionManager.title")}
                                >
                                  <History className="flex-shrink-0 w-4 h-4" />
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setCurrentView("mcp")}
                                className="text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 w-8 px-2"
                                title={t("mcp.title")}
                              >
                                <McpIcon size={16} />
                              </Button>
                            </>
                          )}
                        </motion.div>
                      </AnimatePresence>
                    </div>

                    <Button
                      onClick={() => setIsAddOpen(true)}
                      size="icon"
                      className={`ml-2 ${addActionButtonClass}`}
                    >
                      <Plus className="w-5 h-5" />
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 min-h-0 flex flex-col overflow-y-auto animate-fade-in">
        {isOpenClawView && openclawHealthWarnings.length > 0 && (
          <OpenClawHealthBanner warnings={openclawHealthWarnings} />
        )}
        {renderContent()}
      </main>

      <AddProviderDialog
        open={isAddOpen}
        onOpenChange={setIsAddOpen}
        appId={activeApp}
        target={managementTarget}
        onSubmit={addProvider}
      />

      <EditProviderDialog
        open={Boolean(editingProvider)}
        provider={effectiveEditingProvider}
        onOpenChange={(open) => {
          if (!open) {
            setEditingProvider(null);
          }
        }}
        onSubmit={handleEditProvider}
        appId={activeApp}
        target={managementTarget}
        isProxyTakeover={isCurrentAppRouteActive}
      />

      {effectiveUsageProvider && (
        <UsageScriptModal
          key={effectiveUsageProvider.id}
          provider={effectiveUsageProvider}
          appId={activeApp}
          isOpen={Boolean(usageProvider)}
          target={managementTarget}
          onClose={() => setUsageProvider(null)}
          onSave={(script) => {
            if (usageProvider) {
              void saveUsageScript(usageProvider, script);
            }
          }}
        />
      )}

      <ConfirmDialog
        isOpen={Boolean(confirmAction)}
        title={
          confirmAction?.action === "remove"
            ? t("confirm.removeProvider")
            : t("confirm.deleteProvider")
        }
        message={
          confirmAction
            ? confirmAction.action === "remove"
              ? t("confirm.removeProviderMessage", {
                  name: confirmAction.provider.name,
                })
              : t("confirm.deleteProviderMessage", {
                  name: confirmAction.provider.name,
                })
            : ""
        }
        onConfirm={() => void handleConfirmAction()}
        onCancel={() => setConfirmAction(null)}
      />

      <ConfirmDialog
        isOpen={launchDashboardOpen}
        title={t("hermes.webui.launchConfirmTitle")}
        message={t("hermes.webui.launchConfirmMessage")}
        confirmText={t("hermes.webui.launchConfirmAction")}
        variant="info"
        onConfirm={() => {
          setLaunchDashboardOpen(false);
          void (async () => {
            try {
              await hermesApi.launchDashboard();
              toast.success(t("hermes.webui.launching"));
            } catch (error) {
              toast.error(t("hermes.webui.launchFailed"), {
                description: extractErrorMessage(error) || undefined,
              });
            }
          })();
        }}
        onCancel={() => setLaunchDashboardOpen(false)}
      />

      <DeepLinkImportDialog />
      <FirstRunNoticeDialog />
      <RemoteSessionPasswordDialog
        profile={passwordPromptProfile}
        onCancel={() => setPasswordPromptProfile(null)}
        onSubmit={handleSessionPasswordSubmit}
      />
    </div>
  );
}

export default App;
