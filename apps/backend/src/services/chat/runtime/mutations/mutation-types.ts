import type { RuntimeDecision } from '../types';

export type RuntimeMutationOperation =
  | {
      op: 'create_row';
      section: string;
      values: Record<string, unknown>;
    }
  | {
      op: 'update_row';
      section: string;
      id: string;
      patch: Record<string, unknown>;
    }
  | {
      op: 'update_rows';
      section: string;
      where?: Record<string, unknown>;
      patch: Record<string, unknown>;
    }
  | {
      op: 'delete_row';
      section: string;
      id: string;
    }
  | {
      op: 'delete_rows';
      section: string;
      where?: Record<string, unknown>;
    }
  | {
      op: 'clear_section';
      section: string;
    }
  | {
      op: 'append_list';
      section: string;
      id: string;
      field: string;
      values: unknown[];
    }
  | {
      op: 'remove_list_items';
      section: string;
      id: string;
      field: string;
      values: unknown[];
    };

export type RuntimeMutationRisk = 'low' | 'medium' | 'high';

export type RuntimeMutationGuardIssue = {
  code: string;
  message: string;
  operationIndex?: number;
};

export type RuntimeMutationGuardResult = {
  ok: boolean;
  risk: RuntimeMutationRisk;
  issues: RuntimeMutationGuardIssue[];
  warnings: string[];
  requiresDecision: boolean;
  decision?: RuntimeDecision;
  allowedOperations: RuntimeMutationOperation[];
};

