import { useCallback, useEffect, useRef } from "react";

import { useTargetQueryIdentityReset } from "@/hooks/useTargetQueryIdentityReset";
import type { ManagementTarget } from "@/lib/api";
import { getManagementTargetKey } from "@/lib/managementTarget";

interface AsyncGenerationToken {
  revision: number;
  mounted: boolean;
}

/**
 * Guards handwritten async state that is not owned by React Query. Captured
 * work becomes stale synchronously when the selected connection identity
 * changes, and also when its component unmounts.
 */
export function useTargetAsyncGeneration(target: ManagementTarget) {
  const targetKey = getManagementTargetKey(target);
  const revision = useTargetQueryIdentityReset("all", target, targetKey);
  const currentRef = useRef<AsyncGenerationToken>({
    revision,
    mounted: true,
  });
  if (currentRef.current.revision !== revision) {
    currentRef.current.mounted = false;
    currentRef.current = { revision, mounted: true };
  }

  useEffect(() => {
    const token = currentRef.current;
    token.mounted = true;
    return () => {
      token.mounted = false;
    };
  }, [revision]);

  const capture = useCallback(() => currentRef.current, []);
  const isCurrent = useCallback(
    (token: AsyncGenerationToken) =>
      token === currentRef.current && token.mounted,
    [],
  );

  return { capture, isCurrent, revision };
}
