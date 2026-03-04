"use client";

export type WorkspaceOption = {
  id: string;
  name: string;
};

export type ChannelFormState = {
  workspaceId: string;
  ownerSlackIds: string;
  ownerPickerSlackUserId: string;
  working: boolean;
  message: string;
  isError: boolean;
};

