'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { JsonViewer } from '@/components/ui/json-viewer';
import { useToast } from '@/hooks/use-toast';

type BrainSuggestion = {
  id: string;
  field: string;
  proposedValue?: unknown;
  reason?: string | null;
  source: string;
  status: string;
  createdAt?: string;
  resolvedAt?: string | null;
  resolvedBy?: string | null;
};

type BrainPayload = {
  success: boolean;
  client?: { id: string; name: string; accounts?: Array<Record<string, any>> };
  brainProfile?: Record<string, any> | null;
  commandHistory?: Array<Record<string, any>>;
  suggestions?: BrainSuggestion[];
  competitorSummary?: Record<string, any>;
};

interface BrainWorkspacePanelProps {
  jobId: string;
  className?: string;
  onRefresh?: () => void;
}

function parseCsv(value: string): string[] {
  return String(value || '')
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatJson(value: unknown): string {
  if (value === null || value === undefined) return '';
  try {
    if (typeof value === 'string') return value;
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

type ChannelDraftItem = { platform: string; handle: string };

function formatChannelsForInput(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value
    .map((entry) => {
      if (entry && typeof entry === 'object') {
        const platform = String((entry as Record<string, unknown>).platform || '').trim().toLowerCase();
        const handle = String((entry as Record<string, unknown>).handle || '').trim().replace(/^@+/, '');
        if (platform && handle) return `${platform}:@${handle}`;
      }
      if (typeof entry === 'string') return entry.trim();
      return null;
    })
    .filter(Boolean)
    .join(', ');
}

function normalizePlatformHost(hostname: string): string | null {
  const host = String(hostname || '').replace(/^www\./i, '').toLowerCase();
  if (host.includes('instagram.com')) return 'instagram';
  if (host.includes('tiktok.com')) return 'tiktok';
  if (host.includes('youtube.com')) return 'youtube';
  if (host.includes('x.com') || host.includes('twitter.com')) return 'x';
  if (host.includes('linkedin.com')) return 'linkedin';
  if (host.includes('facebook.com')) return 'facebook';
  return null;
}

function parseChannelToken(token: string): ChannelDraftItem | null {
  const raw = String(token || '').trim();
  if (!raw) return null;

  const pair = raw.match(
    /^(instagram|tiktok|youtube|linkedin|facebook|x|twitter)\s*[:=\-]?\s*@?([a-z0-9._-]{1,80})$/i
  );
  if (pair) {
    const platform = pair[1].toLowerCase() === 'twitter' ? 'x' : pair[1].toLowerCase();
    const handle = pair[2].replace(/^@+/, '').toLowerCase();
    return { platform, handle };
  }

  const normalizedUrl = /^[a-z]+:\/\//i.test(raw)
    ? raw
    : /^[a-z0-9.-]+\.[a-z]{2,}/i.test(raw)
      ? `https://${raw}`
      : null;
  if (normalizedUrl) {
    try {
      const parsed = new URL(normalizedUrl);
      const platform = normalizePlatformHost(parsed.hostname);
      if (!platform) return null;
      const firstPath = parsed.pathname
        .split('/')
        .map((part) => part.trim())
        .filter(Boolean)[0];
      if (!firstPath) return null;
      const handle = firstPath.replace(/^@+/, '').toLowerCase();
      if (!handle) return null;
      return { platform, handle };
    } catch {
      return null;
    }
  }

  return null;
}

function parseChannels(value: string): ChannelDraftItem[] {
  const seen = new Set<string>();
  const out: ChannelDraftItem[] = [];

  for (const token of parseCsv(value)) {
    const parsed = parseChannelToken(token);
    if (!parsed) continue;
    const key = `${parsed.platform}:${parsed.handle}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(parsed);
  }

  return out;
}

export function BrainWorkspacePanel({ jobId, className, onRefresh }: BrainWorkspacePanelProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [submittingCommand, setSubmittingCommand] = useState(false);
  const [syncingFromIntake, setSyncingFromIntake] = useState(false);
  const [applyingCommandId, setApplyingCommandId] = useState<string | null>(null);
  const [resolvingSuggestionId, setResolvingSuggestionId] = useState<string | null>(null);
  const [brain, setBrain] = useState<BrainPayload | null>(null);
  const [profileDraft, setProfileDraft] = useState({
    businessType: '',
    offerModel: '',
    primaryGoal: '',
    targetMarket: '',
    geoScope: '',
    websiteDomain: '',
    secondaryGoals: '',
    channels: '',
    constraintsJson: '',
  });
  const [commandDraft, setCommandDraft] = useState({
    section: 'competitors',
    instruction: '',
    dryRun: true,
  });

  const commands = brain?.commandHistory || [];
  const pendingCommands = useMemo(
    () => commands.filter((command) => String(command.status || '') === 'PENDING'),
    [commands]
  );

  const brainProfile = (brain?.brainProfile || {}) as Record<string, any>;
  const goals = Array.isArray(brainProfile?.goals) ? brainProfile.goals : [];
  const suggestions = brain?.suggestions || [];
  const pendingSuggestions = useMemo(
    () => suggestions.filter((s) => String(s.status || '') === 'PENDING'),
    [suggestions]
  );
  const meta = (brainProfile?.meta || {}) as Record<string, unknown>;
  const autoFilledFields = (Array.isArray(meta?.autoFilledFields) ? meta.autoFilledFields : []) as string[];
  const isAutoFilled = (field: string) => autoFilledFields.includes(field);

  async function loadBrain(resyncFromIntake = false) {
    try {
      setLoading(true);
      const payload = (await apiClient.getBrain(jobId, resyncFromIntake ? { resync: true } : undefined)) as BrainPayload;
      setBrain(payload);
      const profile = payload?.brainProfile || {};
      setProfileDraft({
        businessType: String(profile.businessType || ''),
        offerModel: String(profile.offerModel || ''),
        primaryGoal: String(profile.primaryGoal || ''),
        targetMarket: String(profile.targetMarket || ''),
        geoScope: String(profile.geoScope || ''),
        websiteDomain: String(profile.websiteDomain || ''),
        secondaryGoals: Array.isArray(profile.secondaryGoals) ? profile.secondaryGoals.join(', ') : '',
        channels: formatChannelsForInput(profile.channels),
        constraintsJson: formatJson(profile.constraints),
      });
    } catch (error: any) {
      toast({
        title: 'Failed to load BAT Brain context',
        description: error?.message || 'Unable to fetch brain data',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadBrain();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  // Periodic refetch so orchestrator-driven suggestions and auto-filled data appear without manual refresh
  useEffect(() => {
    const intervalMs = 45 * 1000;
    const t = setInterval(() => {
      void loadBrain();
    }, intervalMs);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  async function handleSyncFromIntake() {
    try {
      setSyncingFromIntake(true);
      await loadBrain(true);
      toast({
        title: 'Synced from intake',
        description: 'Profile repopulated from client intake data and research job inputData.',
      });
      onRefresh?.();
    } catch (error: any) {
      toast({
        title: 'Sync failed',
        description: error?.message || 'Could not sync from intake data',
        variant: 'destructive',
      });
    } finally {
      setSyncingFromIntake(false);
    }
  }

  async function handleSaveProfile() {
    if (!brain?.client?.id) return;

    let constraints: Record<string, unknown> | undefined;
    if (profileDraft.constraintsJson.trim()) {
      try {
        constraints = JSON.parse(profileDraft.constraintsJson);
      } catch {
        toast({
          title: 'Invalid constraints JSON',
          description: 'Constraints must be valid JSON before saving.',
          variant: 'destructive',
        });
        return;
      }
    }

    try {
      setSavingProfile(true);
      const result = await apiClient.updateBrainProfile(brain.client.id, {
        businessType: profileDraft.businessType,
        offerModel: profileDraft.offerModel,
        primaryGoal: profileDraft.primaryGoal,
        targetMarket: profileDraft.targetMarket,
        geoScope: profileDraft.geoScope,
        websiteDomain: profileDraft.websiteDomain,
        secondaryGoals: parseCsv(profileDraft.secondaryGoals),
        channels: parseChannels(profileDraft.channels),
        constraints,
      });
      if (!result?.success) throw new Error(result?.error || 'Failed to update profile');
      toast({
        title: 'BAT Brain profile saved',
        description: 'Business context updated successfully.',
      });
      await loadBrain();
      onRefresh?.();
    } catch (error: any) {
      toast({
        title: 'Save failed',
        description: error?.message || 'Failed to save brain profile',
        variant: 'destructive',
      });
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleSubmitCommand() {
    const instruction = commandDraft.instruction.trim();
    if (!instruction) {
      toast({
        title: 'Instruction required',
        description: 'Add a command instruction before submitting.',
        variant: 'destructive',
      });
      return;
    }

    try {
      setSubmittingCommand(true);
      const response = await apiClient.createBrainCommand(jobId, {
        section: commandDraft.section,
        instruction,
        dryRun: commandDraft.dryRun,
      });
      if (!response?.success) throw new Error(response?.error || 'Failed to create command');
      toast({
        title: commandDraft.dryRun ? 'Dry-run command created' : 'Command submitted',
        description: response?.requiresApproval
          ? 'Patch proposal generated. Apply from command history.'
          : 'Command recorded and applied policy evaluated.',
      });
      setCommandDraft((current) => ({ ...current, instruction: '' }));
      await loadBrain();
    } catch (error: any) {
      toast({
        title: 'Command failed',
        description: error?.message || 'Failed to create brain command',
        variant: 'destructive',
      });
    } finally {
      setSubmittingCommand(false);
    }
  }

  async function handleApplyCommand(commandId: string) {
    try {
      setApplyingCommandId(commandId);
      const response = await apiClient.applyBrainCommand(jobId, commandId);
      if (!response?.success) throw new Error(response?.error || 'Failed to apply command');
      toast({
        title: 'Command applied',
        description: 'BAT Brain command executed successfully.',
      });
      await loadBrain();
      onRefresh?.();
    } catch (error: any) {
      toast({
        title: 'Apply failed',
        description: error?.message || 'Failed to apply brain command',
        variant: 'destructive',
      });
    } finally {
      setApplyingCommandId(null);
    }
  }

  async function handleAcceptSuggestion(suggestionId: string) {
    try {
      setResolvingSuggestionId(suggestionId);
      const response = await apiClient.acceptBrainSuggestion(jobId, suggestionId);
      if (!response?.success) throw new Error(response?.error || 'Failed to accept suggestion');
      if (response.brainProfile) {
        setBrain((prev) => (prev ? { ...prev, brainProfile: response.brainProfile! } : null));
        const profile = response.brainProfile as Record<string, unknown>;
        setProfileDraft({
          businessType: String(profile.businessType ?? ''),
          offerModel: String(profile.offerModel ?? ''),
          primaryGoal: String(profile.primaryGoal ?? ''),
          targetMarket: String(profile.targetMarket ?? ''),
          geoScope: String(profile.geoScope ?? ''),
          websiteDomain: String(profile.websiteDomain ?? ''),
          secondaryGoals: Array.isArray(profile.secondaryGoals) ? (profile.secondaryGoals as string[]).join(', ') : '',
          channels: formatChannelsForInput(profile.channels),
          constraintsJson: formatJson(profile.constraints),
        });
      }
      toast({ title: 'Suggestion applied', description: 'Brain field updated from BAT suggestion.' });
      await loadBrain();
      onRefresh?.();
    } catch (error: any) {
      toast({
        title: 'Accept failed',
        description: error?.message || 'Failed to accept suggestion',
        variant: 'destructive',
      });
    } finally {
      setResolvingSuggestionId(null);
    }
  }

  async function handleRejectSuggestion(suggestionId: string) {
    try {
      setResolvingSuggestionId(suggestionId);
      const response = await apiClient.rejectBrainSuggestion(jobId, suggestionId);
      if (!response?.success) throw new Error(response?.error || 'Failed to reject suggestion');
      toast({ title: 'Suggestion rejected', description: 'BAT suggestion dismissed.' });
      await loadBrain();
    } catch (error: any) {
      toast({
        title: 'Reject failed',
        description: error?.message || 'Failed to reject suggestion',
        variant: 'destructive',
      });
    } finally {
      setResolvingSuggestionId(null);
    }
  }

  function SourceBadge({ field }: { field: string }) {
    const byBAT = isAutoFilled(field);
    return (
      <span
        className="ml-1 text-[10px] font-normal normal-case text-muted-foreground"
        title={byBAT ? 'Filled by BAT from research' : 'Filled by you'}
      >
        {byBAT ? 'BAT' : 'You'}
      </span>
    );
  }

  if (loading && !brain) {
    return (
      <div className="rounded-lg border border-border/60 bg-card/40 p-4 text-sm text-muted-foreground">
        Loading BAT Brain...
      </div>
    );
  }

  return (
    <section className={`space-y-4 rounded-xl border border-border/60 bg-card/50 p-4 ${className || ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">BAT Brain Workspace</h3>
        <Badge variant="outline" className="text-[10px] uppercase">
          Assist Mode
        </Badge>
        {brain?.competitorSummary ? (
          <>
            <Badge variant="secondary" className="text-[10px]">
              Top Picks {Number(brain.competitorSummary.topPicks || 0)}
            </Badge>
            <Badge variant="outline" className="text-[10px] uppercase">
              Shortlist {Number(brain.competitorSummary.shortlisted || 0)}
            </Badge>
          </>
        ) : null}
      </div>

      <div className="grid gap-2 md:grid-cols-3">
        <div className="space-y-1">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <span>Business type</span>
            <SourceBadge field="businessType" />
          </div>
          <Input
            value={profileDraft.businessType}
            onChange={(e) => setProfileDraft((s) => ({ ...s, businessType: e.target.value }))}
            placeholder="Business type"
          />
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <span>Offer model</span>
            <SourceBadge field="offerModel" />
          </div>
          <Input
            value={profileDraft.offerModel}
            onChange={(e) => setProfileDraft((s) => ({ ...s, offerModel: e.target.value }))}
            placeholder="Offer model"
          />
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <span>Primary goal</span>
            <SourceBadge field="primaryGoal" />
          </div>
          <Input
            value={profileDraft.primaryGoal}
            onChange={(e) => setProfileDraft((s) => ({ ...s, primaryGoal: e.target.value }))}
            placeholder="Primary goal"
          />
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <span>Target market</span>
            <SourceBadge field="targetMarket" />
          </div>
          <Input
            value={profileDraft.targetMarket}
            onChange={(e) => setProfileDraft((s) => ({ ...s, targetMarket: e.target.value }))}
            placeholder="Target market"
          />
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <span>Geo scope</span>
            <SourceBadge field="geoScope" />
          </div>
          <Input
            value={profileDraft.geoScope}
            onChange={(e) => setProfileDraft((s) => ({ ...s, geoScope: e.target.value }))}
            placeholder="Geo scope"
          />
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <span>Website domain</span>
            <SourceBadge field="websiteDomain" />
          </div>
          <Input
            value={profileDraft.websiteDomain}
            onChange={(e) => setProfileDraft((s) => ({ ...s, websiteDomain: e.target.value }))}
            placeholder="Website domain"
          />
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        <div className="space-y-1">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <span>Secondary goals</span>
            <SourceBadge field="secondaryGoals" />
          </div>
          <Input
            value={profileDraft.secondaryGoals}
            onChange={(e) => setProfileDraft((s) => ({ ...s, secondaryGoals: e.target.value }))}
            placeholder="Secondary goals (comma separated)"
          />
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <span>Channels</span>
            <SourceBadge field="channels" />
          </div>
          <Input
            value={profileDraft.channels}
            onChange={(e) => setProfileDraft((s) => ({ ...s, channels: e.target.value }))}
            placeholder="Channels (comma separated)"
          />
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span>Constraints</span>
          <SourceBadge field="constraints" />
        </div>
        <Textarea
          value={profileDraft.constraintsJson}
          onChange={(e) => setProfileDraft((s) => ({ ...s, constraintsJson: e.target.value }))}
          placeholder="Constraints JSON"
          className="min-h-[84px] font-mono text-xs"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={handleSaveProfile} disabled={savingProfile}>
          {savingProfile ? 'Saving...' : 'Save BAT Brain Profile'}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleSyncFromIntake}
          disabled={syncingFromIntake}
          title="Repopulate profile from intake form data stored in the database"
        >
          {syncingFromIntake ? 'Syncing...' : 'Sync from intake'}
        </Button>
      </div>

      {pendingSuggestions.length > 0 ? (
        <div className="space-y-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Suggested updates ({pendingSuggestions.length})
          </p>
          <div className="space-y-2">
            {pendingSuggestions.map((suggestion) => {
              const valueStr =
                typeof suggestion.proposedValue === 'string'
                  ? suggestion.proposedValue
                  : suggestion.proposedValue != null
                    ? JSON.stringify(suggestion.proposedValue)
                    : '—';
              return (
                <div
                  key={suggestion.id}
                  className="rounded border border-border/40 bg-background/50 p-2"
                >
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="text-[10px] uppercase">
                      {suggestion.field}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">Source: {suggestion.source}</span>
                  </div>
                  <p className="mb-1 text-xs text-foreground line-clamp-2">{valueStr}</p>
                  {suggestion.reason ? (
                    <p className="mb-2 text-[11px] text-muted-foreground">{suggestion.reason}</p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="default"
                      className="h-7 text-[11px]"
                      onClick={() => handleAcceptSuggestion(suggestion.id)}
                      disabled={resolvingSuggestionId === suggestion.id}
                    >
                      {resolvingSuggestionId === suggestion.id ? 'Applying...' : 'Accept'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-[11px]"
                      onClick={() => handleRejectSuggestion(suggestion.id)}
                      disabled={resolvingSuggestionId === suggestion.id}
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {goals.length > 0 ? (
        <div className="space-y-2 rounded-md border border-border/50 bg-background/40 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Brain Goals ({goals.length})</p>
          <div className="space-y-2">
            {goals.slice(0, 8).map((goal: Record<string, any>) => (
              <div key={String(goal.id || goal.goalType)} className="rounded border border-border/40 bg-background/50 p-2">
                <div className="flex items-center gap-2 text-xs">
                  <Badge variant="outline" className="text-[10px] uppercase">
                    {String(goal.goalType || 'goal')}
                  </Badge>
                  <span className="text-muted-foreground">Priority {Number(goal.priority || 1)}</span>
                </div>
                {goal.targetMetric || goal.targetValue ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {String(goal.targetMetric || 'Target')}: {String(goal.targetValue || 'N/A')}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="space-y-2 rounded-md border border-border/50 bg-background/40 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={commandDraft.section}
            onChange={(e) => setCommandDraft((s) => ({ ...s, section: e.target.value }))}
            placeholder="Section (competitors, trends, strategy_docs...)"
            className="h-8 w-56"
          />
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={commandDraft.dryRun}
              onChange={(e) => setCommandDraft((s) => ({ ...s, dryRun: e.target.checked }))}
            />
            Dry run
          </label>
        </div>
        <Textarea
          value={commandDraft.instruction}
          onChange={(e) => setCommandDraft((s) => ({ ...s, instruction: e.target.value }))}
          placeholder="Ask BAT Brain to add/remove competitors, run a section, or update context..."
          className="min-h-[72px]"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={handleSubmitCommand} disabled={submittingCommand}>
            {submittingCommand ? 'Submitting...' : 'Send BAT Brain Command'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setCommandDraft((s) => ({ ...s, instruction: 'Add competitor @example on instagram' }))}
          >
            Quick Add Competitor
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setCommandDraft((s) => ({ ...s, instruction: 'Remove competitor @example from instagram' }))}
          >
            Quick Remove Competitor
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Pending Commands ({pendingCommands.length})
        </p>
        <div className="space-y-2">
          {commands.slice(0, 20).map((command) => (
            <div key={String(command.id)} className="rounded border border-border/40 bg-background/50 p-2">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="text-[10px] uppercase">
                  {String(command.section || 'section')}
                </Badge>
                <Badge variant="secondary" className="text-[10px] uppercase">
                  {String(command.commandType || 'COMMAND')}
                </Badge>
                <Badge
                  variant={String(command.status) === 'APPLIED' ? 'default' : 'outline'}
                  className="text-[10px] uppercase"
                >
                  {String(command.status || 'PENDING')}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">{String(command.instruction || '')}</p>
              {command.replyText ? (
                <p className="mt-1.5 text-xs text-foreground/90 italic border-l-2 border-primary/40 pl-2">
                  BAT: {String(command.replyText)}
                </p>
              ) : null}
              {String(command.status || '') === 'PENDING' ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2 h-7 text-[11px]"
                  onClick={() => handleApplyCommand(String(command.id))}
                  disabled={applyingCommandId === String(command.id)}
                >
                  {applyingCommandId === String(command.id) ? 'Applying...' : 'Apply Command'}
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      <JsonViewer
        data={{
          client: brain?.client,
          brainProfile: brain?.brainProfile,
          suggestionsCount: suggestions.length,
          pendingSuggestionsCount: pendingSuggestions.length,
          competitorSummary: brain?.competitorSummary,
          commandHistorySize: commands.length,
        }}
        title="BAT Brain Payload Snapshot"
      />
    </section>
  );
}
