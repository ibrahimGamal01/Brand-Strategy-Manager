import type { AgentContext } from '../agent-context';

export type ToolName =
  | 'intel.list'
  | 'intel.get'
  | 'intel.stageMutation'
  | 'intel.applyMutation'
  | 'intel.undoMutation'
  | 'scrape.competitor'
  | 'orchestration.run'
  | 'orchestration.status'
  | 'evidence.posts'
  | 'evidence.videos'
  | 'evidence.news'
  | 'web.fetch'
  | 'web.crawl'
  | 'web.extract'
  | 'document.plan'
  | 'document.generate'
  | 'document.status';

export type JsonSchema = Record<string, unknown>;

export type ToolDefinition<Args, Result> = {
  name: ToolName;
  description: string;
  argsSchema: JsonSchema;
  returnsSchema: JsonSchema;
  mutate: boolean;
  execute: (context: AgentContext, args: Args) => Promise<Result>;
};

export type AnyToolDefinition = ToolDefinition<Record<string, unknown>, Record<string, unknown>>;
