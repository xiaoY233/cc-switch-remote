import type { AppId } from "@/lib/api/types";
import type {
  HermesMemoryKind,
  HermesMemoryLimits,
  McpServer,
  OpenClawDefaultModel,
  Provider,
  SessionMessage,
  SessionMeta,
  Settings,
} from "@/types";
import type { RemoteHostProfile } from "@/lib/api/remote";
import { deepClone } from "@/utils/deepClone";

type ProvidersByApp = Record<AppId, Record<string, Provider>>;
type CurrentProviderState = Record<AppId, string>;
type McpConfigState = Record<AppId, Record<string, McpServer>>;
type LiveProviderIdsByApp = Record<
  "opencode" | "openclaw" | "hermes",
  string[]
>;

const createDefaultProviders = (): ProvidersByApp => ({
  claude: {
    "claude-1": {
      id: "claude-1",
      name: "Claude Default",
      settingsConfig: {},
      category: "official",
      sortIndex: 0,
      createdAt: Date.now(),
    },
    "claude-2": {
      id: "claude-2",
      name: "Claude Custom",
      settingsConfig: {},
      category: "custom",
      sortIndex: 1,
      createdAt: Date.now() + 1,
    },
  },
  "claude-desktop": {},
  codex: {
    "codex-1": {
      id: "codex-1",
      name: "Codex Default",
      settingsConfig: {},
      category: "official",
      sortIndex: 0,
      createdAt: Date.now(),
    },
    "codex-2": {
      id: "codex-2",
      name: "Codex Secondary",
      settingsConfig: {},
      category: "custom",
      sortIndex: 1,
      createdAt: Date.now() + 1,
    },
  },
  gemini: {
    "gemini-1": {
      id: "gemini-1",
      name: "Gemini Default",
      settingsConfig: {
        env: {
          GEMINI_API_KEY: "test-key",
          GOOGLE_GEMINI_BASE_URL: "https://generativelanguage.googleapis.com",
        },
      },
      category: "official",
      sortIndex: 0,
      createdAt: Date.now(),
    },
  },
  grokbuild: {},
  opencode: {},
  openclaw: {},
  hermes: {},
  pi: {},
});

const createDefaultCurrent = (): CurrentProviderState => ({
  claude: "claude-1",
  "claude-desktop": "",
  codex: "codex-1",
  gemini: "gemini-1",
  grokbuild: "",
  opencode: "",
  openclaw: "",
  hermes: "",
  pi: "",
});

let providers = createDefaultProviders();
let current = createDefaultCurrent();
let liveProviderIds: LiveProviderIdsByApp = {
  opencode: [],
  openclaw: [],
  hermes: [],
};
const createDefaultSettings = (): Settings => ({
  showInTray: true,
  minimizeToTrayOnClose: true,
  enableClaudePluginIntegration: false,
  claudeConfigDir: "/default/claude",
  codexConfigDir: "/default/codex",
  language: "zh",
});

let settingsState: Settings = createDefaultSettings();
let remoteSettingsState: Settings = createDefaultSettings();
let appConfigDirOverride: string | null = null;
let remoteProfilesState: RemoteHostProfile[] = [];
let lastRemoteSaveSecretState: { password?: string } | null = null;
let remoteProviderStateError: string | null = null;
let remoteOpenClawDefaultModelState: OpenClawDefaultModel | null = null;
const sessionMessageKey = (providerId: string, sourcePath: string) =>
  `${providerId}:${sourcePath}`;

const createDefaultSessions = (): SessionMeta[] => {
  const now = Date.now();
  return [
    {
      providerId: "codex",
      sessionId: "codex-session-1",
      title: "Codex Session One",
      summary: "Codex summary",
      projectDir: "/mock/codex",
      createdAt: now - 2000,
      lastActiveAt: now - 1000,
      sourcePath: "/mock/codex/session-1.jsonl",
      resumeCommand: "codex resume codex-session-1",
    },
    {
      providerId: "claude",
      sessionId: "claude-session-1",
      title: "Claude Session One",
      summary: "Claude summary",
      projectDir: "/mock/claude",
      createdAt: now - 4000,
      lastActiveAt: now - 3000,
      sourcePath: "/mock/claude/session-1.jsonl",
      resumeCommand: "claude --resume claude-session-1",
    },
  ];
};

const createDefaultSessionMessages = (): Record<string, SessionMessage[]> => ({
  [sessionMessageKey("codex", "/mock/codex/session-1.jsonl")]: [
    {
      role: "user",
      content: "First codex message",
      ts: Date.now() - 1000,
    },
  ],
  [sessionMessageKey("claude", "/mock/claude/session-1.jsonl")]: [
    {
      role: "user",
      content: "First claude message",
      ts: Date.now() - 3000,
    },
  ],
});

let sessionsState = createDefaultSessions();
let sessionMessagesState = createDefaultSessionMessages();
let remoteSessionsState: SessionMeta[] = [];
let remoteSessionMessagesState: Record<string, SessionMessage[]> = {};
let remoteHermesMemoryState: Record<HermesMemoryKind, string> = {
  memory: "",
  user: "",
};
let remoteHermesMemoryLimitsState: HermesMemoryLimits = {
  memory: 2200,
  user: 1375,
  memoryEnabled: true,
  userEnabled: true,
};
let mcpConfigs: McpConfigState = {
  claude: {
    sample: {
      id: "sample",
      name: "Sample Claude Server",
      enabled: true,
      apps: {
        claude: true,
        codex: false,
        gemini: false,
        opencode: false,
        openclaw: false,
        hermes: false,
      },
      server: {
        type: "stdio",
        command: "claude-server",
      },
    },
  },
  "claude-desktop": {},
  codex: {
    httpServer: {
      id: "httpServer",
      name: "HTTP Codex Server",
      enabled: false,
      apps: {
        claude: false,
        codex: true,
        gemini: false,
        opencode: false,
        openclaw: false,
        hermes: false,
      },
      server: {
        type: "http",
        url: "http://localhost:3000",
      },
    },
  },
  gemini: {},
  grokbuild: {},
  opencode: {},
  openclaw: {},
  hermes: {},
  pi: {},
};

const cloneProviders = (value: ProvidersByApp) =>
  deepClone(value) as ProvidersByApp;

export const resetProviderState = () => {
  providers = createDefaultProviders();
  current = createDefaultCurrent();
  liveProviderIds = {
    opencode: [],
    openclaw: [],
    hermes: [],
  };
  sessionsState = createDefaultSessions();
  sessionMessagesState = createDefaultSessionMessages();
  remoteSessionsState = [];
  remoteSessionMessagesState = {};
  remoteHermesMemoryState = {
    memory: "",
    user: "",
  };
  remoteHermesMemoryLimitsState = {
    memory: 2200,
    user: 1375,
    memoryEnabled: true,
    userEnabled: true,
  };
  settingsState = createDefaultSettings();
  remoteSettingsState = createDefaultSettings();
  appConfigDirOverride = null;
  remoteProfilesState = [];
  lastRemoteSaveSecretState = null;
  remoteProviderStateError = null;
  remoteOpenClawDefaultModelState = null;
  mcpConfigs = {
    claude: {
      sample: {
        id: "sample",
        name: "Sample Claude Server",
        enabled: true,
        apps: {
          claude: true,
          codex: false,
          gemini: false,
          opencode: false,
          openclaw: false,
          hermes: false,
        },
        server: {
          type: "stdio",
          command: "claude-server",
        },
      },
    },
    "claude-desktop": {},
    codex: {
      httpServer: {
        id: "httpServer",
        name: "HTTP Codex Server",
        enabled: false,
        apps: {
          claude: false,
          codex: true,
          gemini: false,
          opencode: false,
          openclaw: false,
          hermes: false,
        },
        server: {
          type: "http",
          url: "http://localhost:3000",
        },
      },
    },
    gemini: {},
    grokbuild: {},
    opencode: {},
    openclaw: {},
    hermes: {},
    pi: {},
  };
};

export const getProviders = (appType: AppId) =>
  cloneProviders(providers)[appType] ?? {};

export const getCurrentProviderId = (appType: AppId) => current[appType] ?? "";

export const getLiveProviderIds = (
  appType: "opencode" | "openclaw" | "hermes",
) => [...liveProviderIds[appType]];

export const setLiveProviderIds = (
  appType: "opencode" | "openclaw" | "hermes",
  ids: string[],
) => {
  liveProviderIds[appType] = [...ids];
};

export const setCurrentProviderId = (appType: AppId, providerId: string) => {
  current[appType] = providerId;
};

export const updateProviders = (
  appType: AppId,
  data: Record<string, Provider>,
) => {
  providers[appType] = cloneProviders({ [appType]: data } as ProvidersByApp)[
    appType
  ];
};

export const setProviders = (
  appType: AppId,
  data: Record<string, Provider>,
) => {
  providers[appType] = deepClone(data) as Record<string, Provider>;
};

export const addProvider = (appType: AppId, provider: Provider) => {
  providers[appType] = providers[appType] ?? {};
  providers[appType][provider.id] = provider;
};

export const updateProvider = (appType: AppId, provider: Provider) => {
  if (!providers[appType]) return;
  providers[appType][provider.id] = {
    ...providers[appType][provider.id],
    ...provider,
  };
};

export const deleteProvider = (appType: AppId, providerId: string) => {
  if (!providers[appType]) return;
  delete providers[appType][providerId];
  if (current[appType] === providerId) {
    const fallback = Object.keys(providers[appType])[0] ?? "";
    current[appType] = fallback;
  }
};

export const updateSortOrder = (
  appType: AppId,
  updates: { id: string; sortIndex: number }[],
) => {
  if (!providers[appType]) return;
  updates.forEach(({ id, sortIndex }) => {
    const provider = providers[appType][id];
    if (provider) {
      providers[appType][id] = { ...provider, sortIndex };
    }
  });
};

export const listProviders = (appType: AppId) =>
  deepClone(providers[appType] ?? {}) as Record<string, Provider>;

export const getRemoteProfiles = () =>
  deepClone(remoteProfilesState) as RemoteHostProfile[];

export const setRemoteProfiles = (profiles: RemoteHostProfile[]) => {
  remoteProfilesState = deepClone(profiles) as RemoteHostProfile[];
};

export const setLastRemoteSaveSecret = (
  secret: { password?: string } | null,
) => {
  lastRemoteSaveSecretState = secret ? deepClone(secret) : null;
};

export const getLastRemoteSaveSecret = () =>
  lastRemoteSaveSecretState ? deepClone(lastRemoteSaveSecretState) : null;

export const getRemoteProviderStateError = () => remoteProviderStateError;

export const setRemoteProviderStateError = (error: string | null) => {
  remoteProviderStateError = error;
};

export const getRemoteOpenClawDefaultModel = () =>
  remoteOpenClawDefaultModelState
    ? (deepClone(remoteOpenClawDefaultModelState) as OpenClawDefaultModel)
    : null;

export const setRemoteOpenClawDefaultModel = (
  model: OpenClawDefaultModel | null,
) => {
  remoteOpenClawDefaultModelState = model
    ? (deepClone(model) as OpenClawDefaultModel)
    : null;
};

export const getSettings = () => deepClone(settingsState) as Settings;

export const setSettings = (data: Partial<Settings>) => {
  settingsState = { ...settingsState, ...data };
};

export const getRemoteSettings = () =>
  deepClone(remoteSettingsState) as Settings;

export const setRemoteSettings = (data: Partial<Settings>) => {
  remoteSettingsState = { ...remoteSettingsState, ...data };
};

export const getAppConfigDirOverride = () => appConfigDirOverride;

export const setAppConfigDirOverrideState = (value: string | null) => {
  appConfigDirOverride = value;
};

export const getMcpConfig = (appType: AppId) => {
  const servers = deepClone(mcpConfigs[appType] ?? {}) as Record<
    string,
    McpServer
  >;
  return {
    configPath: `/mock/${appType}.mcp.json`,
    servers,
  };
};

export const setMcpConfig = (
  appType: AppId,
  value: Record<string, McpServer>,
) => {
  mcpConfigs[appType] = deepClone(value) as Record<string, McpServer>;
};

export const setMcpServerEnabled = (
  appType: AppId,
  id: string,
  enabled: boolean,
) => {
  if (!mcpConfigs[appType]?.[id]) return;
  mcpConfigs[appType][id] = {
    ...mcpConfigs[appType][id],
    enabled,
  };
};

export const upsertMcpServer = (
  appType: AppId,
  id: string,
  server: McpServer,
) => {
  if (!mcpConfigs[appType]) {
    mcpConfigs[appType] = {};
  }
  mcpConfigs[appType][id] = deepClone(server) as McpServer;
};

export const deleteMcpServer = (appType: AppId, id: string) => {
  if (!mcpConfigs[appType]) return;
  delete mcpConfigs[appType][id];
};

export const listSessions = () => deepClone(sessionsState) as SessionMeta[];

export const listRemoteSessions = () =>
  deepClone(remoteSessionsState) as SessionMeta[];

export const getSessionMessages = (providerId: string, sourcePath: string) =>
  deepClone(
    sessionMessagesState[sessionMessageKey(providerId, sourcePath)] ?? [],
  ) as SessionMessage[];

export const getRemoteSessionMessages = (
  providerId: string,
  sourcePath: string,
) =>
  deepClone(
    remoteSessionMessagesState[sessionMessageKey(providerId, sourcePath)] ?? [],
  ) as SessionMessage[];

export const deleteSession = (
  providerId: string,
  sessionId: string,
  sourcePath: string,
) => {
  sessionsState = sessionsState.filter(
    (session) =>
      !(
        session.providerId === providerId &&
        session.sessionId === sessionId &&
        session.sourcePath === sourcePath
      ),
  );
  delete sessionMessagesState[sessionMessageKey(providerId, sourcePath)];
  return true;
};

export const deleteRemoteSession = (
  providerId: string,
  sessionId: string,
  sourcePath: string,
) => {
  remoteSessionsState = remoteSessionsState.filter(
    (session) =>
      !(
        session.providerId === providerId &&
        session.sessionId === sessionId &&
        session.sourcePath === sourcePath
      ),
  );
  delete remoteSessionMessagesState[sessionMessageKey(providerId, sourcePath)];
  return true;
};

export const setSessionFixtures = (
  sessions: SessionMeta[],
  messages: Record<string, SessionMessage[]>,
) => {
  sessionsState = deepClone(sessions) as SessionMeta[];
  sessionMessagesState = deepClone(messages) as Record<
    string,
    SessionMessage[]
  >;
};

export const setRemoteSessionFixtures = (
  sessions: SessionMeta[],
  messages: Record<string, SessionMessage[]>,
) => {
  remoteSessionsState = deepClone(sessions) as SessionMeta[];
  remoteSessionMessagesState = deepClone(messages) as Record<
    string,
    SessionMessage[]
  >;
};

export const getRemoteHermesMemory = (kind: HermesMemoryKind) =>
  remoteHermesMemoryState[kind] ?? "";

export const setRemoteHermesMemory = (
  kind: HermesMemoryKind,
  content: string,
) => {
  remoteHermesMemoryState[kind] = content;
};

export const getRemoteHermesMemoryLimits = () =>
  deepClone(remoteHermesMemoryLimitsState) as HermesMemoryLimits;

export const setRemoteHermesMemoryEnabled = (
  kind: HermesMemoryKind,
  enabled: boolean,
) => {
  remoteHermesMemoryLimitsState =
    kind === "memory"
      ? { ...remoteHermesMemoryLimitsState, memoryEnabled: enabled }
      : { ...remoteHermesMemoryLimitsState, userEnabled: enabled };
};

export const setRemoteHermesMemoryFixtures = (
  memory: Partial<Record<HermesMemoryKind, string>>,
  limits?: Partial<HermesMemoryLimits>,
) => {
  remoteHermesMemoryState = {
    memory: memory.memory ?? remoteHermesMemoryState.memory,
    user: memory.user ?? remoteHermesMemoryState.user,
  };
  remoteHermesMemoryLimitsState = {
    ...remoteHermesMemoryLimitsState,
    ...limits,
  };
};
