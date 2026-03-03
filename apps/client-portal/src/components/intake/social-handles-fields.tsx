import { PLATFORMS, PlatformId } from "./platforms";
import { useState } from "react";

export interface SuggestedHandleValidationItem {
  handle: string;
  isLikelyClient: boolean;
  confidence: number;
  reason: string;
}

interface SocialHandlesFieldsProps {
  handles: Record<PlatformId, string>;
  handlesV2?: Record<PlatformId, { primary: string; handles: string[] }>;
  onChange: (platform: PlatformId, value: string) => void;
  onChangeV2?: (platform: PlatformId, value: { primary: string; handles: string[] }) => void;
  suggestedPlatforms?: Set<string>;
  suggestedHandleValidation?: {
    instagram?: SuggestedHandleValidationItem;
    tiktok?: SuggestedHandleValidationItem;
    youtube?: SuggestedHandleValidationItem;
    linkedin?: SuggestedHandleValidationItem;
    twitter?: SuggestedHandleValidationItem;
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

  if (platform === "linkedin") {
    const match = raw.match(/linkedin\.com\/(?:in|company)\/([a-z0-9-]{2,100})/i);
    if (match) return normalizeHandle(match[1]);
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
  handlesV2,
  onChange,
  onChangeV2,
  suggestedPlatforms,
  suggestedHandleValidation,
}: SocialHandlesFieldsProps) {
  const filledCount = getFilledHandlesCount(handles);
  const [drafts, setDrafts] = useState<Record<PlatformId, string>>({
    instagram: "",
    tiktok: "",
    youtube: "",
    linkedin: "",
    twitter: "",
  });

  function resolveBucket(platform: PlatformId): { primary: string; handles: string[] } {
    const fromState = handlesV2?.[platform];
    const normalizedPrimary = extractHandleFromUrlOrRaw(platform, fromState?.primary || handles[platform] || "");
    const normalizedHandles = Array.from(
      new Set(
        (Array.isArray(fromState?.handles) ? fromState?.handles : [])
          .map((entry) => extractHandleFromUrlOrRaw(platform, entry))
          .filter(Boolean)
      )
    ).slice(0, 5);
    if (normalizedPrimary && !normalizedHandles.includes(normalizedPrimary)) {
      normalizedHandles.unshift(normalizedPrimary);
    }
    return {
      primary: normalizedHandles.includes(normalizedPrimary) ? normalizedPrimary : normalizedHandles[0] || "",
      handles: normalizedHandles,
    };
  }

  function emitBucket(platform: PlatformId, bucket: { primary: string; handles: string[] }) {
    const normalizedHandles = Array.from(
      new Set(bucket.handles.map((entry) => extractHandleFromUrlOrRaw(platform, entry)).filter(Boolean))
    ).slice(0, 5);
    const normalizedPrimary = extractHandleFromUrlOrRaw(platform, bucket.primary || "");
    const nextBucket = {
      primary: normalizedHandles.includes(normalizedPrimary) ? normalizedPrimary : normalizedHandles[0] || "",
      handles: normalizedHandles,
    };
    onChangeV2?.(platform, nextBucket);
    onChange(platform, nextBucket.primary || "");
  }

  function addHandle(platform: PlatformId) {
    const draft = drafts[platform] || "";
    const normalized = extractHandleFromUrlOrRaw(platform, draft);
    if (!normalized) return;
    const bucket = resolveBucket(platform);
    if (bucket.handles.includes(normalized)) {
      emitBucket(platform, { ...bucket, primary: bucket.primary || normalized });
      setDrafts((previous) => ({ ...previous, [platform]: "" }));
      return;
    }
    const nextHandles = [normalized, ...bucket.handles].slice(0, 5);
    emitBucket(platform, { primary: bucket.primary || normalized, handles: nextHandles });
    setDrafts((previous) => ({ ...previous, [platform]: "" }));
  }

  function removeHandle(platform: PlatformId, handle: string) {
    const bucket = resolveBucket(platform);
    const nextHandles = bucket.handles.filter((entry) => entry !== handle);
    const nextPrimary = bucket.primary === handle ? nextHandles[0] || "" : bucket.primary;
    emitBucket(platform, { primary: nextPrimary, handles: nextHandles });
  }

  function setPrimary(platform: PlatformId, handle: string) {
    const bucket = resolveBucket(platform);
    emitBucket(platform, { primary: handle, handles: bucket.handles });
  }

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
          const bucket = resolveBucket(platform.id);
          const hasValue = bucket.handles.length > 0;
          const isSuggested = suggestedPlatforms?.has(platform.id);
          const validation =
            suggestedHandleValidation?.[platform.id as keyof NonNullable<typeof suggestedHandleValidation>];
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
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={drafts[platform.id] || ""}
                    onChange={(event) =>
                      setDrafts((previous) => ({ ...previous, [platform.id]: event.target.value }))
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addHandle(platform.id);
                      }
                    }}
                    className="w-full rounded-xl border py-2.5 pl-10 pr-3 text-sm"
                    style={{
                      borderColor: "var(--bat-border)",
                      background: "var(--bat-surface)",
                      color: "var(--bat-text)",
                    }}
                    placeholder={`Add ${platform.name} handle or URL`}
                  />
                  <button
                    type="button"
                    onClick={() => addHandle(platform.id)}
                    className="rounded-xl border px-3 py-2 text-xs"
                    style={{ borderColor: "var(--bat-border)" }}
                  >
                    Add
                  </button>
                </div>
              </label>
              {bucket.handles.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {bucket.handles.map((handle) => (
                    <div
                      key={`${platform.id}:${handle}`}
                      className="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs"
                      style={{
                        borderColor:
                          bucket.primary === handle ? "var(--bat-accent)" : "var(--bat-border)",
                        background:
                          bucket.primary === handle ? "var(--bat-accent-soft)" : "var(--bat-surface)",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => setPrimary(platform.id, handle)}
                        className="font-medium"
                        title="Set as primary"
                      >
                        @{handle}
                      </button>
                      {bucket.primary === handle ? <span className="text-[10px]">Primary</span> : null}
                      <button
                        type="button"
                        onClick={() => removeHandle(platform.id, handle)}
                        className="text-[11px]"
                        aria-label={`Remove ${handle}`}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
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
        Add up to 5 handles per platform. BAT can still start from website evidence when no handles are available.
      </p>
    </section>
  );
}
