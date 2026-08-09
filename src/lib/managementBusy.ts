export interface ManagementInteractionState {
  mcp: boolean;
  skills: boolean;
  skillsNavigation: boolean;
  promptsNavigation: boolean;
  providerDialog: boolean;
  remoteSettings: boolean;
}

export const isManagementInteractionBusy = (
  state: ManagementInteractionState,
) => Object.values(state).some(Boolean);
