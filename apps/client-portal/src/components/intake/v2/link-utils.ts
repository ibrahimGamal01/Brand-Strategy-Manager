import { PlatformId } from "../platforms";
import { CompetitorLinkItem, CompetitorLinkKind, CompetitorLinkPlatform } from "./intake-types";

function safeUrl(input: string): URL | null {
  const trimmed = String(input || "").trim();
  if (!trimmed) return null;

  try {
    return new URL(trimmed);
  } catch {
    try {
      return new URL(`https://${trimmed}`);
    } catch {
      return null;
    }
  }
}

function normalizeHandle(raw: string): string {
  return String(raw || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

function parseYoutubeHandle(pathname: string): string {
  const path = pathname.replace(/^\/+/, "");
  if (!path) return "";
  const atMatch = path.match(/^@([a-z0-9._-]{2,60})/i);
  if (atMatch) return normalizeHandle(atMatch[1]);

  const segments = path.split("/").filter(Boolean);
  if (segments.length >= 2 && ["channel", "c", "user"].includes(segments[0].toLowerCase())) {
    return normalizeHandle(segments[1]);
  }

  return "";
}

function parseUrlMeta(url: URL): { platform: CompetitorLinkPlatform; handle: string } {
  const host = url.hostname.toLowerCase();
  const pathname = url.pathname;

  if (host.includes("instagram.com")) {
    const handle = normalizeHandle(pathname.split("/").filter(Boolean)[0] || "");
    return { platform: "instagram", handle };
  }

  if (host.includes("tiktok.com")) {
    const match = pathname.match(/\/@?([a-z0-9._]{2,40})/i);
    return { platform: "tiktok", handle: normalizeHandle(match?.[1] || "") };
  }

  if (host.includes("youtube.com") || host === "youtu.be") {
    if (host === "youtu.be") {
      return { platform: "youtube", handle: "" };
    }
    return { platform: "youtube", handle: parseYoutubeHandle(pathname) };
  }

  if (host.includes("x.com") || host.includes("twitter.com")) {
    const match = pathname.match(/^\/?([a-z0-9_]{1,15})(?:$|[/?#])/i);
    return { platform: "twitter", handle: normalizeHandle(match?.[1] || "") };
  }

  return { platform: "website", handle: "" };
}

export function normalizeLinkInput(rawInput: string): {
  raw: string;
  normalizedUrl: string;
  platform: CompetitorLinkPlatform;
  handle: string;
  hostname: string;
  valid: boolean;
} {
  const raw = String(rawInput || "").trim();
  if (!raw) {
    return {
      raw: "",
      normalizedUrl: "",
      platform: "unknown",
      handle: "",
      hostname: "",
      valid: false,
    };
  }

  const directHandle = raw.match(/^@([a-z0-9._]{2,40})$/i);
  if (directHandle) {
    const handle = normalizeHandle(directHandle[1]);
    return {
      raw,
      normalizedUrl: `https://instagram.com/${handle}`,
      platform: "instagram",
      handle,
      hostname: "instagram.com",
      valid: true,
    };
  }

  const platformPrefix = raw.match(/^(instagram|ig|tiktok|tt|youtube|yt|x|twitter)\s*:\s*(.+)$/i);
  if (platformPrefix) {
    const source = platformPrefix[1].toLowerCase();
    const handle = normalizeHandle(platformPrefix[2]);
    const mapping: Record<string, { platform: PlatformId; host: string }> = {
      instagram: { platform: "instagram", host: "instagram.com" },
      ig: { platform: "instagram", host: "instagram.com" },
      tiktok: { platform: "tiktok", host: "tiktok.com" },
      tt: { platform: "tiktok", host: "tiktok.com" },
      youtube: { platform: "youtube", host: "youtube.com" },
      yt: { platform: "youtube", host: "youtube.com" },
      x: { platform: "twitter", host: "x.com" },
      twitter: { platform: "twitter", host: "x.com" },
    };

    const target = mapping[source];
    if (target && handle) {
      const normalizedUrl =
        target.platform === "youtube"
          ? `https://${target.host}/@${handle}`
          : `https://${target.host}/${target.platform === "tiktok" ? `@${handle}` : handle}`;
      return {
        raw,
        normalizedUrl,
        platform: target.platform,
        handle,
        hostname: target.host,
        valid: true,
      };
    }
  }

  const parsed = safeUrl(raw);
  if (!parsed) {
    return {
      raw,
      normalizedUrl: "",
      platform: "unknown",
      handle: "",
      hostname: "",
      valid: false,
    };
  }

  const { platform, handle } = parseUrlMeta(parsed);
  return {
    raw,
    normalizedUrl: parsed.toString(),
    platform,
    handle,
    hostname: parsed.hostname,
    valid: true,
  };
}

function createStableId(raw: string, platform: CompetitorLinkPlatform): string {
  return `${platform}:${raw.toLowerCase().replace(/\s+/g, "_")}`;
}

export function createLinkItem(
  rawInput: string,
  kind: CompetitorLinkKind = "competitor"
): CompetitorLinkItem | null {
  const normalized = normalizeLinkInput(rawInput);
  if (!normalized.raw) return null;

  return {
    id: createStableId(normalized.raw, normalized.platform),
    raw: normalized.raw,
    normalizedUrl: normalized.normalizedUrl,
    platform: normalized.platform,
    handle: normalized.handle,
    hostname: normalized.hostname,
    kind,
    valid: normalized.valid,
  };
}

export function buildLinkItems(rawInputs: string[]): CompetitorLinkItem[] {
  const seen = new Set<string>();
  const items: CompetitorLinkItem[] = [];

  for (const rawInput of rawInputs) {
    const item = createLinkItem(rawInput);
    if (!item) continue;
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }

  return items;
}

export function toLinkStrings(items: CompetitorLinkItem[]): string[] {
  return items
    .filter((item) => item.valid)
    .map((item) => item.normalizedUrl || item.raw)
    .filter(Boolean);
}
