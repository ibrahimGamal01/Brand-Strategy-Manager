import { stageMutation } from '../mutations/mutation-service';
import type { MutationRequest } from '../mutations/mutation-types';
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
];
