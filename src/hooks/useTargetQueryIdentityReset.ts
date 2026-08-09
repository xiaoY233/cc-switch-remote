import { useEffect, useRef } from "react";
import {
  useQueryClient,
  type Query,
  type QueryClient,
} from "@tanstack/react-query";
import type { ManagementTarget } from "@/lib/api/remote";

type TargetQueryDomain =
  | "all"
  | "mcp"
  | "skills"
  | "opencode-runtime-models"
  | "quota";

const TARGET_SCOPED_SKILLS_COLLECTIONS = new Set([
  "installed",
  "backups",
  "discoverable",
  "unmanaged",
  "repos",
  "updates",
]);

const observedTargets = new WeakMap<
  QueryClient,
  Map<string, ManagementTarget>
>();

const matchesTargetQuery = (
  query: Query,
  domain: TargetQueryDomain,
  targetKey: string,
) => {
  if (domain === "all") {
    return query.queryKey.includes(targetKey);
  }
  if (domain === "quota") {
    return (
      ["subscription", "codex_oauth", "xai_oauth", "copilot"].includes(
        String(query.queryKey[0]),
      ) &&
      query.queryKey[1] === "quota" &&
      query.queryKey[2] === targetKey
    );
  }
  if (domain === "opencode-runtime-models") {
    return (
      query.queryKey[0] === "opencode" &&
      query.queryKey[1] === "runtime-models" &&
      query.queryKey[2] === targetKey
    );
  }
  if (query.queryKey[0] !== domain) return false;
  if (domain === "skills") {
    return (
      TARGET_SCOPED_SKILLS_COLLECTIONS.has(String(query.queryKey[1])) &&
      query.queryKey[2] === targetKey
    );
  }
  return query.queryKey[1] === "all" && query.queryKey[2] === targetKey;
};

export const hasSameConnectionIdentity = (
  previous: ManagementTarget,
  current: ManagementTarget,
) => {
  if (previous.type === "local" || current.type === "local") {
    return previous.type === current.type;
  }

  const previousAuth = previous.profile.authMethod;
  const currentAuth = current.profile.authMethod;
  return (
    previous.profile.id === current.profile.id &&
    previous.profile.host === current.profile.host &&
    previous.profile.port === current.profile.port &&
    previous.profile.username === current.profile.username &&
    previous.profile.helperPath === current.profile.helperPath &&
    previousAuth.type === currentAuth.type &&
    (previousAuth.type !== "keyFile" ||
      (currentAuth.type === "keyFile" &&
        previousAuth.path === currentAuth.path)) &&
    previous.secret?.password === current.secret?.password
  );
};

/**
 * A remote profile ID is the cache namespace, but its host or credentials can
 * change without changing that ID. Reset matching queries when the selected
 * connection identity changes so active observers refetch through the new
 * adapter and cancelled responses from the previous connection cannot
 * repopulate the cache. Equivalent local targets and equivalent remote object
 * copies keep their existing upstream-compatible cache behavior.
 */
export function useTargetQueryIdentityReset(
  domain: TargetQueryDomain,
  target: ManagementTarget,
  targetKey: string,
) {
  const queryClient = useQueryClient();
  const connectionRef = useRef({ target, revision: 0 });
  if (!hasSameConnectionIdentity(connectionRef.current.target, target)) {
    connectionRef.current = {
      target,
      revision: connectionRef.current.revision + 1,
    };
  } else {
    connectionRef.current.target = target;
  }

  useEffect(() => {
    if (target.type !== "remote") return;

    let clientTargets = observedTargets.get(queryClient);
    if (!clientTargets) {
      clientTargets = new Map();
      observedTargets.set(queryClient, clientTargets);
    }

    const observationKey = `${domain}:${targetKey}`;
    const previousTarget = clientTargets.get(observationKey);
    clientTargets.set(observationKey, target);

    if (previousTarget && !hasSameConnectionIdentity(previousTarget, target)) {
      void queryClient.resetQueries({
        predicate: (query) => matchesTargetQuery(query, domain, targetKey),
      });
    }
  }, [domain, queryClient, target, targetKey]);

  return connectionRef.current.revision;
}
