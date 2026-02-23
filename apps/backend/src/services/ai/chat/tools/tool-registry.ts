import type { ToolDefinition, ToolName } from './tool-types';
import { evidenceTools } from './tools-evidence';

export const TOOL_REGISTRY: ToolDefinition<Record<string, unknown>, Record<string, unknown>>[] = [
  ...evidenceTools,
];

export function getTool(name: string): ToolDefinition<Record<string, unknown>, Record<string, unknown>> | null {
  return TOOL_REGISTRY.find((tool) => tool.name === (name as ToolName)) || null;
}
