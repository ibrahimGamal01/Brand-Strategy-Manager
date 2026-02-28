import { prisma } from '../../lib/prisma';
import { searchBrandContextDDG, searchRawDDG } from '../discovery/duckduckgo-search';
import { publishPortalIntakeEvent } from './portal-intake-events';
import {
  parseWebsiteList,
  PortalIntakeScanMode,
  queuePortalIntakeWebsiteScan,
} from './portal-intake-websites';

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
  const queries = [
    [brandName, domain].filter(Boolean).join(' ').trim(),
    [brandName, 'official website'].filter(Boolean).join(' ').trim(),
    domain ? `${domain} reviews` : '',
    [brandName, 'pricing'].filter(Boolean).join(' ').trim(),
    [brandName, 'instagram tiktok youtube'].filter(Boolean).join(' ').trim(),
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
  const workspaceId = String(input.workspaceId || '').trim();
  if (!workspaceId) return;

  const websites = parseWebsiteList([input.website, input.websites], 5);
  const primaryWebsite = websites[0] || '';
  const domain = toHostname(primaryWebsite);
  const scanMode = resolveSignupScanMode();
  const ddgEnabled = isSignupDdgEnabled();

  let scanRunId: string | undefined;

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
    } catch (error) {
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

    const brandContext = await searchBrandContextDDG(
      [brandName, domain].filter(Boolean).join(' ').trim() || brandName || domain || 'business',
      workspaceId,
      { timeoutMs: 90_000 }
    );
    const rawResults = await searchRawDDG(ddgQueries, {
      timeoutMs: 90_000,
      maxResults: 120,
      researchJobId: workspaceId,
      source: 'portal_signup_ddg_raw_query',
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
}
