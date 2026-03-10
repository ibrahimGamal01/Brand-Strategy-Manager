import type { DocumentDataPayload } from './document-spec';
import type { DocumentSpecV1 } from './document-spec-schema';

export type DraftedDocumentSection = {
  id: string;
  kind: DocumentSpecV1['sections'][number]['kind'];
  title: string;
  contentMd: string;
  evidenceRefIds: string[];
  status: 'grounded' | 'insufficient_evidence';
  partialReason?: string;
};

export type DraftDocumentSectionsResult = {
  sections: DraftedDocumentSection[];
  partialReasons: string[];
};

const MIN_SECTION_EVIDENCE_REFS: Record<
  DocumentSpecV1['docFamily'],
  Record<DocumentSpecV1['depth'], number>
> = {
  SWOT: { short: 1, standard: 2, deep: 3 },
  BUSINESS_STRATEGY: { short: 1, standard: 2, deep: 3 },
  PLAYBOOK: { short: 1, standard: 2, deep: 2 },
  COMPETITOR_AUDIT: { short: 1, standard: 2, deep: 3 },
  CONTENT_CALENDAR: { short: 1, standard: 2, deep: 2 },
  GO_TO_MARKET: { short: 1, standard: 2, deep: 3 },
};

function firstItems(values: string[], fallback: string, max = 5): string[] {
  const cleaned = values
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .slice(0, max);
  return cleaned.length ? cleaned : [fallback];
}

function topSignals(payload: DocumentDataPayload, max = 5): string[] {
  return payload.topPosts
    .slice(0, max)
    .map((post) => {
      const engagement = Math.max(0, Number(post.likes || 0) + Number(post.comments || 0) + Number(post.shares || 0));
      return `@${post.handle} (${post.platform}) signal: ${String(post.caption || '').slice(0, 140)} (engagement ${engagement}).`;
    });
}

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function titleCaseWord(value: string): string {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return 'Channel';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function resolveCalendarStartDate(payload: DocumentDataPayload): Date {
  const parsed = new Date(String(payload.generatedAt || '').trim());
  if (!Number.isNaN(parsed.getTime())) return parsed;
  return new Date();
}

function competitorLines(payload: DocumentDataPayload, max = 6): string[] {
  return payload.competitors
    .slice(0, max)
    .map(
      (row) =>
        `@${row.handle} (${row.platform}) state ${row.selectionState.toLowerCase()}${row.profileUrl ? ` - ${row.profileUrl}` : ''}.`
    );
}

function sourceLedgerLines(payload: DocumentDataPayload, max = 10): string[] {
  const lines = [
    ...payload.webSnapshots.slice(0, max).map((row) => `${row.finalUrl} (${row.statusCode || 'n/a'})`),
    ...payload.news.slice(0, max).map((row) => `${row.title} - ${row.url}`),
    ...payload.communityInsights.slice(0, max).map((row) => `${row.source} - ${row.url || 'n/a'}`),
  ];
  return firstItems(lines, 'No source ledger rows available yet.', max);
}

function sectionLimit(depth: DocumentSpecV1['depth'], standardMax: number, deepMax: number): number {
  return depth === 'deep' ? deepMax : standardMax;
}

function addDeepeningNotes(input: {
  contentMd: string;
  depth: DocumentSpecV1['depth'];
  status: DraftedDocumentSection['status'];
  evidenceRefCount: number;
  partialReason?: string;
}): string {
  if (input.depth !== 'deep') return input.contentMd;
  const notes = [
    `- Section coverage status: **${input.status === 'grounded' ? 'grounded' : 'partial'}**.`,
    `- Evidence references mapped in spec: **${input.evidenceRefCount}**.`,
    ...(input.partialReason ? [`- Gap: ${input.partialReason}`] : []),
    input.status === 'grounded'
      ? '- Next deepening move: expand contradictory evidence checks before final stakeholder circulation.'
      : '- Next deepening move: run another targeted evidence loop for this section before final sign-off.',
  ];
  return [input.contentMd, '', '### Deepening Notes', ...notes].join('\n');
}

function buildSectionContent(
  section: DraftedDocumentSection,
  payload: DocumentDataPayload,
  depth: DocumentSpecV1['depth']
): string {
  if (section.kind === 'executive_summary') {
    return [
      `- Primary goal: ${payload.primaryGoal}.`,
      `- Audience: ${payload.audience} over ${payload.timeframeDays} days.`,
      `- Coverage confidence: ${payload.coverage.overallScore}/100 (${payload.coverage.band}).`,
      `- Recommendation: ${(payload.recommendations.quickWins[0] || '').trim() || 'Prioritize highest-confidence evidence-backed tests.'}`,
    ].join('\n');
  }

  if (section.kind === 'market_context') {
    const max = sectionLimit(depth, 6, 10);
    return firstItems(topSignals(payload, max), 'Insufficient market context evidence.', max)
      .map((line) => `- ${line}`)
      .join('\n');
  }

  if (section.kind === 'swot_matrix') {
    const strength = firstItems(topSignals(payload, 4), 'Insufficient strengths evidence.', 4);
    const weakness = firstItems(payload.coverage.partialReasons, 'Evidence density is below target for deep confidence.', 4);
    const opportunity = firstItems(
      payload.news.slice(0, 4).map((row) => `${row.title} (${row.url})`),
      'Opportunity evidence is limited.',
      4
    );
    const threat = firstItems(competitorLines(payload, 4), 'Threat evidence is limited.', 4);
    return [
      '| Strengths | Weaknesses |',
      '| --- | --- |',
      `| ${strength.join('<br/>')} | ${weakness.join('<br/>')} |`,
      '',
      '| Opportunities | Threats |',
      '| --- | --- |',
      `| ${opportunity.join('<br/>')} | ${threat.join('<br/>')} |`,
    ].join('\n');
  }

  if (section.kind === 'swot_implications') {
    const lines = firstItems(payload.recommendations.quickWins, 'Translate SWOT into immediate experiments.', 5);
    return lines.map((line) => `- ${line}`).join('\n');
  }

  if (section.kind === 'competitor_deep_dive') {
    const max = sectionLimit(depth, 6, 10);
    return firstItems(competitorLines(payload, max), 'No competitor deep-dive evidence available yet.', max)
      .map((line) => `- ${line}`)
      .join('\n');
  }

  if (section.kind === 'competitor_market_map') {
    const max = sectionLimit(depth, 10, 14);
    return firstItems(competitorLines(payload, max), 'No competitor market map evidence available.', max)
      .map((line) => `- ${line}`)
      .join('\n');
  }

  if (section.kind === 'competitor_comparison_table') {
    const rows = payload.competitors.slice(0, 10).map((row) => {
      const relevance = Number.isFinite(Number(row.relevanceScore)) ? Number(row.relevanceScore).toFixed(2) : 'n/a';
      return `| @${row.handle} | ${row.platform} | ${row.selectionState} | ${relevance} | ${row.profileUrl || 'n/a'} |`;
    });
    return [
      '| Competitor | Platform | State | Relevance | Profile |',
      '| --- | --- | --- | ---: | --- |',
      ...(rows.length ? rows : ['| n/a | n/a | n/a | n/a | n/a |']),
    ].join('\n');
  }

  if (section.kind === 'competitor_battlecards') {
    return firstItems(
      payload.competitors.slice(0, 6).map((row) => {
        const reason = String(row.reason || '').trim();
        return `@${row.handle}: Differentiate on concrete outcomes${reason ? `; competitor edge signal: ${reason}` : ''}.`;
      }),
      'No battlecard evidence available.',
      6
    )
      .map((line) => `- ${line}`)
      .join('\n');
  }

  if (section.kind === 'signal_delta_analysis') {
    const max = sectionLimit(depth, 8, 12);
    return firstItems(
      payload.topPosts.slice(0, max).map((post) => {
        const weighted = Number(post.likes || 0) + Number(post.comments || 0) + Number(post.shares || 0);
        return `@${post.handle}: ${String(post.caption || '').slice(0, 120)} (weighted engagement ${weighted}).`;
      }),
      'No signal delta data available.',
      max
    )
      .map((line) => `- ${line}`)
      .join('\n');
  }

  if (section.kind === 'signal_analysis') {
    const max = sectionLimit(depth, 8, 12);
    return firstItems(topSignals(payload, max), 'No high-signal posts available yet.', max)
      .map((line) => `- ${line}`)
      .join('\n');
  }

  if (section.kind === 'positioning') {
    const lines = [
      payload.competitors[0]
        ? `Differentiate clearly against @${payload.competitors[0].handle} by tightening ICP and measurable outcome promise.`
        : 'Define one clear ICP and measurable outcome promise before scaling campaigns.',
      'Use evidence-backed hooks with conversion-oriented CTA sequencing.',
    ];
    return lines.map((line) => `- ${line}`).join('\n');
  }

  if (section.kind === 'offer_stack') {
    return [
      `- Primary offer framing should support: ${payload.primaryGoal}.`,
      '- Add proof points and objections handling to each offer tier.',
      '- Map offer CTAs to the highest-confidence signal themes.',
    ].join('\n');
  }

  if (section.kind === 'channel_plan') {
    return [
      '- Primary channel focus: high-performing social signal lane.',
      '- Secondary lane: web conversion path reinforcement.',
      '- Weekly cadence: publish, measure, iterate, and archive evidence.',
    ].join('\n');
  }

  if (section.kind === 'cadence_assumptions') {
    return [
      `- Weekly publishing target: ${depth === 'deep' ? '6-8' : depth === 'standard' ? '4-6' : '3-4'} planned assets anchored to the strongest proven signal patterns.`,
      '- Every primary post should create at least one derivative follow-up asset for stories, email, or website conversion support.',
      `- Use ${payload.topPosts[0] ? `@${payload.topPosts[0].handle}` : 'top available'} signal patterns as the default narrative benchmark until new winners emerge.`,
      '- Reserve one slot each week for a conversion-led CTA or offer validation asset, not only audience growth content.',
      '- Run a weekly optimization review on saves, shares, clicks, and qualified conversion movement before rolling the next batch forward.',
    ].join('\n');
  }

  if (section.kind === 'content_calendar_slots') {
    const slotTarget = depth === 'deep' ? 24 : depth === 'standard' ? 16 : 8;
    const start = resolveCalendarStartDate(payload);
    const signalPool = payload.topPosts.length ? payload.topPosts : [null];
    const rows = Array.from({ length: slotTarget }, (_, index) => {
      const signal = signalPool[index % signalPool.length];
      const week = Math.floor(index / 4) + 1;
      const day = (index % 4) + 1;
      const slotDate = new Date(start);
      slotDate.setUTCDate(start.getUTCDate() + index * 2);
      const channel = signal?.platform ? titleCaseWord(signal.platform) : ['Instagram', 'Website', 'Email', 'TikTok'][index % 4];
      const angle =
        signal?.caption
          ? String(signal.caption).replace(/\s+/g, ' ').trim().slice(0, 72)
          : `Tie content to ${payload.primaryGoal.toLowerCase()} with one clear audience problem/solution arc.`;
      const cta =
        index % 4 === 3
          ? 'Direct CTA to booking / inquiry'
          : index % 4 === 2
            ? 'Proof-led CTA'
            : index % 4 === 1
              ? 'Save / share CTA'
              : 'Engagement + problem-awareness CTA';
      const evidencePattern = signal ? `Pattern from @${signal.handle}` : 'Use strongest current workspace evidence';
      return `| ${toIsoDate(slotDate)} | Week ${week} / Slot ${day} | ${channel} | ${angle} | ${cta} | ${evidencePattern} | ${signal?.postUrl || 'n/a'} |`;
    });
    return [
      '| Date | Slot | Channel | Recommended Angle | CTA | Evidence Pattern | Link |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      ...(rows.length
        ? rows
        : [`| ${toIsoDate(start)} | Week 1 / Slot 1 | n/a | No signals available yet. | Hold | Use strongest current workspace evidence | n/a |`]),
      '',
      '### Sequencing Notes',
      '- Use Week 1 to establish the strongest narrative angle, Week 2 to deepen proof, Week 3 to rotate objections, and Week 4 to increase conversion pressure.',
      '- Pair every high-performing awareness post with one follow-up proof or CTA asset inside the next 72 hours.',
      '- Recycle the best-performing topic into at least two additional hooks before introducing a new theme.',
    ].join('\n');
  }

  if (section.kind === 'channel_pillar_matrix') {
    return [
      '| Channel | Pillar | Objective | KPI |',
      '| --- | --- | --- | --- |',
      '| Instagram | Education | Build trust and save rates | Saves / Shares |',
      '| Instagram | Proof | Turn audience interest into credibility and DM intent | Profile visits / DMs |',
      '| Website | Conversion | Turn intent into leads/bookings | CVR / Qualified leads |',
      '| Email | Retention | Nurture recurring engagement | CTR / Response rate |',
      '| TikTok | Discovery | Expand reach with high-velocity narrative testing | 3s hold / shares |',
      '| Community | Objection handling | Surface language gaps and recurring friction | Comment quality / repeats |',
    ].join('\n');
  }

  if (section.kind === 'icp_definition') {
    return [
      `- Primary ICP should align to: ${payload.targetMarket}.`,
      '- Segment by urgency, willingness to pay, and transformation goal.',
      '- Anchor messaging on measurable “before/after” outcomes.',
    ].join('\n');
  }

  if (section.kind === 'messaging_house') {
    return [
      '- Core promise: clear measurable outcome with low-friction adoption.',
      '- Supporting pillars: proof, mechanism, and objection reversal.',
      '- Proof points must map directly to evidence ledger references.',
    ].join('\n');
  }

  if (section.kind === 'launch_phases') {
    return [
      '### Phase 1 (Weeks 1-2)',
      '- Positioning and offer validation.',
      '### Phase 2 (Weeks 3-6)',
      '- Channel activation and experiment loops.',
      '### Phase 3 (Weeks 7-12)',
      '- Scale winning lanes and tighten unit economics.',
    ].join('\n');
  }

  if (section.kind === 'budget_kpi_tree') {
    return [
      '- Budget split: 60% proven lane, 25% expansion tests, 15% exploratory bets.',
      '- KPI Tree: Reach -> Qualified clicks -> Conversion -> Revenue quality.',
      '- Add weekly variance alert thresholds for rapid correction.',
    ].join('\n');
  }

  if (section.kind === 'kpi_block') {
    return [
      '- Track qualified leads, conversion rate, and lead quality weekly.',
      '- Measure channel-level CPA/CPL where available.',
      '- Run monthly strategy refresh using evidence confidence deltas.',
    ].join('\n');
  }

  if (section.kind === 'roadmap_30_60_90') {
    const max = sectionLimit(depth, 5, 7);
    const days30 = firstItems(payload.recommendations.days30, 'Define baseline hypotheses and KPI owners.', max);
    const days60 = firstItems(payload.recommendations.days60, 'Scale highest-performing narrative archetypes.', max);
    const days90 = firstItems(payload.recommendations.days90, 'Operationalize strategy refresh cadence.', max);
    return [
      '### 30 Days',
      ...days30.map((line) => `- ${line}`),
      '',
      '### 60 Days',
      ...days60.map((line) => `- ${line}`),
      '',
      '### 90 Days',
      ...days90.map((line) => `- ${line}`),
    ].join('\n');
  }

  if (section.kind === 'risk_register') {
    const max = sectionLimit(depth, 8, 12);
    return firstItems(payload.recommendations.risks, 'Validate engagement versus conversion quality continuously.', max)
      .map((line) => `- ${line}`)
      .join('\n');
  }

  if (section.kind === 'evidence_gaps') {
    const max = sectionLimit(depth, 8, 12);
    return firstItems(payload.coverage.partialReasons, 'No critical evidence gaps currently flagged.', max)
      .map((line) => `- ${line}`)
      .join('\n');
  }

  if (section.kind === 'playbook_cadence') {
    return [
      '- Monday: publish primary narrative test.',
      '- Wednesday: publish supporting social proof variant.',
      '- Friday: review KPIs and log evidence-backed adjustments.',
      '- Monthly: run strategic retrospective and roll forward.',
    ].join('\n');
  }

  if (section.kind === 'source_ledger') {
    const max = sectionLimit(depth, 16, 24);
    return sourceLedgerLines(payload, max).map((line) => `- ${line}`).join('\n');
  }

  return '- Section content not mapped yet.';
}

export function draftDocumentSections(input: {
  spec: DocumentSpecV1;
  payload: DocumentDataPayload;
}): DraftDocumentSectionsResult {
  const partialReasons: string[] = [];
  const minEvidenceRefs = MIN_SECTION_EVIDENCE_REFS[input.spec.docFamily]?.[input.spec.depth] ?? 1;
  const sections: DraftedDocumentSection[] = input.spec.sections.map((section) => {
    const evidenceRefIds = Array.from(new Set(section.evidenceRefIds.filter(Boolean))).slice(0, 30);
    const status: DraftedDocumentSection['status'] =
      evidenceRefIds.length >= minEvidenceRefs ? 'grounded' : 'insufficient_evidence';
    const partialReason =
      status === 'insufficient_evidence'
        ? `Section ${section.title} has insufficient evidence references (${evidenceRefIds.length}/${minEvidenceRefs}).`
        : undefined;
    if (partialReason) {
      partialReasons.push(partialReason);
    }

    const baseContentMd = buildSectionContent(
      {
        id: section.id,
        kind: section.kind,
        title: section.title,
        contentMd: '',
        evidenceRefIds,
        status,
        partialReason,
      },
      input.payload,
      input.spec.depth
    );

    const contentMd = addDeepeningNotes({
      contentMd: baseContentMd,
      depth: input.spec.depth,
      status,
      evidenceRefCount: evidenceRefIds.length,
      ...(partialReason ? { partialReason } : {}),
    });

    const drafted: DraftedDocumentSection = {
      id: section.id,
      kind: section.kind,
      title: section.title,
      contentMd,
      evidenceRefIds,
      status,
      ...(partialReason ? { partialReason } : {}),
    };

    return drafted;
  });

  return {
    sections,
    partialReasons,
  };
}
