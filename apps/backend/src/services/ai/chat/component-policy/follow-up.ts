export function sanitizeFollowUp(input: string[], userMessage: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of input || []) {
    const normalized = String(row || '').trim().replace(/\s+/g, ' ');
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized.slice(0, 120));
    if (out.length >= 3) break;
  }
  if (out.length >= 2) return out;

  const msg = userMessage.toLowerCase();
  if (msg.includes('calendar')) {
    out.push('Choose a posting cadence to continue');
    out.push('Pick content pillars for next week');
  } else if (msg.includes('voice') || msg.includes('tone')) {
    out.push('Compare three tone directions');
    out.push('Select guardrails for voice consistency');
  } else {
    out.push('Choose one direction to continue');
    out.push('Refine target audience before generating');
  }
  out.push('Generate a structured draft preview');
  return out.slice(0, 3);
}

