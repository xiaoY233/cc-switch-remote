import { invoke } from "@tauri-apps/api/core";
import type { OmoLocalFileData } from "@/types/omo";
import { remoteApi, type ManagementTarget } from "./remote";

const LOCAL_TARGET: ManagementTarget = { type: "local" };

export const omoApi = {
  readLocalFile: (
    target: ManagementTarget = LOCAL_TARGET,
  ): Promise<OmoLocalFileData> =>
    target.type === "remote"
      ? remoteApi.readOmoLocalFile(target.profile, "omo", target.secret)
      : invoke("read_omo_local_file"),
  getCurrentOmoProviderId: (
    target: ManagementTarget = LOCAL_TARGET,
  ): Promise<string> =>
    target.type === "remote"
      ? remoteApi.getCurrentOmoProviderId(target.profile, "omo", target.secret)
      : invoke("get_current_omo_provider_id"),
  disableCurrentOmo: (
    target: ManagementTarget = LOCAL_TARGET,
  ): Promise<void> =>
    target.type === "remote"
      ? remoteApi.disableCurrentOmo(target.profile, "omo", target.secret)
      : invoke("disable_current_omo"),
};

export const omoSlimApi = {
  readLocalFile: (
    target: ManagementTarget = LOCAL_TARGET,
  ): Promise<OmoLocalFileData> =>
    target.type === "remote"
      ? remoteApi.readOmoLocalFile(target.profile, "omo-slim", target.secret)
      : invoke("read_omo_slim_local_file"),
  getCurrentProviderId: (
    target: ManagementTarget = LOCAL_TARGET,
  ): Promise<string> =>
    target.type === "remote"
      ? remoteApi.getCurrentOmoProviderId(
          target.profile,
          "omo-slim",
          target.secret,
        )
      : invoke("get_current_omo_slim_provider_id"),
  disableCurrent: (target: ManagementTarget = LOCAL_TARGET): Promise<void> =>
    target.type === "remote"
      ? remoteApi.disableCurrentOmo(target.profile, "omo-slim", target.secret)
      : invoke("disable_current_omo_slim"),
};
