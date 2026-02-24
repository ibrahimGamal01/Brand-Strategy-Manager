import net from 'node:net';
import type { UrlGuardResult } from './scrapling-types';

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '0.0.0.0',
  '127.0.0.1',
  '::1',
  '169.254.169.254', // cloud metadata
  'metadata.google.internal',
]);

function normalizeUrl(rawUrl: string): string {
  const raw = String(rawUrl || '').trim();
  if (!raw) throw new Error('URL is required');
  const prefixed = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const parsed = new URL(prefixed);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only HTTP/HTTPS URLs are allowed');
  }
  parsed.hash = '';
  return parsed.toString();
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isPrivateIpv6(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:');
}

function isHostnameAllowed(hostname: string, allowedDomains?: string[]): UrlGuardResult {
  const normalizedHost = String(hostname || '').trim().toLowerCase();
  if (!normalizedHost) return { allowed: false, reason: 'Missing hostname' };

  if (BLOCKED_HOSTNAMES.has(normalizedHost)) {
    return { allowed: false, reason: `Blocked hostname (${normalizedHost})` };
  }

  if (normalizedHost.endsWith('.local') || normalizedHost.endsWith('.internal')) {
    return { allowed: false, reason: `Blocked private hostname suffix (${normalizedHost})` };
  }

  const ipVersion = net.isIP(normalizedHost);
  if (ipVersion === 4 && isPrivateIpv4(normalizedHost)) {
    return { allowed: false, reason: `Blocked private IPv4 (${normalizedHost})` };
  }
  if (ipVersion === 6 && isPrivateIpv6(normalizedHost)) {
    return { allowed: false, reason: `Blocked private IPv6 (${normalizedHost})` };
  }

  if (!allowedDomains?.length) {
    return { allowed: true, hostname: normalizedHost };
  }

  const normalizedDomains = Array.from(
    new Set(
      allowedDomains
        .map((domain) => String(domain || '').trim().toLowerCase())
        .filter(Boolean)
        .map((domain) => domain.replace(/^\./, '')),
    ),
  );

  const matches = normalizedDomains.some(
    (domain) => normalizedHost === domain || normalizedHost.endsWith(`.${domain}`),
  );
  if (!matches) {
    return {
      allowed: false,
      reason: `Hostname ${normalizedHost} is outside the allowed domain list`,
      hostname: normalizedHost,
    };
  }

  return { allowed: true, hostname: normalizedHost };
}

export function validateScrapeUrl(rawUrl: string, allowedDomains?: string[]): UrlGuardResult {
  try {
    const normalizedUrl = normalizeUrl(rawUrl);
    const parsed = new URL(normalizedUrl);
    const hostCheck = isHostnameAllowed(parsed.hostname, allowedDomains);
    if (!hostCheck.allowed) return hostCheck;
    return {
      allowed: true,
      normalizedUrl,
      hostname: hostCheck.hostname,
    };
  } catch (error: any) {
    return {
      allowed: false,
      reason: error?.message || 'Invalid URL',
    };
  }
}
