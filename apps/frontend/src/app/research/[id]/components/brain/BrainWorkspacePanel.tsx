'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';

type BrainPayload = {
  success: boolean;
  client?: { id: string; name: string };
  brainProfile?: Record<string, any> | null;
  commandHistory?: Array<Record<string, any>>;
  competitorSummary?: Record<string, any>;
};

interface BrainWorkspacePanelProps {
  jobId: string;
  className?: string;
  onRefresh?: () => void;
}

export function BrainWorkspacePanel({ jobId, className, onRefresh }: BrainWorkspacePanelProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [submittingCommand, setSubmittingCommand] = useState(false);
  const [applyingCommandId, setApplyingCommandId] = useState<string | null>(null);
  const [brain, setBrain] = useState<BrainPayload | null>(null);
  const [profileDraft, setProfileDraft] = useState({
    businessType: '',
    offerModel: '',
    primaryGoal: '',
    targetMarket: '',
    geoScope: '',
    websiteDomain: '',
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

  async function loadBrain() {
    try {
      setLoading(true);
      const payload = (await apiClient.getBrain(jobId)) as BrainPayload;
      setBrain(payload);
      const profile = payload?.brainProfile || {};
      setProfileDraft({
        businessType: String(profile.businessType || ''),
        offerModel: String(profile.offerModel || ''),
        primaryGoal: String(profile.primaryGoal || ''),
        targetMarket: String(profile.targetMarket || ''),
        geoScope: String(profile.geoScope || ''),
        websiteDomain: String(profile.websiteDomain || ''),
      });
    } catch (error: any) {
      toast({
        title: 'Failed to load brain context',
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

  async function handleSaveProfile() {
    if (!brain?.client?.id) return;
    try {
      setSavingProfile(true);
      const result = await apiClient.updateBrainProfile(brain.client.id, profileDraft);
      if (!result?.success) throw new Error(result?.error || 'Failed to update profile');
      toast({
        title: 'Brain profile saved',
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
        description: 'Brain command executed successfully.',
      });
      await loadBrain();
      onRefresh?.();
    } catch (error: any) {
      toast({
        title: 'Apply failed',
        description: error?.message || 'Failed to apply command',
        variant: 'destructive',
      });
    } finally {
      setApplyingCommandId(null);
    }
  }

  if (loading && !brain) {
    return <div className="rounded-lg border border-border/60 bg-card/40 p-4 text-sm text-muted-foreground">Loading brain...</div>;
  }

  return (
    <section className={`space-y-4 rounded-lg border border-border/60 bg-card/40 p-4 ${className || ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">Brain Workspace</h3>
        <Badge variant="outline" className="text-[10px] uppercase">Assist Mode</Badge>
        {brain?.competitorSummary ? (
          <Badge variant="secondary" className="text-[10px]">
            Top Picks {Number(brain.competitorSummary.topPicks || 0)}
          </Badge>
        ) : null}
      </div>

      <div className="grid gap-2 md:grid-cols-3">
        <Input value={profileDraft.businessType} onChange={(e) => setProfileDraft((s) => ({ ...s, businessType: e.target.value }))} placeholder="Business type" />
        <Input value={profileDraft.offerModel} onChange={(e) => setProfileDraft((s) => ({ ...s, offerModel: e.target.value }))} placeholder="Offer model" />
        <Input value={profileDraft.primaryGoal} onChange={(e) => setProfileDraft((s) => ({ ...s, primaryGoal: e.target.value }))} placeholder="Primary goal" />
        <Input value={profileDraft.targetMarket} onChange={(e) => setProfileDraft((s) => ({ ...s, targetMarket: e.target.value }))} placeholder="Target market" />
        <Input value={profileDraft.geoScope} onChange={(e) => setProfileDraft((s) => ({ ...s, geoScope: e.target.value }))} placeholder="Geo scope" />
        <Input value={profileDraft.websiteDomain} onChange={(e) => setProfileDraft((s) => ({ ...s, websiteDomain: e.target.value }))} placeholder="Website domain" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={handleSaveProfile} disabled={savingProfile}>
          {savingProfile ? 'Saving...' : 'Save Brain Profile'}
        </Button>
      </div>

      <div className="space-y-2 rounded-md border border-border/50 bg-background/40 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={commandDraft.section}
            onChange={(e) => setCommandDraft((s) => ({ ...s, section: e.target.value }))}
            placeholder="Section (competitors, trends, ...)"
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
          placeholder="Ask Brain to add/remove competitors, run a section, or update data..."
          className="min-h-[72px]"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={handleSubmitCommand} disabled={submittingCommand}>
            {submittingCommand ? 'Submitting...' : 'Send Brain Command'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setCommandDraft((s) => ({ ...s, instruction: `Add competitor @ on instagram` }))}
          >
            Quick Add Competitor
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setCommandDraft((s) => ({ ...s, instruction: `Remove competitor @ from instagram` }))}
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
                <Badge variant="outline" className="text-[10px] uppercase">{String(command.section || 'section')}</Badge>
                <Badge variant="secondary" className="text-[10px] uppercase">{String(command.commandType || 'COMMAND')}</Badge>
                <Badge variant={String(command.status) === 'APPLIED' ? 'default' : 'outline'} className="text-[10px] uppercase">
                  {String(command.status || 'PENDING')}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">{String(command.instruction || '')}</p>
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
    </section>
  );
}
