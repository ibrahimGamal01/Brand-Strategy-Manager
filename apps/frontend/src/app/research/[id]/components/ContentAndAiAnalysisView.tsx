'use client';

import { useState } from 'react';
import { Brain, ImageIcon, Video, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toMediaUrl } from '@/lib/media-url';
import { apiClient } from '@/lib/api-client';
import { useToast } from '@/hooks/use-toast';
import type { MediaAnalysisScopeSummary } from '@/lib/api/types';

const MAX_ANALYSIS_WINDOW_ITEMS = 120;

type MediaAssetWithSource = {
  id: string;
  url?: string | null;
  thumbnailUrl?: string | null;
  blobStoragePath?: string | null;
  mediaType?: string;
  analysisVisual?: Record<string, unknown> | null;
  analysisTranscript?: Record<string, unknown> | null;
  analysisOverall?: Record<string, unknown> | null;
  extractedTranscript?: string | null;
  extractedOnScreenText?: Array<{ text: string; timestampSeconds?: number }> | null;
  sourceLabel: string;
  postCaption?: string | null;
  postUrl?: string | null;
};

function flattenMediaFromProfiles(socialProfiles: any[]): MediaAssetWithSource[] {
  const out: MediaAssetWithSource[] = [];
  for (const profile of socialProfiles || []) {
    const handle = profile.handle || profile.username || 'unknown';
    const platform = profile.platform || 'social';
    const label = `${platform} @${handle}`;
    for (const post of profile.posts || []) {
      const caption = post.caption ?? post.captionText ?? null;
      const postUrl = post.postUrl ?? post.url ?? null;
      for (const m of post.mediaAssets || []) {
        if (!m?.id) continue;
        out.push({
          id: m.id,
          url: m.url,
          thumbnailUrl: m.thumbnailUrl,
          blobStoragePath: m.blobStoragePath,
          mediaType: m.mediaType,
          analysisVisual: m.analysisVisual,
          analysisTranscript: m.analysisTranscript,
          analysisOverall: m.analysisOverall,
          extractedTranscript: m.extractedTranscript,
          extractedOnScreenText: m.extractedOnScreenText,
          sourceLabel: label,
          postCaption: caption,
          postUrl,
        });
      }
    }
  }
  return out;
}

function isReadySnapshot(snapshot: any): boolean {
  return String(snapshot?.readinessStatus || '').toUpperCase() === 'READY';
}

function normalizedHandle(value: unknown): string {
  return String(value || '').trim().replace(/^@+/, '').toLowerCase();
}

function buildSelectedCompetitorKeySet(discoveredCompetitors: any[] = []): Set<string> {
  const selectedStates = new Set(['TOP_PICK', 'SHORTLISTED', 'APPROVED']);
  const keys = new Set<string>();
  for (const row of discoveredCompetitors || []) {
    const state = String(row?.selectionState || '').toUpperCase();
    const platform = String(row?.platform || '').trim().toLowerCase();
    const handle = normalizedHandle(row?.handle);
    if (!selectedStates.has(state)) continue;
    if (!platform || !handle) continue;
    keys.add(`${platform}:${handle}`);
  }
  return keys;
}

function filterReadyCompetitorSnapshotsBySelection(
  snapshots: any[] = [],
  discoveredCompetitors: any[] = []
): any[] {
  const selectedKeys = buildSelectedCompetitorKeySet(discoveredCompetitors);
  if (selectedKeys.size === 0) return snapshots;
  return snapshots.filter((snapshot) => {
    const platform = String(snapshot?.competitorProfile?.platform || '').trim().toLowerCase();
    const handle = normalizedHandle(snapshot?.competitorProfile?.handle);
    return selectedKeys.has(`${platform}:${handle}`);
  });
}

function capAnalysisWindow(assets: MediaAssetWithSource[]): MediaAssetWithSource[] {
  return assets.slice(0, MAX_ANALYSIS_WINDOW_ITEMS);
}

function hasAnyAiData(asset: MediaAssetWithSource): boolean {
  return Boolean(
    asset.analysisOverall ||
      asset.analysisVisual ||
      asset.analysisTranscript ||
      (typeof asset.extractedTranscript === 'string' && asset.extractedTranscript.trim()) ||
      (Array.isArray(asset.extractedOnScreenText) && asset.extractedOnScreenText.length > 0)
  );
}

function prioritizeAssetsForWindow(assets: MediaAssetWithSource[]): MediaAssetWithSource[] {
  const analyzed = assets.filter((asset) => hasAnyAiData(asset));
  const pending = assets.filter((asset) => !hasAnyAiData(asset));
  return [...analyzed, ...pending];
}

function flattenMediaFromSnapshotPosts(
  snapshots: Array<{ posts?: Array<{ mediaAssets?: any[]; caption?: string; url?: string }>; competitorProfile?: { handle?: string; platform?: string }; clientProfile?: { handle?: string; platform?: string } }>,
  labelPrefix: string
): MediaAssetWithSource[] {
  const out: MediaAssetWithSource[] = [];
  for (const snap of snapshots || []) {
    const profile = snap.competitorProfile || snap.clientProfile;
    const handle = profile?.handle || 'unknown';
    const platform = profile?.platform || 'profile';
    const label = `${labelPrefix} ${platform} @${handle}`;
    for (const post of snap.posts || []) {
      const caption = post.caption ?? null;
      const postUrl = post.url ?? null;
      for (const m of post.mediaAssets || []) {
        if (!m?.id) continue;
        out.push({
          id: m.id,
          url: m.url,
          thumbnailUrl: m.thumbnailUrl,
          blobStoragePath: m.blobStoragePath,
          mediaType: m.mediaType,
          analysisVisual: m.analysisVisual,
          analysisTranscript: m.analysisTranscript,
          analysisOverall: m.analysisOverall,
          extractedTranscript: m.extractedTranscript,
          extractedOnScreenText: m.extractedOnScreenText,
          sourceLabel: label,
          postCaption: caption,
          postUrl,
        });
      }
    }
  }
  return out;
}

/** Deduplicate by media asset id so the same file isn't counted in both socialProfiles and snapshots. */
function deduplicateById(assets: MediaAssetWithSource[]): MediaAssetWithSource[] {
  const byId = new Map<string, MediaAssetWithSource>();
  for (const m of assets) {
    if (m.id && !byId.has(m.id)) byId.set(m.id, m);
  }
  return Array.from(byId.values());
}

/** Unique media count for tree header; same logic as view so numbers match. */
export function getDeduplicatedMediaCount(
  socialProfiles: any[],
  clientProfileSnapshots: any[] = [],
  competitorProfileSnapshots: any[] = [],
  discoveredCompetitors: any[] = []
): number {
  const readyClientSnapshots = (clientProfileSnapshots || []).filter(isReadySnapshot);
  const readyCompetitorSnapshots = filterReadyCompetitorSnapshotsBySelection(
    (competitorProfileSnapshots || []).filter(isReadySnapshot),
    discoveredCompetitors
  );
  const fromClient = flattenMediaFromSnapshotPosts(readyClientSnapshots, 'Client');
  const fromCompetitor = flattenMediaFromSnapshotPosts(readyCompetitorSnapshots, 'Competitor');
  const qualified = deduplicateById([...fromClient, ...fromCompetitor]);
  if (qualified.length > 0) return Math.min(qualified.length, MAX_ANALYSIS_WINDOW_ITEMS);
  const fromProfiles = flattenMediaFromProfiles(socialProfiles || []);
  return Math.min(deduplicateById(fromProfiles).length, MAX_ANALYSIS_WINDOW_ITEMS);
}

interface ContentAndAiAnalysisViewProps {
  jobId: string;
  socialProfiles: any[];
  clientProfileSnapshots?: any[];
  competitorProfileSnapshots?: any[];
  discoveredCompetitors?: any[];
  analysisScope?: MediaAnalysisScopeSummary | null;
  onRefresh?: () => void;
}

export function ContentAndAiAnalysisView({
  jobId,
  socialProfiles,
  clientProfileSnapshots = [],
  competitorProfileSnapshots = [],
  discoveredCompetitors = [],
  analysisScope = null,
  onRefresh,
}: ContentAndAiAnalysisViewProps) {
  const { toast } = useToast();
  const [analyzing, setAnalyzing] = useState(false);

  const readyClientSnapshots = (clientProfileSnapshots || []).filter(isReadySnapshot);
  const readyCompetitorSnapshots = filterReadyCompetitorSnapshotsBySelection(
    (competitorProfileSnapshots || []).filter(isReadySnapshot),
    discoveredCompetitors
  );
  const fromClient = flattenMediaFromSnapshotPosts(readyClientSnapshots, 'Client');
  const fromCompetitor = flattenMediaFromSnapshotPosts(readyCompetitorSnapshots, 'Competitor');
  const qualifiedSnapshotMedia = deduplicateById([...fromClient, ...fromCompetitor]);
  const analysisWindowSourceRaw =
    qualifiedSnapshotMedia.length > 0
      ? qualifiedSnapshotMedia
      : deduplicateById(flattenMediaFromProfiles(socialProfiles));
  const analysisWindowSource = prioritizeAssetsForWindow(analysisWindowSourceRaw);
  const totalWindowSourceCount = analysisWindowSource.length;
  const allMedia = capAnalysisWindow(analysisWindowSource);
  const withAnalysis = allMedia.filter((asset) => hasAnyAiData(asset));
  const hasDownloaded = allMedia.length > 0;
  const scopedMetrics = analysisScope && typeof analysisScope.downloadedTotal === 'number'
    ? analysisScope
    : null;
  const displayedDownloadedTotal = scopedMetrics?.downloadedTotal ?? totalWindowSourceCount;
  const displayedQualifiedForAi = scopedMetrics?.qualifiedForAi ?? totalWindowSourceCount;
  const displayedAnalysisWindow = scopedMetrics?.analysisWindow ?? allMedia.length;
  const displayedAnalyzedInWindow = scopedMetrics?.analyzedInWindow ?? withAnalysis.length;

  async function handleRunAnalysis() {
    try {
      setAnalyzing(true);
      const res = await apiClient.analyzeJobMedia(jobId, {
        skipAlreadyAnalyzed: true,
        limit: 20,
        maxEligibleAssets: 80,
        maxEligiblePosts: 120,
      });
      if (!res?.success) throw new Error((res as any)?.error || 'Analysis failed');
      const scope = res.analysisScope;
      toast({
        title: 'AI analysis started',
        description: scope
          ? `Requested ${res.requested}. Window ${scope.analyzedInWindow}/${scope.analysisWindow} analyzed (${scope.qualifiedForAi} qualified, ${scope.downloadedTotal} downloaded).`
          : `Requested: ${res.requested}, succeeded: ${res.succeeded}, failed: ${res.failed}. Refresh to see results.`,
      });
      onRefresh?.();
    } catch (e: any) {
      toast({
        title: 'Analysis failed',
        description: e?.message || 'Could not run AI analysis',
        variant: 'destructive',
      });
    } finally {
      setAnalyzing(false);
    }
  }

  if (!hasDownloaded) {
    return (
      <div className="rounded-md border border-border/60 bg-muted/20 p-6 text-center text-sm text-muted-foreground">
        No downloaded media for this job yet. Run scraping and media download first; then use &quot;Run AI analysis&quot; to analyze content.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {displayedAnalysisWindow} media asset(s) in analysis window
          {displayedAnalysisWindow > allMedia.length
            ? ` (showing top ${allMedia.length})`
            : ''}
          {displayedQualifiedForAi > 0 || displayedDownloadedTotal > 0
            ? ` (qualified ${displayedQualifiedForAi}, downloaded ${displayedDownloadedTotal})`
            : ''}
          {' · '}
          {displayedAnalyzedInWindow} with AI analysis
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={handleRunAnalysis}
          disabled={analyzing}
          className="gap-2"
        >
          <RefreshCw className={analyzing ? 'animate-spin h-3.5 w-3.5' : 'h-3.5 w-3.5'} />
          {analyzing ? 'Running...' : 'Run AI analysis'}
        </Button>
      </div>
      <div className="space-y-4">
        {allMedia.map((asset) => {
          const hasAny = hasAnyAiData(asset);
          const mediaUrl = toMediaUrl(asset.url || asset.blobStoragePath);
          const thumbUrl = toMediaUrl(asset.thumbnailUrl || asset.url || asset.blobStoragePath);
          const isVideo = (asset.mediaType || asset.blobStoragePath || '').toLowerCase().includes('video') || (asset.blobStoragePath || '').match(/\.(mp4|webm|mov)$/i);

          return (
            <div
              key={asset.id}
              className="rounded-lg border border-border/60 bg-card overflow-hidden"
            >
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4">
                <div className="space-y-1">
                  <div className="aspect-square bg-muted rounded-md overflow-hidden flex items-center justify-center">
                    {mediaUrl || thumbUrl ? (
                      isVideo ? (
                        <video
                          src={mediaUrl || thumbUrl}
                          className="w-full h-full object-cover"
                          preload="metadata"
                          controls
                          playsInline
                        />
                      ) : (
                        <img
                          src={thumbUrl || mediaUrl}
                          alt=""
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      )
                    ) : (
                      <div className="text-muted-foreground">
                        {isVideo ? <Video className="h-10 w-10" /> : <ImageIcon className="h-10 w-10" />}
                      </div>
                    )}
                  </div>
                  <p className="text-[10px] font-medium text-foreground/80">{asset.sourceLabel}</p>
                  {asset.postCaption && (
                    <p className="text-[10px] text-muted-foreground line-clamp-2">{asset.postCaption}</p>
                  )}
                  {asset.postUrl && (
                    <a
                      href={asset.postUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-primary hover:underline"
                    >
                      View post
                    </a>
                  )}
                </div>
                <div className="md:col-span-2 space-y-3 text-xs">
                  {!hasAny && (
                    <p className="text-muted-foreground">No AI analysis yet. Run AI analysis to analyze this asset.</p>
                  )}
                  {asset.analysisOverall && (
                    <div>
                      <span className="font-semibold text-foreground/90 flex items-center gap-1">
                        <Brain className="h-3.5 w-3.5" /> Overall
                      </span>
                      <pre className="mt-1 p-2 rounded bg-muted/50 text-[10px] whitespace-pre-wrap wrap-break-word max-h-32 overflow-auto">
                        {JSON.stringify(asset.analysisOverall, null, 2)}
                      </pre>
                    </div>
                  )}
                  {asset.analysisVisual && (
                    <div>
                      <span className="font-semibold text-foreground/90">Visual</span>
                      <pre className="mt-1 p-2 rounded bg-muted/50 text-[10px] whitespace-pre-wrap wrap-break-word max-h-28 overflow-auto">
                        {JSON.stringify(asset.analysisVisual, null, 2)}
                      </pre>
                    </div>
                  )}
                  {asset.analysisTranscript && (
                    <div>
                      <span className="font-semibold text-foreground/90">Transcript</span>
                      <pre className="mt-1 p-2 rounded bg-muted/50 text-[10px] whitespace-pre-wrap wrap-break-word max-h-28 overflow-auto">
                        {JSON.stringify(asset.analysisTranscript, null, 2)}
                      </pre>
                    </div>
                  )}
                  {typeof asset.extractedTranscript === 'string' && asset.extractedTranscript.trim() && (
                    <div>
                      <span className="font-semibold text-foreground/90">Extracted transcript</span>
                      <p className="mt-1 p-2 rounded bg-muted/50 text-[10px] whitespace-pre-wrap wrap-break-word max-h-24 overflow-auto">
                        {asset.extractedTranscript.trim()}
                      </p>
                    </div>
                  )}
                  {Array.isArray(asset.extractedOnScreenText) && asset.extractedOnScreenText.length > 0 && (
                    <div>
                      <span className="font-semibold text-foreground/90">On-screen text</span>
                      <ul className="mt-1 p-2 rounded bg-muted/50 space-y-1 text-[10px] max-h-24 overflow-auto">
                        {asset.extractedOnScreenText.map((e, i) => (
                          <li key={i}>
                            {e.text}
                            {e.timestampSeconds != null && (
                              <span className="text-muted-foreground"> @ {e.timestampSeconds}s</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
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
