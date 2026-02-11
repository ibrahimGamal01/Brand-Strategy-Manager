import { PLATFORMS, PlatformId } from './platforms';

interface SocialHandlesFieldsProps {
  handles: Record<PlatformId, string>;
  onChange: (platform: PlatformId, value: string) => void;
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

export function buildChannelsFromHandles(handles: Record<PlatformId, string>): Array<{ platform: PlatformId; handle: string }> {
  return Object.entries(handles)
    .map(([platform, handle]) => ({
      platform: platform as PlatformId,
      handle: String(handle || '').trim().replace(/^@+/, ''),
    }))
    .filter((row) => row.handle.length > 0);
}

export function SocialHandlesFields({ handles, onChange }: SocialHandlesFieldsProps) {
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

          return (
            <div key={platform.id} className="relative">
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
              {hasValue ? (
                <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
                  <span className="text-xs text-green-500">✓</span>
                </div>
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

