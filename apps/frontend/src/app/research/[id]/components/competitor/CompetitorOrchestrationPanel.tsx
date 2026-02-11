'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, PlayCircle, RefreshCw, Sparkles } from 'lucide-react';
import {
  apiClient,
  CompetitorShortlistResponse,
  OrchestratedCompetitorIdentityGroup,
  OrchestratedCompetitorProfile,
} from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface CompetitorOrchestrationPanelProps {
  jobId: string;
  className?: string;
  onRefresh?: () => void;
}

function profileScoreLabel(profile: OrchestratedCompetitorProfile): string {
  const score = Number(profile.relevanceScore || 0);
  return `${Math.round(score * 100)}%`;
}

function availabilityVariant(status: OrchestratedCompetitorProfile['availabilityStatus']):
  | 'default'
  | 'secondary'
  | 'outline'
  | 'destructive' {
  if (status === 'VERIFIED') return 'default';
  if (status === 'UNVERIFIED') return 'secondary';
  if (status === 'RATE_LIMITED' || status === 'CONNECTOR_ERROR') return 'outline';
  return 'destructive';
}

function selectionVariant(state: OrchestratedCompetitorProfile['state']):
  | 'default'
  | 'secondary'
  | 'outline'
  | 'destructive' {
  if (state === 'TOP_PICK') return 'default';
  if (state === 'APPROVED') return 'secondary';
  if (state === 'SHORTLISTED') return 'outline';
  return 'destructive';
}

function isScrapeEligible(profile: OrchestratedCompetitorProfile): boolean {
  if (profile.state === 'FILTERED_OUT' || profile.state === 'REJECTED') return false;
  if (profile.availabilityStatus !== 'VERIFIED') return false;
  return Boolean(profile.discoveredCompetitorId);
}

function toAllProfiles(groups: OrchestratedCompetitorIdentityGroup[]): OrchestratedCompetitorProfile[] {
  return groups.flatMap((group) => group.profiles || []);
}

function groupHeader(group: OrchestratedCompetitorIdentityGroup): string {
  const platformSet = new Set(group.profiles.map((profile) => profile.platform));
  const parts = [`${platformSet.size} surface${platformSet.size === 1 ? '' : 's'}`];
  if (group.websiteDomain) parts.push(group.websiteDomain);
  return parts.join(' • ');
}

export function CompetitorOrchestrationPanel({
  jobId,
  className,
  onRefresh,
}: CompetitorOrchestrationPanelProps) {
  const { toast } = useToast();
  const [data, setData] = useState<CompetitorShortlistResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [runningDiscovery, setRunningDiscovery] = useState(false);
  const [approving, setApproving] = useState(false);
  const [continuingPending, setContinuingPending] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [continuingByProfile, setContinuingByProfile] = useState<Record<string, boolean>>({});

  const runId = data?.runId || null;

  const selectableProfileIds = useMemo(() => {
    const top = toAllProfiles(data?.topPicks || []);
    const shortlist = toAllProfiles(data?.shortlist || []);
    return [...top, ...shortlist].filter((profile) => isScrapeEligible(profile)).map((profile) => profile.id);
  }, [data]);

  const selectedCount = selectedIds.size;
  const hasSelectableRows = selectableProfileIds.length > 0;

  async function loadShortlist() {
    try {
      setLoading(true);
      const payload = await apiClient.getCompetitorShortlist(jobId);
      if (payload?.success === false) {
        throw new Error(payload?.summary ? 'Failed to load shortlist' : 'Failed to load shortlist');
      }

      setData(payload);

      const defaults = new Set<string>();
      const top = toAllProfiles(payload.topPicks || []);
      const shortlist = toAllProfiles(payload.shortlist || []);

      for (const profile of top) {
        if (isScrapeEligible(profile)) defaults.add(profile.id);
      }
      for (const profile of shortlist) {
        if (profile.state === 'APPROVED' && isScrapeEligible(profile)) defaults.add(profile.id);
      }

      setSelectedIds(defaults);
    } catch (error: any) {
      toast({
        title: 'Failed to load competitor shortlist',
        description: error?.message || 'Unable to fetch orchestration shortlist',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadShortlist();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  function onCheckedChange(id: string, checked: boolean) {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function handleContinueDiscovery() {
    try {
      setRunningDiscovery(true);
      const response = await apiClient.runCompetitorOrchestration(jobId, {
        mode: 'append',
        targetCount: 10,
        precision: 'high',
        connectorPolicy: 'ddg_first_pluggable',
      });

      if (!response?.success) {
        throw new Error(response?.error || 'Competitor orchestration failed');
      }

      if (response.alreadyRunning) {
        toast({
          title: 'Discovery already running',
          description: response.message || 'Using the active discovery run and refreshing results.',
        });
      } else if ((response as any).started) {
        toast({
          title: 'Competitor discovery started',
          description:
            response.message || 'Discovery is running in the background. The shortlist will update live.',
        });
      } else {
        toast({
          title: 'Competitor discovery continued',
          description: `Top picks: ${response.summary.topPicks}, shortlisted: ${response.summary.shortlisted}`,
        });
      }

      await loadShortlist();
      onRefresh?.();
    } catch (error: any) {
      toast({
        title: 'Continue discovery failed',
        description: error?.message || 'Failed to run competitor orchestration',
        variant: 'destructive',
      });
    } finally {
      setRunningDiscovery(false);
    }
  }

  async function handleContinueSelectedScrape() {
    if (!runId) {
      toast({
        title: 'No orchestration run found',
        description: 'Run discovery first to generate shortlist candidates.',
        variant: 'destructive',
      });
      return;
    }

    if (selectedIds.size === 0) {
      toast({
        title: 'No competitors selected',
        description: 'Select at least one profile before continuing scrape.',
        variant: 'destructive',
      });
      return;
    }

    try {
      setApproving(true);
      const response = await apiClient.approveAndScrapeCompetitors(jobId, {
        runId,
        candidateProfileIds: Array.from(selectedIds),
      });

      if (!response?.success) {
        throw new Error(response?.error || 'Approve and scrape failed');
      }

      toast({
        title: 'Selected profiles queued',
        description: `Approved ${response.approvedCount}, queued ${response.queuedCount}, skipped ${response.skippedCount}`,
      });

      await loadShortlist();
      onRefresh?.();
    } catch (error: any) {
      toast({
        title: 'Continue selected scrape failed',
        description: error?.message || 'Unable to queue selected profiles',
        variant: 'destructive',
      });
    } finally {
      setApproving(false);
    }
  }

  async function handleContinuePendingScrape() {
    try {
      setContinuingPending(true);
      const response = await apiClient.continueCompetitorScrape(jobId, {
        onlyPending: true,
        runId: runId || undefined,
      });

      if (!response?.success) {
        throw new Error(response?.error || 'Continue pending scrape failed');
      }

      toast({
        title: 'Pending profiles queued',
        description: `${response.queuedCount} queued, ${response.skippedCount || 0} skipped.`,
      });
      await loadShortlist();
      onRefresh?.();
    } catch (error: any) {
      toast({
        title: 'Continue pending scrape failed',
        description: error?.message || 'Unable to queue pending profiles',
        variant: 'destructive',
      });
    } finally {
      setContinuingPending(false);
    }
  }

  async function handleContinueRowScrape(profile: OrchestratedCompetitorProfile) {
    if (!profile.discoveredCompetitorId) {
      toast({
        title: 'Profile not scrape-ready',
        description: 'This profile has not been materialized into the scrape queue yet.',
        variant: 'destructive',
      });
      return;
    }

    try {
      setContinuingByProfile((previous) => ({ ...previous, [profile.id]: true }));
      const response = await apiClient.scrapeCompetitor(profile.discoveredCompetitorId);
      if (response?.success === false) {
        throw new Error(response?.error || 'Continue scrape failed');
      }
      toast({
        title: 'Competitor scrape queued',
        description: `Queued @${profile.handle} for scraping.`,
      });
      onRefresh?.();
    } catch (error: any) {
      toast({
        title: 'Continue scrape failed',
        description: error?.message || `Unable to queue @${profile.handle}`,
        variant: 'destructive',
      });
    } finally {
      setContinuingByProfile((previous) => {
        const next = { ...previous };
        delete next[profile.id];
        return next;
      });
    }
  }

  function renderGroupCard(
    group: OrchestratedCompetitorIdentityGroup,
    section: 'top' | 'shortlist' | 'filtered'
  ) {
    return (
      <div key={`${group.identityId || group.canonicalName}`} className="rounded-md border border-border/50 bg-muted/10 p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{group.canonicalName}</span>
          <Badge variant="outline" className="h-5 text-[10px] uppercase">
            {groupHeader(group)}
          </Badge>
          <Badge variant="secondary" className="h-5 text-[10px]">
            Best {Math.round(group.bestScore * 100)}%
          </Badge>
        </div>

        <div className="space-y-2">
          {(group.profiles || []).map((profile) => {
            const checked = selectedIds.has(profile.id);
            const rowScrapeEligible = isScrapeEligible(profile);
            const rowDisabled =
              section === 'filtered' ||
              !rowScrapeEligible ||
              profile.discoveredStatus === 'SCRAPING' ||
              Boolean(continuingByProfile[profile.id]);

            return (
              <div
                key={profile.id}
                className="flex items-start gap-3 rounded border border-border/40 bg-background/40 px-3 py-2"
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={(value) => onCheckedChange(profile.id, value === true)}
                  disabled={section === 'filtered' || !rowScrapeEligible}
                  className="mt-0.5"
                />

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">@{profile.handle}</span>
                    <Badge variant="outline" className="h-5 text-[10px] uppercase">
                      {profile.platform}
                    </Badge>
                    <Badge variant="secondary" className="h-5 text-[10px]">
                      {profileScoreLabel(profile)}
                    </Badge>
                    <Badge variant={availabilityVariant(profile.availabilityStatus)} className="h-5 text-[10px] uppercase">
                      {profile.availabilityStatus.replaceAll('_', ' ')}
                    </Badge>
                    <Badge variant={selectionVariant(profile.state)} className="h-5 text-[10px] uppercase">
                      {profile.state.replaceAll('_', ' ')}
                    </Badge>
                    {profile.discoveredStatus ? (
                      <Badge variant={profile.discoveredStatus === 'SCRAPED' ? 'default' : 'secondary'} className="h-5 text-[10px] uppercase">
                        {profile.discoveredStatus}
                      </Badge>
                    ) : null}
                  </div>

                  {profile.stateReason ? (
                    <p className="mt-1 text-xs text-muted-foreground">Selection: {profile.stateReason}</p>
                  ) : null}
                  {profile.availabilityReason ? (
                    <p className="mt-1 text-xs text-muted-foreground">Availability: {profile.availabilityReason}</p>
                  ) : null}

                  <div className="mt-2">
                    {section !== 'filtered' && rowScrapeEligible ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleContinueRowScrape(profile)}
                        disabled={rowDisabled}
                        className="h-7 text-[11px]"
                        title="Continue Scrape"
                      >
                        {Boolean(continuingByProfile[profile.id]) || profile.discoveredStatus === 'SCRAPING' ? (
                          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <PlayCircle className="mr-1 h-3.5 w-3.5" />
                        )}
                        Continue Scrape
                      </Button>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">
                        Not scrape-ready: requires verified + shortlisted/approved state
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const summary = data?.summary || {
    candidatesDiscovered: 0,
    candidatesFiltered: 0,
    shortlisted: 0,
    topPicks: 0,
    profileUnavailableCount: 0,
  };

  return (
    <div className={cn('space-y-4 rounded-lg border border-border/60 bg-background/70 p-4', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="h-6 px-2 text-[11px]">
          Discovered {summary.candidatesDiscovered}
        </Badge>
        <Badge variant="secondary" className="h-6 px-2 text-[11px]">
          Shortlisted {summary.shortlisted}
        </Badge>
        <Badge variant="default" className="h-6 px-2 text-[11px]">
          Top Picks {summary.topPicks}
        </Badge>
        <Badge variant="outline" className="h-6 px-2 text-[11px]">
          Filtered {summary.candidatesFiltered}
        </Badge>
        <Badge variant="outline" className="h-6 px-2 text-[11px]">
          Unavailable {summary.profileUnavailableCount || 0}
        </Badge>
      </div>

      {data?.platformMatrix?.selected?.length ? (
        <div className="text-xs text-muted-foreground">
          Surfaces: {data.platformMatrix.selected.join(', ')}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={handleContinueDiscovery} disabled={runningDiscovery}>
          {runningDiscovery ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="mr-1 h-3.5 w-3.5" />
          )}
          Continue Discovery
        </Button>

        <Button
          size="sm"
          variant="secondary"
          onClick={handleContinueSelectedScrape}
          disabled={approving || !hasSelectableRows}
        >
          {approving ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <PlayCircle className="mr-1 h-3.5 w-3.5" />
          )}
          Continue Selected Scrape ({selectedCount})
        </Button>

        <Button
          size="sm"
          variant="outline"
          onClick={handleContinuePendingScrape}
          disabled={continuingPending}
        >
          {continuingPending ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="mr-1 h-3.5 w-3.5" />
          )}
          Continue Pending Scrape
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading shortlist...
        </div>
      ) : (
        <div className="space-y-4">
          {(data?.topPicks?.length || 0) > 0 ? (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Top Picks</h4>
              <div className="space-y-2">{(data?.topPicks || []).map((group) => renderGroupCard(group, 'top'))}</div>
            </div>
          ) : null}

          {(data?.shortlist?.length || 0) > 0 ? (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Shortlist</h4>
              <div className="space-y-2">{(data?.shortlist || []).map((group) => renderGroupCard(group, 'shortlist'))}</div>
            </div>
          ) : null}

          {(data?.filteredOut?.length || 0) > 0 ? (
            <details className="rounded-md border border-border/50 bg-muted/10 px-3 py-2">
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Filtered Out ({data?.filteredOut.length || 0})
              </summary>
              <div className="mt-2 space-y-2">{(data?.filteredOut || []).map((group) => renderGroupCard(group, 'filtered'))}</div>
            </details>
          ) : null}
        </div>
      )}
    </div>
  );
}
