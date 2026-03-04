"use client";

import {
  addSlackOwnerId,
  createDefaultChannelForm,
  formatChannelType,
  formatSlackUserOption,
  getSlackChannelActionState,
  normalizeSettings,
  parseOwnerSlackIds,
  removeSlackOwnerId,
  stringifyOwnerSlackIds,
} from "@/components/integrations/slack-integration-utils";
import { ChannelFormState, WorkspaceOption } from "@/components/integrations/slack-integration-types";
import {
  SlackIntegrationActions,
  useSlackIntegrationActions,
} from "@/components/integrations/use-slack-integration-actions";
import {
  SlackIntegrationState,
  useSlackIntegrationState,
} from "@/components/integrations/use-slack-integration-state";

export function useSlackIntegrationData() {
  const state = useSlackIntegrationState();
  const actions = useSlackIntegrationActions(state);
  return {
    ...state,
    ...actions,
  };
}

export type SlackIntegrationData = SlackIntegrationState & SlackIntegrationActions;

export type { WorkspaceOption, ChannelFormState };

export {
  normalizeSettings,
  formatChannelType,
  parseOwnerSlackIds,
  stringifyOwnerSlackIds,
  addSlackOwnerId,
  removeSlackOwnerId,
  formatSlackUserOption,
  getSlackChannelActionState,
  createDefaultChannelForm,
};

