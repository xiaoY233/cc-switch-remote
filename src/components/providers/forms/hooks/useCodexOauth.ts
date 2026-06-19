import { useManagedAuth } from "./useManagedAuth";
import type { ManagementTarget } from "@/lib/api";

/**
 * Codex OAuth (ChatGPT Plus/Pro) 认证 hook
 *
 * 复用通用 useManagedAuth，仅指定 provider 为 "codex_oauth"
 */
export function useCodexOauth(target?: ManagementTarget) {
  return useManagedAuth("codex_oauth", undefined, target);
}
