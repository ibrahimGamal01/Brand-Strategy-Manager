import { applyMutation, stageMutation, undoMutation } from '../mutations/mutation-service';
import type {
  ApplyMutationRequest,
  MutationRequest,
  UndoMutationRequest,
} from '../mutations/mutation-types';
import type { ToolDefinition } from './tool-types';

export const intelTools: ToolDefinition<Record<string, unknown>, Record<string, unknown>>[] = [
  {
    name: 'intel.stageMutation',
    description: 'Stage an intelligence mutation and return a preview with warnings.',
    argsSchema: {
      type: 'object',
      properties: {
        section: { type: 'string', enum: ['competitors'] },
        kind: { type: 'string', enum: ['create', 'update', 'delete', 'clear'] },
        where: { type: 'object' },
        data: { type: 'object' },
      },
      required: ['section', 'kind'],
      additionalProperties: false,
    },
    returnsSchema: {
      type: 'object',
      properties: {
        mutationId: { type: 'string' },
        section: { type: 'string' },
        kind: { type: 'string' },
        confirmToken: { type: 'string' },
        matchedCount: { type: 'number' },
        beforeSample: { type: 'array' },
        afterSample: { type: 'array' },
        warnings: { type: 'array', items: { type: 'string' } },
        requiresConfirmation: { type: 'boolean' },
      },
      required: [
        'mutationId',
        'section',
        'kind',
        'confirmToken',
        'matchedCount',
        'beforeSample',
        'afterSample',
        'warnings',
        'requiresConfirmation',
      ],
      additionalProperties: false,
    },
    mutate: true,
    execute: async (context, args) => stageMutation(context, args as MutationRequest) as unknown as Record<string, unknown>,
  },
  {
    name: 'intel.applyMutation',
    description: 'Apply a staged intelligence mutation after confirm-token validation.',
    argsSchema: {
      type: 'object',
      properties: {
        mutationId: { type: 'string' },
        confirmToken: { type: 'string' },
      },
      required: ['mutationId', 'confirmToken'],
      additionalProperties: false,
    },
    returnsSchema: {
      type: 'object',
      properties: {
        mutationId: { type: 'string' },
        kind: { type: 'string' },
        section: { type: 'string' },
        changedCount: { type: 'number' },
        undoToken: { type: 'string' },
        appliedAt: { type: 'string' },
      },
      required: ['mutationId', 'kind', 'section', 'changedCount', 'undoToken', 'appliedAt'],
      additionalProperties: false,
    },
    mutate: true,
    execute: async (context, args) => applyMutation(context, args as ApplyMutationRequest) as unknown as Record<string, unknown>,
  },
  {
    name: 'intel.undoMutation',
    description: 'Undo a previously applied mutation with an undo token.',
    argsSchema: {
      type: 'object',
      properties: {
        mutationId: { type: 'string' },
        undoToken: { type: 'string' },
      },
      required: ['mutationId', 'undoToken'],
      additionalProperties: false,
    },
    returnsSchema: {
      type: 'object',
      properties: {
        mutationId: { type: 'string' },
        restoredCount: { type: 'number' },
        undoneAt: { type: 'string' },
      },
      required: ['mutationId', 'restoredCount', 'undoneAt'],
      additionalProperties: false,
    },
    mutate: true,
    execute: async (context, args) => undoMutation(context, args as UndoMutationRequest) as unknown as Record<string, unknown>,
  },
];
