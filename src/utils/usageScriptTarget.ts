import type { ManagementTarget } from "@/lib/api";

export function shouldPersistUsageConfirmation(
  target: ManagementTarget,
): boolean {
  return target.type === "local";
}
