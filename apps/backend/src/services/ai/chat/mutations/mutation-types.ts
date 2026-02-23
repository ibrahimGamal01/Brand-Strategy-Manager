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
  matchedCount: number;
  beforeSample: Record<string, unknown>[];
  afterSample: Record<string, unknown>[];
  warnings: string[];
  requiresConfirmation: true;
};
