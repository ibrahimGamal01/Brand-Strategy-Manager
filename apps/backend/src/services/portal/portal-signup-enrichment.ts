import crypto from 'node:crypto';
import { prisma } from '../../lib/prisma';
import { searchBrandContextDDG, searchRawDDG } from '../discovery/duckduckgo-search';
import { publishPortalIntakeEvent } from './portal-intake-events';
import {
  parseWebsiteList,
  PortalIntakeScanMode,
  queuePortalIntakeWebsiteScan,
} from './portal-intake-websites';

function hashEmailForLogs(email?: string | null): string | null {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return null;
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 20);
}

function logPortalEnrichmentEvent(input: {
  event:
    | 'PORTAL_ENRICHMENT_STARTED'
    | 'PORTAL_ENRICHMENT_SCAN_QUEUED'
    | 'PORTAL_ENRICHMENT_DDG_COMPLETED'
    | 'PORTAL_ENRICHMENT_WARNING'
    | 'PORTAL_ENRICHMENT_DONE';
  workspaceId: string;
  status: string;
  durationMs?: number;
  errorCode?: string;
  email?: string | null;
}) {
  const payload: Record<string, unknown> = {
    event: input.event,
    workspaceId: input.workspaceId,
    emailHash: hashEmailForLogs(input.email),
    status: input.status,
    durationMs: Number.isFinite(input.durationMs as number) ? Math.max(0, Math.round(input.durationMs as number)) : 0,
    timestamp: new Date().toISOString(),
  };
  if (input.errorCode) {
    payload.errorCode = input.errorCode;
  }
  console.log(JSON.stringify(payload));
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function toHostname(value: string): string {
  try {
    const parsed = new URL(value.startsWith('http') ? value : `https://${value}`);
    return parsed.hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

function resolveSignupScanMode(): PortalIntakeScanMode {
  const mode = String(process.env.PORTAL_SIGNUP_SCAN_MODE || 'deep')
    .trim()
    .toLowerCase();
  if (mode === 'quick' || mode === 'standard' || mode === 'deep') return mode;
  return 'deep';
}

function isSignupDdgEnabled(): boolean {
  const raw = String(process.env.PORTAL_SIGNUP_DDG_ENABLED || 'true')
    .trim()
    .toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(raw);
}

function buildDdgQueries(input: { brandName: string; domain: string }): string[] {
  const brandName = String(input.brandName || '').trim();
  const domain = String(input.domain || '').trim();
  const conservativeBrand = brandName.length >= 5 ? brandName : '';
  const domainToken = domain.split('.')[0]?.replace(/[^a-z0-9-]/gi, '').trim();
  const linkedinSeeds = Array.from(
    new Set(
      [conservativeBrand, domain, domainToken]
        .map((entry) => String(entry || '').trim())
        .filter((entry) => entry.length >= 3)
    )
  );
  const linkedinQueries = linkedinSeeds.flatMap((seed) => [
    `"${seed}" "linkedin"`,
    `site:linkedin.com "${seed}"`,
  ]);
  const queries = [
    domain ? `site:${domain}` : '',
    domain ? `site:${domain} services` : '',
    domain ? `site:${domain} about` : '',
    [conservativeBrand, domain].filter(Boolean).join(' ').trim(),
    [conservativeBrand, 'official website'].filter(Boolean).join(' ').trim(),
    domain ? `${domain} reviews` : '',
    [conservativeBrand, 'pricing'].filter(Boolean).join(' ').trim(),
    ...linkedinQueries,
    [conservativeBrand, 'linkedin instagram tiktok youtube'].filter(Boolean).join(' ').trim(),
  ]
    .map((entry) => entry.trim())
    .filter(Boolean);
  return Array.from(new Set(queries)).slice(0, 8);
}

async function updateSignupEnrichmentMetadata(
  workspaceId: string,
  patch: Record<string, unknown>
): Promise<void> {
  const workspace = await prisma.researchJob.findUnique({
    where: { id: workspaceId },
    select: {
      inputData: true,
    },
  });
  if (!workspace) return;

  const inputData = asRecord(workspace.inputData);
  const signupEnrichment = asRecord(inputData.signupEnrichment);

  await prisma.researchJob.update({
    where: { id: workspaceId },
    data: {
      inputData: {
        ...inputData,
        signupEnrichment: {
          ...signupEnrichment,
          ...patch,
          updatedAt: new Date().toISOString(),
        },
      },
    },
  });
}

export async function startPortalSignupEnrichment(input: {
  workspaceId: string;
  brandName: string;
  website?: string;
  websites?: string[];
}): Promise<void> {
  const startedAt = Date.now();
  const workspaceId = String(input.workspaceId || '').trim();
  if (!workspaceId) return;

  const websites = parseWebsiteList([input.website, input.websites], 5);
  const primaryWebsite = websites[0] || '';
  const domain = toHostname(primaryWebsite);
  const scanMode = resolveSignupScanMode();
  const ddgEnabled = isSignupDdgEnabled();

  let scanRunId: string | undefined;

  logPortalEnrichmentEvent({
    event: 'PORTAL_ENRICHMENT_STARTED',
    workspaceId,
    status: 'started',
  });

  await publishPortalIntakeEvent(
    workspaceId,
    'ENRICHMENT_STARTED',
    'Signup enrichment started. BAT is collecting website and search evidence.',
    {
      stage: 'bootstrap',
      websiteCount: websites.length,
      scanMode,
      ddgEnabled,
    }
  );

  await updateSignupEnrichmentMetadata(workspaceId, {
    startedAt: new Date().toISOString(),
    scanMode,
    ddgEnabled,
    websites,
  });

  if (websites.length > 0) {
    try {
      const queued = await queuePortalIntakeWebsiteScan(workspaceId, websites, {
        mode: scanMode,
        initiatedBy: 'SYSTEM',
      });
      scanRunId = queued.scanRunId;
      logPortalEnrichmentEvent({
        event: 'PORTAL_ENRICHMENT_SCAN_QUEUED',
        workspaceId,
        status: 'queued',
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      logPortalEnrichmentEvent({
        event: 'PORTAL_ENRICHMENT_WARNING',
        workspaceId,
        status: 'warning',
        durationMs: Date.now() - startedAt,
        errorCode: 'SCAN_QUEUE_FAILED',
      });
      await publishPortalIntakeEvent(
        workspaceId,
        'ENRICHMENT_WARNING',
        'Website enrichment queue failed. You can rescan from intake later.',
        {
          stage: 'website_scan_queue',
          error: (error as Error)?.message || String(error),
        }
      );
    }
  } else {
    logPortalEnrichmentEvent({
      event: 'PORTAL_ENRICHMENT_WARNING',
      workspaceId,
      status: 'warning',
      durationMs: Date.now() - startedAt,
      errorCode: 'WEBSITE_MISSING',
    });
    await publishPortalIntakeEvent(
      workspaceId,
      'ENRICHMENT_WARNING',
      'No website provided at signup, so website scan was skipped.',
      {
        stage: 'website_scan_queue',
      }
    );
  }

  if (!ddgEnabled) {
    logPortalEnrichmentEvent({
      event: 'PORTAL_ENRICHMENT_DONE',
      workspaceId,
      status: 'completed',
      durationMs: Date.now() - startedAt,
    });
    await publishPortalIntakeEvent(
      workspaceId,
      'ENRICHMENT_DONE',
      'Signup enrichment completed (DDG enrichment disabled by config).',
      {
        stage: 'finalize',
        ddgEnabled: false,
      },
      scanRunId ? { scanRunId } : undefined
    );
    await updateSignupEnrichmentMetadata(workspaceId, {
      completedAt: new Date().toISOString(),
      ddgStatus: 'disabled',
      scanRunId: scanRunId || null,
    });
    return;
  }

  try {
    const brandName = String(input.brandName || '').trim();
    const ddgQueries = buildDdgQueries({ brandName, domain });

    await publishPortalIntakeEvent(
      workspaceId,
      'DDG_STARTED',
      'Running DuckDuckGo enrichment for business context and additional sources.',
      {
        stage: 'ddg',
        queryCount: ddgQueries.length,
        queries: ddgQueries,
      },
      scanRunId ? { scanRunId } : undefined
    );

    const brandContextSeed =
      (brandName.length >= 5 ? [brandName, domain].filter(Boolean).join(' ').trim() : '') ||
      domain ||
      brandName ||
      'business';
    const brandContext = await searchBrandContextDDG(
      brandContextSeed,
      workspaceId,
      { timeoutMs: 90_000 }
    );
    const rawResults = await searchRawDDG(ddgQueries, {
      timeoutMs: 90_000,
      maxResults: 120,
      researchJobId: workspaceId,
      source: 'portal_signup_ddg_raw_query',
    });

    logPortalEnrichmentEvent({
      event: 'PORTAL_ENRICHMENT_DDG_COMPLETED',
      workspaceId,
      status: 'completed',
      durationMs: Date.now() - startedAt,
    });

    await publishPortalIntakeEvent(
      workspaceId,
      'DDG_COMPLETED',
      `DDG enrichment completed with ${rawResults.length} raw results.`,
      {
        stage: 'ddg',
        rawResults: rawResults.length,
        hasContextSummary: Boolean(String(brandContext.context_summary || '').trim()),
        instagramHandle: brandContext.instagram_handle || null,
        tiktokHandle: brandContext.tiktok_handle || null,
        websiteUrl: brandContext.website_url || null,
      },
      scanRunId ? { scanRunId } : undefined
    );

    await updateSignupEnrichmentMetadata(workspaceId, {
      completedAt: new Date().toISOString(),
      ddgStatus: 'completed',
      ddgQueries,
      ddgRawCount: rawResults.length,
      contextSummaryPresent: Boolean(String(brandContext.context_summary || '').trim()),
      scanRunId: scanRunId || null,
    });
  } catch (error) {
    logPortalEnrichmentEvent({
      event: 'PORTAL_ENRICHMENT_WARNING',
      workspaceId,
      status: 'warning',
      durationMs: Date.now() - startedAt,
      errorCode: 'DDG_FAILED',
    });
    await publishPortalIntakeEvent(
      workspaceId,
      'ENRICHMENT_WARNING',
      'DDG enrichment failed. Website scan data is still available.',
      {
        stage: 'ddg',
        error: (error as Error)?.message || String(error),
      },
      scanRunId ? { scanRunId } : undefined
    );
    await updateSignupEnrichmentMetadata(workspaceId, {
      completedAt: new Date().toISOString(),
      ddgStatus: 'failed',
      ddgError: (error as Error)?.message || String(error),
      scanRunId: scanRunId || null,
    });
  }

  await publishPortalIntakeEvent(
    workspaceId,
    'ENRICHMENT_DONE',
    'Signup enrichment completed. Intake autofill can use this evidence now.',
    {
      stage: 'finalize',
      scanRunId: scanRunId || null,
    },
    scanRunId ? { scanRunId } : undefined
  );
  logPortalEnrichmentEvent({
    event: 'PORTAL_ENRICHMENT_DONE',
    workspaceId,
    status: 'completed',
    durationMs: Date.now() - startedAt,
  });
}
