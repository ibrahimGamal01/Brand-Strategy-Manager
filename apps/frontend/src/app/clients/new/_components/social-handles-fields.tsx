import { PLATFORMS, PlatformId } from './platforms';

export interface SuggestedHandleValidationItem {
  handle: string;
  isLikelyClient: boolean;
  confidence: number;
  reason: string;
}

interface SocialHandlesFieldsProps {
  handles: Record<PlatformId, string>;
  onChange: (platform: PlatformId, value: string) => void;
  /** Platforms that were suggested by the orchestrator (e.g. TikTok from Instagram or discovered from website). */
  suggestedPlatforms?: Set<string>;
  /** Validation for suggested handles so we can show "Likely your account" or "Please confirm." */
  suggestedHandleValidation?: {
    instagram?: SuggestedHandleValidationItem;
    tiktok?: SuggestedHandleValidationItem;
  };
}

export function getFilledHandlesCount(handles: Record<PlatformId, string>): number {
  return Object.values(handles).filter((value) => String(value || '').trim().length > 0).length;
}

export function getFilledHandlesList(handles: Record<PlatformId, string>): string[] {
  return Object.values(handles)
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .map((value) => (value.startsWith('@') ? value : `@${value}`));
}

function extractHandleFromUrlOrRaw(platform: PlatformId, value: string): string {
  const raw = String(value || '').trim();
  if (!raw) return '';

  if (platform === 'instagram') {
    const m = raw.match(/instagram\.com\/([a-z0-9._]{2,30})/i);
    if (m) return m[1].toLowerCase();
  }
  if (platform === 'tiktok') {
    const m = raw.match(/tiktok\.com\/@?([a-z0-9._]{2,30})/i);
    if (m) return m[1].toLowerCase();
  }

  return raw.replace(/^@+/, '').trim().toLowerCase();
}

export function buildChannelsFromHandles(handles: Record<PlatformId, string>): Array<{ platform: PlatformId; handle: string }> {
  return Object.entries(handles)
    .map(([platform, handle]) => ({
      platform: platform as PlatformId,
      handle: extractHandleFromUrlOrRaw(platform as PlatformId, handle),
    }))
    .filter((row) => row.handle.length > 0);
}

function SuggestedBadge({ tone = 'default' }: { tone?: 'default' | 'warn' }) {
  if (tone === 'warn') {
    return (
      <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-normal uppercase">
        Needs review
      </span>
    );
  }
  return (
    <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 font-normal uppercase">
      Suggested
    </span>
  );
}

function getConfidenceLabel(validation: SuggestedHandleValidationItem): string {
  const score = Number(validation.confidence || 0);
  if (score >= 0.75) return 'Likely your account';
  if (score >= 0.45) return 'Please confirm';
  return 'Unreliable suggestion';
}

function getSuggestionTone(validation?: SuggestedHandleValidationItem): 'default' | 'warn' {
  if (!validation) return 'warn';
  if (!validation.isLikelyClient || validation.confidence < 0.75) return 'warn';
  return 'default';
}

export function SocialHandlesFields({ handles, onChange, suggestedPlatforms, suggestedHandleValidation }: SocialHandlesFieldsProps) {
  const filledCount = getFilledHandlesCount(handles);

  return (
    <div>
      <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-3">
        Active Channels
        <span className="text-zinc-600 font-normal ml-2">({filledCount} added)</span>
      </label>

      <div className="grid gap-3">
        {PLATFORMS.map((platform) => {
          const Icon = platform.icon;
          const value = String(handles[platform.id] || '');
          const hasValue = value.trim().length > 0;
          const isSuggested = suggestedPlatforms?.has(platform.id);
          const validation = platform.id === 'instagram' ? suggestedHandleValidation?.instagram : platform.id === 'tiktok' ? suggestedHandleValidation?.tiktok : undefined;
          const tone = getSuggestionTone(validation);

          return (
            <div key={platform.id} className="relative">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-xs font-medium text-zinc-500">
                  {platform.name}
                  {isSuggested ? <SuggestedBadge tone={tone} /> : null}
                </span>
              </div>
              <div className="relative">
                <div
                  className={`absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none ${
                    hasValue ? 'text-white' : 'text-zinc-600'
                  }`}
                >
                  <Icon size={18} />
                </div>
                <input
                  type="text"
                  value={value}
                  onChange={(e) => onChange(platform.id, e.target.value)}
                  className={`w-full bg-zinc-900 border rounded-lg pl-10 pr-4 py-2.5 text-white placeholder-zinc-600 focus:outline-none transition-all font-mono text-sm ${
                    hasValue
                      ? 'border-zinc-600 ring-1 ring-zinc-600/50'
                      : 'border-zinc-800 focus:ring-2 focus:ring-zinc-500/50'
                  }`}
                  placeholder={`@${platform.placeholder} (${platform.name})`}
                />
                {(hasValue || isSuggested) ? (
                  <div className="absolute inset-y-0 right-0 pr-3 flex items-center gap-1.5">
                    {hasValue ? <span className="text-xs text-green-500">✓</span> : null}
                    {isSuggested ? (
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded uppercase ${
                          tone === 'warn' ? 'bg-amber-500/20 text-amber-400' : 'bg-blue-500/20 text-blue-400'
                        }`}
                      >
                        {tone === 'warn' ? 'Needs review' : 'Suggested'}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
              {validation?.reason ? (
                <p className={`text-xs mt-1.5 ml-1 ${validation.isLikelyClient ? 'text-green-500/90' : 'text-zinc-500'}`}>
                  {getConfidenceLabel(validation)} - {validation.reason}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      <p className="text-xs text-zinc-600 mt-2 ml-1">
        Add at least one profile. Discovery is cross-surface and adapts to your business context.
      </p>
    </div>
  );
}
