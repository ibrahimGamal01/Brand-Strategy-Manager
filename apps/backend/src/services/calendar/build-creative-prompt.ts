/**
 * Build a single creative prompt string from productionBrief + inspiration posts.
 * Used for display and for saving with ContentDraft (provenance included).
 */

export interface InspirationRef {
  postId?: string;
  handle?: string;
  postUrl?: string;
  reasonType?: string;
  reason?: string;
}

export function buildCreativePrompt(
  productionBrief: Record<string, unknown> | null | undefined,
  inspirationPosts: InspirationRef[] = []
): string {
  const lines: string[] = [];

  if (inspirationPosts.length > 0) {
    lines.push('Reference posts used for this slot:');
    inspirationPosts.forEach((p) => {
      const handle = p.handle || 'unknown';
      const url = p.postUrl || '';
      const reasonType = p.reasonType || 'reference';
      const reason = p.reason || '';
      lines.push(`- ${handle} ${url} (${reasonType}: ${reason})`);
    });
    lines.push('');
  }

  lines.push('Creative brief:');
  if (!productionBrief || typeof productionBrief !== 'object') {
    lines.push('(No production brief.)');
    return lines.join('\n');
  }

  const spec = productionBrief.deliverableSpec as Record<string, unknown> | undefined;
  if (spec && typeof spec === 'object') {
    lines.push(`Asset: ${(spec.assetType as string) ?? 'video'}`);
    const duration = spec.durationSeconds ?? spec.duration;
    if (duration != null) lines.push(`Duration: ${duration}`);
    const ratio = spec.aspectRatio ?? spec.ratio;
    if (ratio != null) lines.push(`Aspect ratio: ${ratio}`);
    if (Array.isArray(spec.mustInclude) && spec.mustInclude.length) {
      lines.push(`Must include: ${(spec.mustInclude as string[]).join(', ')}`);
    }
    if (Array.isArray(spec.mustAvoid) && spec.mustAvoid.length) {
      lines.push(`Must avoid: ${(spec.mustAvoid as string[]).join(', ')}`);
    }
    if (Array.isArray(spec.styleTags) && spec.styleTags.length) {
      lines.push(`Style: ${(spec.styleTags as string[]).join(', ')}`);
    }
    lines.push('');
  }

  const hookVal = productionBrief.hook;
  if (typeof hookVal === 'string' && hookVal.trim()) {
    lines.push(`Hook: ${hookVal.trim()}`);
    lines.push('');
  } else if (hookVal && typeof hookVal === 'object') {
    const hook = hookVal as Record<string, unknown>;
    if (hook.onScreenText) lines.push(`Hook (on-screen): ${hook.onScreenText}`);
    if (hook.voiceover) lines.push(`Hook (voiceover): ${hook.voiceover}`);
    lines.push('');
  }

  const structureVal = productionBrief.structure;
  if (typeof structureVal === 'string' && structureVal.trim()) {
    lines.push('Structure:');
    lines.push(structureVal.trim());
    lines.push('');
  } else if (structureVal && typeof structureVal === 'object' && Array.isArray((structureVal as Record<string, unknown>).beats)) {
    const structure = structureVal as Record<string, unknown>;
    const beats = structure.beats as string[];
    if (beats.length) {
      lines.push('Structure:');
      beats.forEach((b, i) => lines.push(`  ${i + 1}. ${b}`));
      lines.push('');
    }
  }

  const scriptVal = productionBrief.script;
  if (typeof scriptVal === 'string' && scriptVal.trim()) {
    lines.push('Script (voiceover):');
    lines.push(scriptVal.trim());
    lines.push('');
  } else if (scriptVal && typeof scriptVal === 'object') {
    const script = scriptVal as Record<string, unknown>;
    if (script.voiceoverFull) lines.push(`Script (voiceover):\n${script.voiceoverFull}`);
    if (Array.isArray(script.onScreenTextLines) && (script.onScreenTextLines as string[]).length) {
      lines.push('On-screen lines:');
      (script.onScreenTextLines as string[]).forEach((l) => lines.push(`  - ${l}`));
    }
    lines.push('');
  }

  const captionVal = productionBrief.caption;
  if (typeof captionVal === 'string' && captionVal.trim()) {
    lines.push('Caption draft:');
    lines.push(captionVal.trim());
    lines.push('');
  } else if (captionVal && typeof captionVal === 'object') {
    const caption = captionVal as Record<string, unknown>;
    if (caption.draft) lines.push(`Caption draft:\n${caption.draft}`);
    if (caption.cta) lines.push(`CTA: ${caption.cta}`);
    if (Array.isArray(caption.hashtags) && (caption.hashtags as string[]).length) {
      lines.push(`Hashtags: ${(caption.hashtags as string[]).join(' ')}`);
    }
    lines.push('');
  }

  const requiredInputs = productionBrief.requiredInputs;
  if (Array.isArray(requiredInputs) && requiredInputs.length) {
    lines.push('Required inputs:');
    requiredInputs.forEach((r: unknown) => {
      const item = r && typeof r === 'object' ? (r as Record<string, unknown>) : null;
      if (item && (item.type || item.priority)) {
        lines.push(`  - ${item.type ?? 'input'} (${item.priority ?? 'normal'})`);
      }
    });
    lines.push('');
  }

  const originalityRules = productionBrief.originalityRules;
  if (Array.isArray(originalityRules) && originalityRules.length) {
    lines.push('Originality rules:');
    (originalityRules as string[]).forEach((r) => lines.push(`  - ${r}`));
  }

  return lines.join('\n').trim();
}
