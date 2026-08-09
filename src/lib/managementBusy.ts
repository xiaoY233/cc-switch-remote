export interface ManagementInteractionState {
  mcp: boolean;
  skills: boolean;
  skillsNavigation: boolean;
  promptsNavigation: boolean;
  providerDialog: boolean;
}

export const isManagementInteractionBusy = (
  state: ManagementInteractionState,
) => Object.values(state).some(Boolean);
