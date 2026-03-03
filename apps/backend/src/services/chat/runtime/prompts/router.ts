import type { BusinessArchetype, RouterOutput } from '../../../documents/document-spec';

function inferBusinessArchetype(message: string, runtimeContext?: Record<string, unknown>): BusinessArchetype {
  const contextBusinessType = String(runtimeContext?.businessType || runtimeContext?.clientBusinessType || '').toLowerCase();
  const normalized = `${message} ${contextBusinessType}`.toLowerCase();
  if (/saas|software|b2b/.test(normalized)) return 'b2b_saas';
  if (/ecom|retail|shop|dtc/.test(normalized)) return 'ecommerce';
  if (/wellness|yoga|healing|meditation|coach/.test(normalized)) return 'wellness';
  if (/finance|financial|bank|insurance|wealth/.test(normalized)) return 'financial_services';
  if (/agency|consult|professional service|law firm|studio/.test(normalized)) return 'professional_services';
  return 'generic';
}

function inferDocFamily(message: string): RouterOutput['docFamily'] {
  const normalized = String(message || '').toLowerCase();
  if (/\bswot\b/.test(normalized)) return 'SWOT';
  if (/\bgo\s*to\s*market\b|\bgtm\b|\blaunch plan\b/.test(normalized)) return 'GO_TO_MARKET';
  if (/\bcontent calendar\b|\bcalendar\b|\beditorial calendar\b/.test(normalized)) return 'CONTENT_CALENDAR';
  if (/\bcompetitor audit\b|\bcompetitor analysis\b|\bbattlecard\b/.test(normalized)) return 'COMPETITOR_AUDIT';
  if (/\bplaybook\b/.test(normalized) || /\bcadence\b/.test(normalized)) return 'PLAYBOOK';
  if (/\bstrategy\b|\bbrief\b|\bdocument\b|\bpdf\b|\bplan\b/.test(normalized)) return 'BUSINESS_STRATEGY';
  return null;
}

function inferIntent(message: string, docFamily: RouterOutput['docFamily']): RouterOutput['intent'] {
  const normalized = String(message || '').toLowerCase();
  if (docFamily) return 'document_request';
  if (/\bedit\b|\brewrite\b|\bpropose edit\b|\bapply edit\b/.test(normalized)) return 'document_edit_request';
  if (/\bupdate\b|\bchange\b|\bapply\b|\bsave\b|\bmutate\b/.test(normalized)) return 'mutation_request';
  if (/\banaly[sz]e\b|\baudit\b|\binvestigate\b/.test(normalized)) return 'analysis_request';
  return 'chat_answer';
}

export function routeRuntimeIntent(input: {
  userMessage: string;
  runtimeContext?: Record<string, unknown>;
}): RouterOutput {
  const message = String(input.userMessage || '').trim();
  const docFamily = inferDocFamily(message);
  const intent = inferIntent(message, docFamily);
  const businessArchetype = inferBusinessArchetype(message, input.runtimeContext);

  const requiredEvidenceLanes = docFamily
    ? docFamily === 'SWOT'
      ? ['competitors', 'posts', 'web', 'news', 'community']
      : docFamily === 'PLAYBOOK'
        ? ['posts', 'web', 'competitors']
        : docFamily === 'COMPETITOR_AUDIT'
          ? ['competitors', 'posts', 'web', 'news']
          : docFamily === 'CONTENT_CALENDAR'
            ? ['posts', 'web', 'competitors']
            : docFamily === 'GO_TO_MARKET'
              ? ['web', 'competitors', 'news', 'community']
              : ['competitors', 'posts', 'web', 'news']
    : [];

  const requiredClarifications: string[] = [];
  if (docFamily === 'SWOT') {
    requiredClarifications.push('target_audience', 'time_horizon');
  } else if (docFamily === 'BUSINESS_STRATEGY') {
    requiredClarifications.push('primary_goal', 'audience', 'time_horizon');
  } else if (docFamily === 'PLAYBOOK') {
    requiredClarifications.push('execution_owner', 'cadence');
  } else if (docFamily === 'COMPETITOR_AUDIT') {
    requiredClarifications.push('comparison_scope', 'priority_competitors');
  } else if (docFamily === 'CONTENT_CALENDAR') {
    requiredClarifications.push('cadence', 'channel_mix', 'owner');
  } else if (docFamily === 'GO_TO_MARKET') {
    requiredClarifications.push('offer', 'launch_horizon', 'budget_level');
  }

  return {
    intent,
    docFamily,
    businessArchetype,
    requiredEvidenceLanes,
    requiredClarifications,
  };
}

export function buildRouterSystemPrompt(): string {
  return [
    'You are BAT Intent Router.',
    'Return strict JSON only.',
    'Classify user intent and output doc family when applicable.',
    'Allowed intents: chat_answer, analysis_request, document_request, document_edit_request, mutation_request.',
    'Allowed doc families: SWOT, BUSINESS_STRATEGY, PLAYBOOK, COMPETITOR_AUDIT, CONTENT_CALENDAR, GO_TO_MARKET, null.',
  ].join('\n');
}
