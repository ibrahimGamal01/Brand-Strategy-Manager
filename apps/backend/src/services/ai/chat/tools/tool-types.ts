import type { AgentContext } from '../agent-context';

export type ToolName =
  | 'intel.list'
  | 'intel.get'
  | 'intel.stageMutation'
  | 'intel.applyMutation'
  | 'intel.undoMutation'
  | 'intake.update_from_text'
  | 'workspace.intake.get'
  | 'competitors.add_links'
  | 'competitors.discover_v3'
  | 'research.gather'
  | 'search.web'
  | 'scrape.competitor'
  | 'orchestration.run'
  | 'orchestration.status'
  | 'evidence.posts'
  | 'evidence.videos'
  | 'evidence.news'
  | 'web.fetch'
  | 'web.crawl'
  | 'web.crawl.get_run'
  | 'web.crawl.list_snapshots'
  | 'web.extract'
  | 'document.plan'
  | 'document.build_spec'
  | 'document.preview'
  | 'document.render_pdf'
  | 'document.generate'
  | 'document.status'
  | 'document.ingest'
  | 'document.read'
  | 'document.search'
  | 'document.propose_edit'
  | 'document.apply_edit'
  | 'document.export'
  | 'document.compare_versions'
  | 'slack.search_messages'
  | 'slack.get_thread';

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
