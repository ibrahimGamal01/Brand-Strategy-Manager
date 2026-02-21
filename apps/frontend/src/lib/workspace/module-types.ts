export type BatWorkspaceModuleKey =
  | 'brain'
  | 'chat'
  | 'intelligence'
  | 'strategy_docs'
  | 'content_calendar'
  | 'content_generators'
  | 'performance';

export interface BatWorkspaceModuleConfig {
  key: BatWorkspaceModuleKey;
  label: string;
  description: string;
  badge?: string;
}

export const BAT_WORKSPACE_MODULES: readonly BatWorkspaceModuleConfig[] = [
  {
    key: 'brain',
    label: 'BAT Brain',
    description: 'Memory, context, command history, and coverage checks.',
  },
  {
    key: 'chat',
    label: 'Chat',
    description: 'RAG-grounded assistant with interactive components.',
  },
  {
    key: 'intelligence',
    label: 'Intelligence',
    description: 'Research signals across client, competitors, trends, and media.',
  },
  {
    key: 'strategy_docs',
    label: 'Strategy Docs',
    description: 'Editable 9-section strategy document workspace.',
  },
  {
    key: 'content_calendar',
    label: 'Content Calendar',
    description: 'Campaign and publishing planning scaffold for upcoming rollout.',
    badge: 'Planned',
  },
  {
    key: 'content_generators',
    label: 'Content Generators',
    description: 'Asset and copy generation module scaffold.',
    badge: 'Planned',
  },
  {
    key: 'performance',
    label: 'Performance',
    description: 'Automation health, continuity status, and live events.',
  },
];
