import { useManagedAuth } from "./useManagedAuth";
import type { ManagementTarget } from "@/lib/api";

/** xAI OAuth device-code authentication hook. */
export function useXaiOauth(target?: ManagementTarget) {
  return useManagedAuth("xai_oauth", undefined, target);
}
