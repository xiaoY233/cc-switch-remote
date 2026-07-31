import type { AppId } from "@/lib/api";

export const REMOTE_ROUTABLE_APPS = [
  { id: "claude", label: "Claude" },
  { id: "codex", label: "Codex" },
  { id: "gemini", label: "Gemini" },
  { id: "grokbuild", label: "Grok Build" },
] as const;

export type RemoteRoutableApp = (typeof REMOTE_ROUTABLE_APPS)[number]["id"];

export function isRemoteRoutableApp(app: AppId): app is RemoteRoutableApp {
  return REMOTE_ROUTABLE_APPS.some(({ id }) => id === app);
}
