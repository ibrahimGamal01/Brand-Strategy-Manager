'use client';

import { useCallback, useEffect, useState } from 'react';
import { useResearchJob } from '@/hooks/useResearchJob';
import { useResearchJobEvents } from '@/hooks/useResearchJobEvents';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { ResearchFooter } from './components';
import { ResearchTreeView } from './components/ResearchTreeView';
import StrategyWorkspace from './components/strategy/StrategyWorkspace';
import ContentCalendarWorkspace from './components/calendar/ContentCalendarWorkspace';
import ChatWorkspace from './components/chat/ChatWorkspace';
import { apiClient, ResearchJobEvent } from '@/lib/api-client';
import { BrainWorkspacePanel } from './components/brain/BrainWorkspacePanel';
import { LiveActivityFeed } from './components/LiveActivityFeed';
import { BatWorkspaceShell } from '@/components/workspace/BatWorkspaceShell';
import { BatClientTopbar } from '@/components/workspace/BatClientTopbar';
import { BatModuleNav } from '@/components/workspace/BatModuleNav';
import { BatNotificationRail } from '@/components/workspace/BatNotificationRail';
import { WorkspaceErrorBoundary } from '@/components/workspace/WorkspaceErrorBoundary';
import { BrainDataLedger } from '@/components/workspace/BrainDataLedger';
import { BrainRawInspector } from '@/components/workspace/BrainRawInspector';
import {
  buildBrainCoverageReport,
  type BrainCoverageDatasetKey,
} from '@/lib/brain-data/coverage-contract';
import {
  BAT_WORKSPACE_MODULES,
  type BatWorkspaceModuleKey,
} from '@/lib/workspace/module-types';
import { QuestionPopup } from '@/components/client-questions/QuestionPopup';
import { Badge } from '@/components/ui/badge';

/** Normalize handle for matching: extract username from URLs or strip @ and lowercase */
function normalizeHandleForMatch(handle: string): string {
  if (!handle || typeof handle !== 'string') return '';
  const raw = handle.trim();
  const ig = raw.match(/instagram\.com\/([a-z0-9._]{2,30})/i);
  if (ig) return ig[1].toLowerCase();
  const tt = raw.match(/tiktok\.com\/@?([a-z0-9._]{2,30})/i);
  if (tt) return tt[1].toLowerCase();
  return raw.replace(/^@+/, '').trim().toLowerCase();
}

function fmtDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  // Use fixed ISO-style format to avoid server/client locale mismatch hydration errors
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function ModulePlaceholder({
  title,
  description,
  readiness,
  requiredKeys,
}: {
  title: string;
  description: string;
  readiness: Record<BrainCoverageDatasetKey, boolean>;
  requiredKeys: BrainCoverageDatasetKey[];
}) {
  const readyCount = requiredKeys.filter((key) => readiness[key]).length;

  return (
    <section className="space-y-4 rounded-xl border border-border/70 bg-card/50 p-5">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>

      <div className="rounded-lg border border-border/60 bg-background/50 p-3">
        <div className="mb-2 flex items-center gap-2">
          <Badge variant="outline" className="text-[10px] uppercase">
            Readiness
          </Badge>
          <span className="text-sm font-medium">
            {readyCount}/{requiredKeys.length} required datasets available
          </span>
        </div>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {requiredKeys.map((key) => (
            <div key={key} className="flex items-center justify-between rounded border border-border/50 bg-card/50 px-2 py-1 text-xs">
              <span className="font-mono">{key}</span>
              <Badge variant={readiness[key] ? 'success' : 'warning'} className="text-[10px] uppercase">
                {readiness[key] ? 'ready' : 'pending'}
              </Badge>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function isWorkspaceModule(value: string | null | undefined): value is BatWorkspaceModuleKey {
  if (!value) return false;
  return BAT_WORKSPACE_MODULES.some((module) => module.key === value);
}

export default function ResearchPage() {
  const params = useParams();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamsString = searchParams.toString();
  const { toast } = useToast();
  const jobId = params.id as string;
  const moduleParam = searchParams.get('module');

  const [isContinuing, setIsContinuing] = useState(false);
  const [isExportingCompetitors, setIsExportingCompetitors] = useState(false);
  const [brainPayload, setBrainPayload] = useState<Record<string, unknown> | null>(null);
  const activeModule: BatWorkspaceModuleKey = isWorkspaceModule(moduleParam) ? moduleParam : 'brain';

  const { events, connectionState, isSseHealthy } = useResearchJobEvents(jobId);
  const { data: job, isLoading, error, refetch } = useResearchJob(jobId, { sseHealthy: isSseHealthy });

  async function loadBrainPayload() {
    try {
      const payload = (await apiClient.getBrain(jobId)) as Record<string, unknown>;
      setBrainPayload(payload);
    } catch (requestError: any) {
      console.warn('[BAT] Failed loading brain payload:', requestError?.message || requestError);
    }
  }

  useEffect(() => {
    void loadBrainPayload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const setModule = useCallback(
    (nextModule: BatWorkspaceModuleKey) => {
      if (nextModule === activeModule) return;
      const nextParams = new URLSearchParams(searchParamsString);
      if (nextParams.get('module') === nextModule) return;
      nextParams.set('module', nextModule);
      router.replace(`${pathname}?${nextParams.toString()}`, { scroll: false });
    },
    [activeModule, pathname, router, searchParamsString]
  );

  // Refetch brain when job data changes (e.g. after orchestration) and brainPayload is still missing
  useEffect(() => {
    if (job && !brainPayload) {
      void loadBrainPayload();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.updatedAt, job?.status]);

  async function handleContinueNow() {
    try {
      setIsContinuing(true);
      const payload = await apiClient.continueResearchJob(jobId);

      if (!payload || payload.error || !payload.success) {
        throw new Error(payload?.error || 'Failed to continue research job');
      }

      const result = payload?.result || {};
      const hadErrors = Array.isArray(result?.errors) && result.errors.length > 0;
      toast({
        title: hadErrors ? 'Continuity run finished with warnings' : 'Continuity run started',
        description: hadErrors
          ? result.errors.slice(0, 2).join(' | ')
          : `Client targets: ${result.clientProfilesAttempted || 0}, competitor targets: ${result.competitorProfilesAttempted || 0}.`,
      });

      await Promise.all([refetch(), loadBrainPayload()]);
    } catch (requestError: any) {
      toast({
        title: 'Continue failed',
        description: requestError.message || 'Failed to run continuity cycle',
        variant: 'destructive',
      });
    } finally {
      setIsContinuing(false);
    }
  }

  async function handleExportCompetitorDebug() {
    try {
      setIsExportingCompetitors(true);
      const payload = await apiClient.getCompetitorDebugExport(jobId);
      const runId =
        typeof payload?.run?.id === 'string' && payload.run.id.trim().length > 0
          ? payload.run.id.trim()
          : 'latest';
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `competitor-debug-${jobId}-${runId}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast({
        title: 'Competitor export ready',
        description: `Downloaded debug payload for run ${runId}.`,
      });
    } catch (requestError: any) {
      toast({
        title: 'Export failed',
        description: requestError?.message || 'Could not export competitor debug payload',
        variant: 'destructive',
      });
    } finally {
      setIsExportingCompetitors(false);
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto" />
          <p className="text-muted-foreground font-mono text-sm">Loading BAT workspace...</p>
        </div>
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center text-destructive">
          <p>Failed to load BAT workspace</p>
          <p className="text-sm text-muted-foreground mt-2">{(error as Error)?.message}</p>
        </div>
      </div>
    );
  }

  const data = job as any;
  const client = data.client || {};
  const inputData = data.inputData || {};

  const instagramAccount = client.clientAccounts?.find((acc: any) => acc.platform === 'instagram');
  const primaryHandle = instagramAccount?.handle || inputData.handle || inputData.handles?.instagram || '';
  client.handle = primaryHandle;

  const clientPosts = client.clientAccounts?.flatMap((acc: any) => acc.clientPosts || []) || [];
  const rawSearchResults = data.rawSearchResults || [];
  const ddgImageResults = data.ddgImageResults || [];
  const ddgVideoResults = data.ddgVideoResults || [];
  const ddgNewsResults = data.ddgNewsResults || [];
  const searchTrends = data.searchTrends || [];
  const socialTrends = data.socialTrends || [];

  const selectionPriority: Record<string, number> = {
    TOP_PICK: 5,
    APPROVED: 4,
    SHORTLISTED: 3,
    FILTERED_OUT: 2,
    REJECTED: 1,
  };
  const statusPriority: Record<string, number> = {
    SCRAPED: 6,
    SCRAPING: 5,
    CONFIRMED: 4,
    SUGGESTED: 3,
    FAILED: 2,
    REJECTED: 1,
  };

  const dedupedCompetitorRows = new Map<string, any>();
  for (const row of data.discoveredCompetitors || []) {
    const platform = String(row?.platform || '').toLowerCase();
    const handle = String(row?.handle || '').toLowerCase();
    if (!platform || !handle) continue;

    const key = `${platform}:${handle}`;
    const existing = dedupedCompetitorRows.get(key);
    if (!existing) {
      dedupedCompetitorRows.set(key, row);
      continue;
    }

    const nextSelectionRank = selectionPriority[String(row?.selectionState || '').toUpperCase()] || 0;
    const existingSelectionRank = selectionPriority[String(existing?.selectionState || '').toUpperCase()] || 0;
    const nextStatusRank = statusPriority[String(row?.status || '').toUpperCase()] || 0;
    const existingStatusRank = statusPriority[String(existing?.status || '').toUpperCase()] || 0;
    const nextDiscoveredAt = new Date(row?.discoveredAt || 0).getTime();
    const existingDiscoveredAt = new Date(existing?.discoveredAt || 0).getTime();

    if (
      nextDiscoveredAt > existingDiscoveredAt ||
      (nextDiscoveredAt === existingDiscoveredAt && nextSelectionRank > existingSelectionRank) ||
      (nextDiscoveredAt === existingDiscoveredAt &&
        nextSelectionRank === existingSelectionRank &&
        nextStatusRank > existingStatusRank)
    ) {
      dedupedCompetitorRows.set(key, row);
    }
  }

  const competitors = Array.from(dedupedCompetitorRows.values())
    .map((dc: any) => {
      const followerCount = dc.competitor?.followerCount ?? dc.followerCount ?? dc.followers;
      return {
        id: dc.id,
        handle: dc.handle,
        platform: dc.platform,
        status: dc.status,
        discoveryReason: dc.discoveryReason,
        relevanceScore: dc.relevanceScore,
        postsScraped: dc.postsScraped,
        profileUrl: dc.profileUrl,
        followerCount,
        followers: followerCount,
        engagement: dc.engagement,
        selectionState: dc.selectionState,
        selectionReason: dc.selectionReason,
        evidence: dc.evidence,
        scoreBreakdown: dc.scoreBreakdown,
        orchestrationRunId: dc.orchestrationRunId,
      };
    })
    .sort((a: any, b: any) => {
      const selectionRank = (state?: string) => {
        const normalized = String(state || '').toUpperCase();
        if (normalized === 'TOP_PICK') return 5;
        if (normalized === 'APPROVED') return 4;
        if (normalized === 'SHORTLISTED') return 3;
        if (normalized === 'FILTERED_OUT') return 2;
        if (normalized === 'REJECTED') return 1;
        return 0;
      };
      const statusRank = (status?: string) => {
        const normalized = String(status || '').toUpperCase();
        if (normalized === 'SCRAPED') return 5;
        if (normalized === 'SCRAPING') return 4;
        if (normalized === 'CONFIRMED') return 3;
        if (normalized === 'SUGGESTED') return 2;
        if (normalized === 'FAILED') return 1;
        return 0;
      };
      const bySelection = selectionRank(b.selectionState) - selectionRank(a.selectionState);
      if (bySelection !== 0) return bySelection;
      const byScore = (Number(b.relevanceScore) || 0) - (Number(a.relevanceScore) || 0);
      if (byScore !== 0) return byScore;
      return statusRank(b.status) - statusRank(a.status);
    });

  const communityInsights = data.communityInsights || [];
  const mediaAssets = data.mediaAssets || [];
  const aiQuestions = data.aiQuestions || [];

  const clientHandles = new Set<string>();
  const addHandle = (handle: string) => {
    if (!handle || typeof handle !== 'string') return;
    const lower = handle.trim().toLowerCase();
    clientHandles.add(lower);
    const normalized = normalizeHandleForMatch(handle);
    if (normalized) clientHandles.add(normalized);
  };
  (client.clientAccounts || []).forEach((acc: any) => {
    if (acc.handle) addHandle(acc.handle);
  });
  if (inputData.handle) addHandle(inputData.handle);
  if (inputData.handles) {
    Object.values(inputData.handles).forEach((handle: any) => {
      if (typeof handle === 'string' && handle) addHandle(handle);
    });
  }

  const competitorHandles = new Set<string>();
  competitors.forEach((comp: any) => {
    if (comp.handle) competitorHandles.add(comp.handle.toLowerCase());
  });

  const apiSocialProfiles = (data.socialProfiles || []).filter((profile: any) => {
    if (!profile.handle) return false;
    const handleLower = profile.handle.toLowerCase();
    const normalizedProfileHandle = normalizeHandleForMatch(profile.handle);
    const matchesClientHandle =
      clientHandles.has(handleLower) || (normalizedProfileHandle !== '' && clientHandles.has(normalizedProfileHandle));

    const isTikTok = profile.platform?.toLowerCase() === 'tiktok';
    const isCompetitor = competitorHandles.has(handleLower);
    if (isTikTok && !isCompetitor) return true;

    return matchesClientHandle;
  });

  let socialProfiles =
    apiSocialProfiles.length > 0
      ? apiSocialProfiles
      : (() => {
        const fromAccounts = (client.clientAccounts || []).map((acc: any) => ({
          platform: acc.platform,
          handle: acc.handle,
          followers: acc.followerCount || 0,
          following: acc.followingCount || 0,
          bio: acc.bio || '',
          profileImageUrl: acc.profileImageUrl,
        }));
        if (fromAccounts.length > 0) return fromAccounts;
        const fromInput: Array<{ platform: string; handle: string; followers: number; following: number; bio: string; profileImageUrl?: string }> = [];
        if (inputData.handle && (inputData.platform === 'instagram' || inputData.platform === 'tiktok')) {
          fromInput.push({
            platform: String(inputData.platform || 'instagram').toLowerCase(),
            handle: String(inputData.handle).replace(/^@+/, '').trim(),
            followers: 0,
            following: 0,
            bio: '',
          });
        }
        if (inputData.handles && typeof inputData.handles === 'object') {
          for (const [platform, handle] of Object.entries(inputData.handles)) {
            if ((platform === 'instagram' || platform === 'tiktok') && typeof handle === 'string' && handle) {
              const h = String(handle).replace(/^@+/, '').trim();
              if (h && !fromInput.some((p) => p.platform === platform && p.handle.toLowerCase() === h.toLowerCase()))
                fromInput.push({ platform, handle: h, followers: 0, following: 0, bio: '' });
            }
          }
        }
        return fromInput;
      })();

  socialProfiles = socialProfiles.sort((a: any, b: any) => {
    const priority = { instagram: 1, tiktok: 2 };
    const p1 = priority[a.platform?.toLowerCase() as keyof typeof priority] || 99;
    const p2 = priority[b.platform?.toLowerCase() as keyof typeof priority] || 99;
    return p1 - p2;
  });

  const tiktokProfile = socialProfiles.find((profile: any) => profile.platform === 'tiktok');
  const tiktokPosts = tiktokProfile?.posts || [];

  const researchData = {
    clientPosts,
    tiktokPosts,
    clientProfileSnapshots: data.clientProfileSnapshots || [],
    competitorProfileSnapshots: data.competitorProfileSnapshots || [],
    rawSearchResults,
    ddgImageResults,
    ddgVideoResults,
    ddgNewsResults,
    searchTrends,
    socialTrends,
    competitors,
    communityInsights,
    mediaAssets,
    aiQuestions,
    webSources: data.webSources || [],
    webSnapshots: data.webPageSnapshots || [],
    webExtractionRecipes: data.webExtractionRecipes || [],
    webExtractionRuns: data.webExtractionRuns || [],
    socialProfiles,
    brandMentions: client.brandMentions || [],
    clientDocuments: client.clientDocuments || [],
    analysisScope: data.analysisScope || null,
    trendDebug: inputData.trendDebug || undefined,
  };

  // Use job data as fallback for brain coverage when separate brain fetch hasn't completed or failed
  const derivedBrainPayload =
    brainPayload ??
    (data
      ? {
        success: true,
        brainProfile: data.brainProfile ?? data.client?.brainProfile ?? null,
        commandHistory: data.brainCommands ?? [],
        competitorSummary: data.competitorSummary ?? {
          runId: null,
          topPicks: 0,
          shortlisted: 0,
          approved: 0,
          filtered: 0,
        },
      }
      : undefined);

  const coverageReport = buildBrainCoverageReport({
    researchJob: data as Record<string, unknown>,
    brainPayload: derivedBrainPayload,
    events: events as unknown as Array<Record<string, unknown>>,
  });

  const readinessMap = {} as Record<BrainCoverageDatasetKey, boolean>;
  coverageReport.rows.forEach((row) => {
    readinessMap[row.key] = row.status !== 'missing';
  });

  const activeModuleLabel =
    BAT_WORKSPACE_MODULES.find((module) => module.key === activeModule)?.label || 'BAT Brain';

  return (
    <BatWorkspaceShell
      topbar={
        <BatClientTopbar
          client={client}
          job={data}
          activeModuleLabel={activeModuleLabel}
          onExportCompetitors={handleExportCompetitorDebug}
          isExportingCompetitors={isExportingCompetitors}
          onContinueNow={handleContinueNow}
          isContinuing={isContinuing}
        />
      }
      moduleNav={
        <BatModuleNav
          modules={BAT_WORKSPACE_MODULES}
          activeModule={activeModule}
          onChange={setModule}
        />
      }
      notificationRail={
        <BatNotificationRail
          events={events as ResearchJobEvent[]}
          connectionState={connectionState}
          onSelectEvent={(event) => {
            setModule('intelligence');
            toast({
              title: 'Opened Intelligence',
              description: event.message,
            });
          }}
        />
      }
    >
      <WorkspaceErrorBoundary
        title="BAT workspace module failed to render"
        resetKey={`${activeModule}:${String(data?.updatedAt || '')}`}
      >
        {activeModule === 'brain' ? (
          <div className="space-y-4">
            <BrainWorkspacePanel
              jobId={jobId}
              onRefresh={() => {
                void Promise.all([refetch(), loadBrainPayload()]);
              }}
            />
            <BrainDataLedger report={coverageReport} />
            <BrainRawInspector
              researchJob={data as Record<string, unknown>}
              brainPayload={brainPayload}
              events={(events as unknown as Array<Record<string, unknown>>) || []}
              report={coverageReport}
            />
          </div>
        ) : null}

        {activeModule === 'chat' ? <ChatWorkspace jobId={data.id} /> : null}

        {activeModule === 'intelligence' ? (
          <div className="space-y-4">
            <ResearchTreeView
              jobId={data.id}
              client={client}
              data={researchData}
              onRefreshSection={() => {
                void refetch();
              }}
            />

            <section className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-xl border border-border/70 bg-card/50 p-4">
                <h3 className="mb-2 text-sm font-semibold">Competitor Profile Snapshots</h3>
                <p className="mb-3 text-xs text-muted-foreground">
                  Latest archived competitor profile snapshots across continuity runs.
                </p>
                <div className="max-h-[320px] space-y-2 overflow-auto custom-scrollbar">
                  {(researchData.competitorProfileSnapshots || []).slice(0, 30).map((snapshot: any, index: number) => (
                    <div key={snapshot.id || index} className="rounded border border-border/60 bg-background/60 p-2 text-xs">
                      <p className="font-medium">
                        {snapshot?.competitorProfile?.platform || 'platform'} @
                        {snapshot?.competitorProfile?.handle || 'unknown'}
                      </p>
                      <p className="text-muted-foreground">
                        Posts: {(snapshot?.posts || []).length} • Scraped: {fmtDate(snapshot?.scrapedAt)}
                      </p>
                    </div>
                  ))}
                  {(researchData.competitorProfileSnapshots || []).length === 0 ? (
                    <p className="text-xs text-muted-foreground">No competitor snapshots available yet.</p>
                  ) : null}
                </div>
              </div>

              <div className="rounded-xl border border-border/70 bg-card/50 p-4">
                <h3 className="mb-2 text-sm font-semibold">Media Assets + Social Trends</h3>
                <p className="mb-3 text-xs text-muted-foreground">
                  Additional aggregated signals used by BAT for planning and performance checks.
                </p>
                <div className="space-y-2 text-xs">
                  <div className="rounded border border-border/60 bg-background/60 px-2 py-1.5">
                    Media assets tracked: <span className="font-semibold">{(researchData.mediaAssets || []).length}</span>
                  </div>
                  <div className="rounded border border-border/60 bg-background/60 px-2 py-1.5">
                    Social trends tracked: <span className="font-semibold">{(researchData.socialTrends || []).length}</span>
                  </div>
                </div>

                <div className="mt-3 max-h-[240px] space-y-2 overflow-auto custom-scrollbar">
                  {(researchData.socialTrends || []).slice(0, 20).map((trend: any, index: number) => (
                    <div key={trend.id || index} className="rounded border border-border/50 bg-background/60 p-2 text-xs">
                      <p className="font-medium">{trend.name || trend.keyword || 'Social Trend'}</p>
                      <p className="text-muted-foreground">
                        {trend.platform || 'unknown'} • {trend.type || 'topic'} • Growth{' '}
                        {trend.growthRate !== null && trend.growthRate !== undefined ? `${trend.growthRate}%` : 'n/a'}
                      </p>
                    </div>
                  ))}
                  {(researchData.socialTrends || []).length === 0 ? (
                    <p className="text-xs text-muted-foreground">No social trends available yet.</p>
                  ) : null}
                </div>
              </div>
            </section>
          </div>
        ) : null}

        {activeModule === 'strategy_docs' ? (
          <StrategyWorkspace
            jobId={data.id}
            clientName={client?.name || data?.client?.name || 'Client'}
          />
        ) : null}

        {activeModule === 'content_calendar' ? <ContentCalendarWorkspace jobId={data.id} /> : null}

        {activeModule === 'content_generators' ? (
          <ModulePlaceholder
            title="Content Generators"
            description="Generator scaffolding is active. BAT will use memory, strategy sections, and channel signals to power output generation."
            readiness={readinessMap}
            requiredKeys={[
              'brainProfile',
              'brainCommands',
              'aiQuestions',
              'communityInsights',
              'socialProfiles.posts.mediaAssets',
            ]}
          />
        ) : null}

        {activeModule === 'performance' ? (
          <div className="space-y-4">
            <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-xl border border-border/70 bg-card/50 p-3">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Continuity</p>
                <p className="mt-1 text-sm font-semibold">{data?.continuityEnabled ? 'Enabled' : 'Disabled'}</p>
                <p className="text-xs text-muted-foreground">Every {Math.max(2, Number(data?.continuityIntervalHours || 2))}h</p>
              </div>
              <div className="rounded-xl border border-border/70 bg-card/50 p-3">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Last Run</p>
                <p className="mt-1 text-sm font-semibold">{fmtDate(data?.continuityLastRunAt)}</p>
              </div>
              <div className="rounded-xl border border-border/70 bg-card/50 p-3">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Next Run</p>
                <p className="mt-1 text-sm font-semibold">{fmtDate(data?.continuityNextRunAt)}</p>
              </div>
              <div className="rounded-xl border border-border/70 bg-card/50 p-3">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Social Trends</p>
                <p className="mt-1 text-sm font-semibold">{(researchData.socialTrends || []).length}</p>
              </div>
            </section>

            <LiveActivityFeed events={events as ResearchJobEvent[]} connectionState={connectionState} mode="panel" jobId={jobId} />
          </div>
        ) : null}
      </WorkspaceErrorBoundary>

      <ResearchFooter jobId={data.id} />
      <QuestionPopup researchJobId={data.id} />
    </BatWorkspaceShell>
  );
}
