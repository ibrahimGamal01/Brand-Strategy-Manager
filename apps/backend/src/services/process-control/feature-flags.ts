function asBool(value: string | undefined, defaultValue: boolean): boolean {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return defaultValue;
  return !['0', 'false', 'no', 'off'].includes(normalized);
}

export function isProcessControlV2Enabled(): boolean {
  return asBool(process.env.PROCESS_CONTROL_V2_ENABLED, true);
}

export function isProcessControlV2AutoStartEnabled(): boolean {
  return asBool(process.env.PROCESS_CONTROL_V2_AUTOSTART, true);
}

export function isProcessControlV2LiveResearchEnabled(): boolean {
  return asBool(process.env.PROCESS_CONTROL_V2_LIVE_RESEARCH, false);
}

export function processControlV2DefaultMaxRetries(): number {
  const parsed = Number(process.env.PROCESS_CONTROL_V2_MAX_RETRIES || 3);
  if (!Number.isFinite(parsed)) return 3;
  return Math.max(1, Math.min(8, Math.floor(parsed)));
}

export function processControlV2DefaultMaxRetryWithEvidence(): number {
  const parsed = Number(process.env.PROCESS_CONTROL_V2_MAX_RETRY_WITH_EVIDENCE || 2);
  if (!Number.isFinite(parsed)) return 2;
  return Math.max(1, Math.min(5, Math.floor(parsed)));
}
