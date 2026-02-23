export type MutationKind = 'create' | 'update' | 'delete' | 'clear';

export type MutationRequest = {
  section: string;
  kind: MutationKind;
  where?: Record<string, unknown>;
  data?: Record<string, unknown>;
};

export type MutationPreview = {
  mutationId: string;
  kind: MutationKind;
  section: string;
  confirmToken: string;
  matchedCount: number;
  beforeSample: Record<string, unknown>[];
  afterSample: Record<string, unknown>[];
  warnings: string[];
  requiresConfirmation: true;
};

export type ApplyMutationRequest = {
  mutationId: string;
  confirmToken: string;
};

export type ApplyMutationResult = {
  mutationId: string;
  kind: MutationKind;
  section: string;
  changedCount: number;
  undoToken: string;
  appliedAt: string;
};

export type UndoMutationRequest = {
  mutationId: string;
  undoToken: string;
};

export type UndoMutationResult = {
  mutationId: string;
  restoredCount: number;
  undoneAt: string;
};
