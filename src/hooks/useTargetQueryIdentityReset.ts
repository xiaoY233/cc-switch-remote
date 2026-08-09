import { useEffect } from "react";
import {
  useQueryClient,
  type Query,
  type QueryClient,
} from "@tanstack/react-query";
import type { ManagementTarget } from "@/lib/api/remote";

type TargetQueryDomain = "mcp" | "skills" | "opencode-runtime-models";

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

/**
 * A remote profile ID is the cache namespace, but its host or credentials can
 * change without changing that ID. Reset matching queries when the selected
 * target object changes so active observers refetch through the new adapter and
 * cancelled responses from the previous connection cannot repopulate the cache.
 */
export function useTargetQueryIdentityReset(
  domain: TargetQueryDomain,
  target: ManagementTarget,
  targetKey: string,
) {
  const queryClient = useQueryClient();

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

    if (previousTarget && previousTarget !== target) {
      void queryClient.resetQueries({
        predicate: (query) => matchesTargetQuery(query, domain, targetKey),
      });
    }
  }, [domain, queryClient, target, targetKey]);
}
