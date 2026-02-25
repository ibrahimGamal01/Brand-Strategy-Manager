import { PLATFORMS, PlatformId } from "./platforms";

export interface SuggestedHandleValidationItem {
  handle: string;
  isLikelyClient: boolean;
  confidence: number;
  reason: string;
}

interface SocialHandlesFieldsProps {
  handles: Record<PlatformId, string>;
  onChange: (platform: PlatformId, value: string) => void;
  suggestedPlatforms?: Set<string>;
  suggestedHandleValidation?: {
    instagram?: SuggestedHandleValidationItem;
    tiktok?: SuggestedHandleValidationItem;
  };
}

export function normalizeHandle(value: string): string {
  return String(value || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

export function extractHandleFromUrlOrRaw(platform: PlatformId, value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";

  if (platform === "instagram") {
    const match = raw.match(/instagram\.com\/([a-z0-9._]{2,30})/i);
    if (match) return normalizeHandle(match[1]);
  }

  if (platform === "tiktok") {
    const match = raw.match(/tiktok\.com\/@?([a-z0-9._]{2,30})/i);
    if (match) return normalizeHandle(match[1]);
  }

  if (platform === "youtube") {
    const atHandle = raw.match(/(?:youtube\.com\/@)([a-z0-9._-]{2,40})/i);
    if (atHandle) return normalizeHandle(atHandle[1]);

    const channelPath = raw.match(/(?:youtube\.com\/(?:c|user|channel)\/)([a-z0-9._-]{2,80})/i);
    if (channelPath) return normalizeHandle(channelPath[1]);

    const shortUrl = raw.match(/(?:youtu\.be\/)([a-z0-9._-]{2,80})/i);
    if (shortUrl) return normalizeHandle(shortUrl[1]);
  }

  if (platform === "twitter") {
    const match = raw.match(/(?:x\.com|twitter\.com)\/([a-z0-9_]{1,15})(?:$|[/?#])/i);
    if (match) return normalizeHandle(match[1]);
  }

  return normalizeHandle(raw);
}

export function buildChannelsFromHandles(
  handles: Record<PlatformId, string>
): Array<{ platform: PlatformId; handle: string }> {
  return Object.entries(handles)
    .map(([platform, handle]) => ({
      platform: platform as PlatformId,
      handle: extractHandleFromUrlOrRaw(platform as PlatformId, handle),
    }))
    .filter((item) => item.handle.length > 0);
}

export function getFilledHandlesCount(handles: Record<PlatformId, string>): number {
  return Object.entries(handles).filter(([platform, value]) => {
    return extractHandleFromUrlOrRaw(platform as PlatformId, value).length > 0;
  }).length;
}

export function getFilledHandlesList(handles: Record<PlatformId, string>): string[] {
  return Object.entries(handles)
    .map(([platform, value]) => extractHandleFromUrlOrRaw(platform as PlatformId, value))
    .filter((value) => value.length > 0)
    .map((value) => `@${value}`);
}

function getConfidenceLabel(validation: SuggestedHandleValidationItem): string {
  const score = Number(validation.confidence || 0);
  if (score >= 0.75) return "Likely your account";
  if (score >= 0.45) return "Please confirm";
  return "Needs review";
}

function getSuggestionTone(validation?: SuggestedHandleValidationItem): "suggested" | "warning" {
  if (!validation) return "warning";
  return validation.isLikelyClient && validation.confidence >= 0.75 ? "suggested" : "warning";
}

export function SocialHandlesFields({
  handles,
  onChange,
  suggestedPlatforms,
  suggestedHandleValidation,
}: SocialHandlesFieldsProps) {
  const filledCount = getFilledHandlesCount(handles);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs uppercase tracking-[0.12em]" style={{ color: "var(--bat-text-muted)" }}>
          Active Channels
        </p>
        <span className="bat-chip">{filledCount} selected</span>
      </div>

      <div className="grid gap-3">
        {PLATFORMS.map((platform) => {
          const Icon = platform.icon;
          const value = String(handles[platform.id] || "");
          const hasValue = normalizeHandle(value).length > 0;
          const isSuggested = suggestedPlatforms?.has(platform.id);
          const validation =
            platform.id === "instagram"
              ? suggestedHandleValidation?.instagram
              : platform.id === "tiktok"
                ? suggestedHandleValidation?.tiktok
                : undefined;
          const tone = getSuggestionTone(validation);

          return (
            <div key={platform.id}>
              <div className="mb-1.5 flex items-center gap-2">
                <p className="text-sm font-medium">{platform.name}</p>
                {isSuggested ? (
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.08em]"
                    style={{
                      background:
                        tone === "warning" ? "color-mix(in srgb, var(--bat-warning) 18%, white)" : "var(--bat-accent-soft)",
                      color: tone === "warning" ? "var(--bat-warning)" : "var(--bat-accent)",
                    }}
                  >
                    {tone === "warning" ? "Review" : "Suggested"}
                  </span>
                ) : null}
              </div>
              <label className="relative block">
                <span
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
                  style={{ color: hasValue ? "var(--bat-text)" : "var(--bat-text-muted)" }}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <input
                  type="text"
                  value={value}
                  onChange={(event) => onChange(platform.id, event.target.value)}
                  className="w-full rounded-xl border py-2.5 pl-10 pr-3 text-sm"
                  style={{
                    borderColor: "var(--bat-border)",
                    background: "var(--bat-surface)",
                    color: "var(--bat-text)",
                  }}
                  placeholder={`@${platform.placeholder}`}
                />
              </label>
              {validation?.reason ? (
                <p className="mt-1 text-xs" style={{ color: "var(--bat-text-muted)" }}>
                  {getConfidenceLabel(validation)}: {validation.reason}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      <p className="text-xs" style={{ color: "var(--bat-text-muted)" }}>
        Add at least one handle to start discovery and evidence-based recommendations.
      </p>
    </section>
  );
}
