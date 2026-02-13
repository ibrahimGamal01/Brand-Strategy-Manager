import type { BatWorkspaceModuleKey } from '@/lib/workspace/module-types';

export type BrainCoverageDatasetKey =
  | 'client'
  | 'client.clientAccounts'
  | 'client.personas'
  | 'client.brandMentions'
  | 'client.clientDocuments'
  | 'inputData'
  | 'status'
  | 'continuity'
  | 'discoveredCompetitors'
  | 'socialProfiles'
  | 'socialProfiles.posts'
  | 'socialProfiles.posts.mediaAssets'
  | 'clientProfileSnapshots'
  | 'competitorProfileSnapshots'
  | 'rawSearchResults'
  | 'ddgImageResults'
  | 'ddgVideoResults'
  | 'ddgNewsResults'
  | 'searchTrends'
  | 'socialTrends'
  | 'communityInsights'
  | 'aiQuestions'
  | 'events'
  | 'brainProfile'
  | 'brainProfile.goals'
  | 'brainCommands'
  | 'competitorSummary';

export type BrainCoverageStatus = 'mapped' | 'raw_inspector' | 'missing';

export interface BrainCoverageRow {
  key: BrainCoverageDatasetKey;
  status: BrainCoverageStatus;
  count: number;
  mappedModules: BatWorkspaceModuleKey[];
  source: 'research' | 'brain' | 'events' | 'derived';
  notes?: string;
}

export interface BrainCoverageReport {
  rows: BrainCoverageRow[];
  summary: {
    mapped: number;
    rawInspector: number;
    missing: number;
    datasets: number;
  };
  invisibleDatasets: BrainCoverageDatasetKey[];
  extras: {
    researchTopLevel: string[];
    brainTopLevel: string[];
  };
}

export interface BrainCoverageInput {
  researchJob: Record<string, unknown> | null | undefined;
  brainPayload?: Record<string, unknown> | null;
  events?: Array<Record<string, unknown>> | null;
}

interface DatasetDefinition {
  key: BrainCoverageDatasetKey;
  source: BrainCoverageRow['source'];
  mappedModules: BatWorkspaceModuleKey[];
  notes?: string;
  select: (input: BrainCoverageInput) => unknown;
  count?: (value: unknown) => number;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function defaultCount(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return Object.keys(value as Record<string, unknown>).length;
  if (typeof value === 'string') return value.trim().length > 0 ? 1 : 0;
  if (typeof value === 'number' || typeof value === 'boolean') return 1;
  return 0;
}

function postCountFromProfiles(value: unknown): number {
  const profiles = asArray(value);
  return profiles.reduce<number>((total, profile) => {
    const posts = asArray(asRecord(profile).posts);
    return total + posts.length;
  }, 0);
}

function mediaAssetCountFromProfiles(value: unknown): number {
  const profiles = asArray(value);
  return profiles.reduce<number>((total, profile) => {
    const posts = asArray(asRecord(profile).posts);
    const postAssetCount = posts.reduce<number>((postTotal, post) => {
      const mediaAssets = asArray(asRecord(post).mediaAssets);
      return postTotal + mediaAssets.length;
    }, 0);
    return total + postAssetCount;
  }, 0);
}

const DATASET_DEFINITIONS: readonly DatasetDefinition[] = [
  {
    key: 'client',
    source: 'research',
    mappedModules: ['brain', 'intelligence'],
    select: ({ researchJob }) => asRecord(researchJob).client,
  },
  {
    key: 'client.clientAccounts',
    source: 'research',
    mappedModules: ['brain', 'intelligence'],
    select: ({ researchJob }) => asRecord(asRecord(researchJob).client).clientAccounts,
  },
  {
    key: 'client.personas',
    source: 'research',
    mappedModules: [],
    notes: 'Available through raw inspector until dedicated persona cards ship.',
    select: ({ researchJob }) => asRecord(asRecord(researchJob).client).personas,
  },
  {
    key: 'client.brandMentions',
    source: 'research',
    mappedModules: ['intelligence'],
    select: ({ researchJob }) => asRecord(asRecord(researchJob).client).brandMentions,
  },
  {
    key: 'client.clientDocuments',
    source: 'research',
    mappedModules: ['intelligence'],
    select: ({ researchJob }) => asRecord(asRecord(researchJob).client).clientDocuments,
  },
  {
    key: 'inputData',
    source: 'research',
    mappedModules: ['brain'],
    select: ({ researchJob }) => asRecord(researchJob).inputData,
  },
  {
    key: 'status',
    source: 'research',
    mappedModules: ['brain', 'performance'],
    select: ({ researchJob }) => asRecord(researchJob).status,
  },
  {
    key: 'continuity',
    source: 'derived',
    mappedModules: ['performance'],
    select: ({ researchJob }) => {
      const job = asRecord(researchJob);
      return {
        enabled: job.continuityEnabled,
        intervalHours: job.continuityIntervalHours,
        running: job.continuityRunning,
        lastRunAt: job.continuityLastRunAt,
        nextRunAt: job.continuityNextRunAt,
        errorMessage: job.continuityErrorMessage,
      };
    },
  },
  {
    key: 'discoveredCompetitors',
    source: 'research',
    mappedModules: ['intelligence', 'brain'],
    select: ({ researchJob }) => asRecord(researchJob).discoveredCompetitors,
  },
  {
    key: 'socialProfiles',
    source: 'research',
    mappedModules: ['intelligence'],
    select: ({ researchJob }) => asRecord(researchJob).socialProfiles,
  },
  {
    key: 'socialProfiles.posts',
    source: 'research',
    mappedModules: ['intelligence'],
    select: ({ researchJob }) => asRecord(researchJob).socialProfiles,
    count: postCountFromProfiles,
  },
  {
    key: 'socialProfiles.posts.mediaAssets',
    source: 'research',
    mappedModules: ['intelligence'],
    select: ({ researchJob }) => asRecord(researchJob).socialProfiles,
    count: mediaAssetCountFromProfiles,
  },
  {
    key: 'clientProfileSnapshots',
    source: 'research',
    mappedModules: ['intelligence'],
    select: ({ researchJob }) => asRecord(researchJob).clientProfileSnapshots,
  },
  {
    key: 'competitorProfileSnapshots',
    source: 'research',
    mappedModules: [],
    notes: 'Available through raw inspector and performance diagnostics for now.',
    select: ({ researchJob }) => asRecord(researchJob).competitorProfileSnapshots,
  },
  {
    key: 'rawSearchResults',
    source: 'research',
    mappedModules: ['intelligence'],
    select: ({ researchJob }) => asRecord(researchJob).rawSearchResults,
  },
  {
    key: 'ddgImageResults',
    source: 'research',
    mappedModules: ['intelligence'],
    select: ({ researchJob }) => asRecord(researchJob).ddgImageResults,
  },
  {
    key: 'ddgVideoResults',
    source: 'research',
    mappedModules: ['intelligence'],
    select: ({ researchJob }) => asRecord(researchJob).ddgVideoResults,
  },
  {
    key: 'ddgNewsResults',
    source: 'research',
    mappedModules: ['intelligence'],
    select: ({ researchJob }) => asRecord(researchJob).ddgNewsResults,
  },
  {
    key: 'searchTrends',
    source: 'research',
    mappedModules: ['intelligence', 'performance'],
    select: ({ researchJob }) => asRecord(researchJob).searchTrends,
  },
  {
    key: 'socialTrends',
    source: 'research',
    mappedModules: ['performance'],
    select: ({ researchJob }) => asRecord(researchJob).socialTrends,
  },
  {
    key: 'communityInsights',
    source: 'research',
    mappedModules: ['intelligence'],
    select: ({ researchJob }) => asRecord(researchJob).communityInsights,
  },
  {
    key: 'aiQuestions',
    source: 'research',
    mappedModules: ['intelligence', 'strategy_docs'],
    select: ({ researchJob }) => asRecord(researchJob).aiQuestions,
  },
  {
    key: 'events',
    source: 'events',
    mappedModules: ['performance'],
    select: ({ events }) => events,
  },
  {
    key: 'brainProfile',
    source: 'brain',
    mappedModules: ['brain'],
    select: ({ brainPayload }) => asRecord(brainPayload).brainProfile,
  },
  {
    key: 'brainProfile.goals',
    source: 'brain',
    mappedModules: ['brain'],
    select: ({ brainPayload }) => asRecord(asRecord(brainPayload).brainProfile).goals,
  },
  {
    key: 'brainCommands',
    source: 'brain',
    mappedModules: ['brain'],
    select: ({ brainPayload }) => asRecord(brainPayload).commandHistory,
  },
  {
    key: 'competitorSummary',
    source: 'brain',
    mappedModules: ['brain'],
    select: ({ brainPayload }) => asRecord(brainPayload).competitorSummary,
  },
] as const;

const KNOWN_RESEARCH_KEYS = new Set<string>(
  DATASET_DEFINITIONS.filter((dataset) => dataset.source === 'research').map((dataset) => dataset.key.split('.')[0])
);

const KNOWN_BRAIN_KEYS = new Set<string>(
  DATASET_DEFINITIONS.filter((dataset) => dataset.source === 'brain').map((dataset) => dataset.key.split('.')[0])
);

export function buildBrainCoverageReport(input: BrainCoverageInput): BrainCoverageReport {
  const rows = DATASET_DEFINITIONS.map((dataset): BrainCoverageRow => {
    const value = dataset.select(input);
    const hasValue = value !== null && value !== undefined;
    const count = hasValue ? (dataset.count ? dataset.count(value) : defaultCount(value)) : 0;

    if (!hasValue) {
      return {
        key: dataset.key,
        status: 'missing',
        count: 0,
        mappedModules: dataset.mappedModules,
        source: dataset.source,
        notes: dataset.notes,
      };
    }

    if (dataset.mappedModules.length === 0) {
      return {
        key: dataset.key,
        status: 'raw_inspector',
        count,
        mappedModules: dataset.mappedModules,
        source: dataset.source,
        notes: dataset.notes,
      };
    }

    return {
      key: dataset.key,
      status: 'mapped',
      count,
      mappedModules: dataset.mappedModules,
      source: dataset.source,
      notes: dataset.notes,
    };
  });

  const invisibleDatasets = rows
    .filter((row) => row.status === 'missing')
    .map((row) => row.key);

  const researchTopLevel = Object.keys(asRecord(input.researchJob)).filter((key) => !KNOWN_RESEARCH_KEYS.has(key));
  const brainTopLevel = Object.keys(asRecord(input.brainPayload)).filter((key) => !KNOWN_BRAIN_KEYS.has(key));

  return {
    rows,
    summary: {
      mapped: rows.filter((row) => row.status === 'mapped').length,
      rawInspector: rows.filter((row) => row.status === 'raw_inspector').length,
      missing: rows.filter((row) => row.status === 'missing').length,
      datasets: rows.length,
    },
    invisibleDatasets,
    extras: {
      researchTopLevel,
      brainTopLevel,
    },
  };
}
