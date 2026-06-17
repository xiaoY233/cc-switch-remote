import type { Settings } from "@/types";

type RoutingConfirmationSettings = Pick<
  Settings,
  "proxyConfirmed" | "failoverConfirmed"
>;

export function shouldConfirmRemoteRoutingStart(
  settings: Partial<RoutingConfirmationSettings> | null | undefined,
): boolean {
  return !(settings?.proxyConfirmed ?? false);
}

export function shouldConfirmRemoteFailoverToggle(
  settings: Partial<RoutingConfirmationSettings> | null | undefined,
  checked: boolean,
): boolean {
  return checked && !(settings?.failoverConfirmed ?? false);
}
