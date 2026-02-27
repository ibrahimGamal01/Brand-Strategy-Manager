import type { ToolDefinition, ToolName } from './tool-types';
import { intelTools } from './tools-intel';
import { intelReadTools } from './tools-intel-read';
import { documentTools } from './tools-documents';
import { evidenceTools } from './tools-evidence';
import { scraplingTools } from './tools-scrapling';
import { workspaceOpsTools } from './tools-workspace-ops';
import { searchTools } from './tools-search';

export const TOOL_REGISTRY: ToolDefinition<Record<string, unknown>, Record<string, unknown>>[] = [
  ...intelReadTools,
  ...intelTools,
  ...workspaceOpsTools,
  ...documentTools,
  ...evidenceTools,
  ...scraplingTools,
  ...searchTools,
];

export function getTool(name: string): ToolDefinition<Record<string, unknown>, Record<string, unknown>> | null {
  return TOOL_REGISTRY.find((tool) => tool.name === (name as ToolName)) || null;
}
