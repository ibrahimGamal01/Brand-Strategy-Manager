import assert from 'node:assert/strict';
import { chromium, Page } from 'playwright';

type FlowDiagnostics = {
  currentUrl: string;
  consoleErrors: string[];
  httpErrors: Array<{ status: number; url: string }>;
  domSnippet: string;
};

class FlowError extends Error {
  diagnostics: FlowDiagnostics;

  constructor(message: string, diagnostics: FlowDiagnostics) {
    super(message);
    this.name = 'FlowError';
    this.diagnostics = diagnostics;
  }
}

function cookieHeaderFrom(pageCookies: Array<{ name: string; value: string }>) {
  return pageCookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
}

async function clickButtonByText(page: Page, text: string) {
  await page.getByRole('button', { name: text, exact: true }).click();
}

async function waitForTextContains(
  page: Page,
  selector: string,
  expectedFragment: string,
  timeoutMs = 12_000
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await page.locator(selector).first().textContent().catch(() => null);
    const normalized = String(value || '').toLowerCase();
    if (normalized.includes(expectedFragment.toLowerCase())) {
      return;
    }
    await page.waitForTimeout(120);
  }
  throw new Error(`Timed out waiting for "${selector}" to include "${expectedFragment}"`);
}

async function waitForSelectedShortlistState(page: Page, label: string, timeoutMs = 12_000) {
  const button = page
    .locator('.vbs-reference-card.is-selected .vbs-shortlist-actions button', { hasText: label })
    .first();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pressed = await button.getAttribute('aria-pressed').catch(() => null);
    if (pressed === 'true') {
      return;
    }
    await page.waitForTimeout(120);
  }
  throw new Error(`Timed out waiting for selected shortlist action "${label}" to become active.`);
}

async function waitForSignupHydration(page: Page, baseUrl: string): Promise<void> {
  await page.goto(`${baseUrl}/signup`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('body');
  await page.waitForSelector('input[autocomplete="name"]', { timeout: 60_000 });
  await page.waitForSelector('input[autocomplete="email"]', { timeout: 60_000 });
  await page.waitForSelector('input[autocomplete="organization"]', { timeout: 60_000 });
  await page.waitForSelector('input[autocomplete="url"]', { timeout: 60_000 });
  await page.waitForSelector('input[autocomplete="new-password"]', { timeout: 60_000 });
}

async function completeAuthAndResolveWorkspace(page: Page, baseUrl: string): Promise<string> {
  const email = `viral.studio.playwright.${Date.now()}@example.com`;
  const password = 'TestPass123!';

  await waitForSignupHydration(page, baseUrl);
  await page.locator('input[autocomplete="name"]').fill('Viral Studio Playwright');
  await page.locator('input[autocomplete="email"]').fill(email);
  await page.locator('input[autocomplete="organization"]').fill('Viral Studio QA');
  await page.locator('input[autocomplete="url"]').fill('https://viral-studio-qa.example.com');
  await page.locator('input[autocomplete="new-password"]').fill(password);
  await page.getByRole('button', { name: 'Create Workspace' }).click();

  await page.waitForURL((url) => url.pathname === '/verify-email-code', { timeout: 60_000 });
  await page.locator('input[type="text"]').fill('00000');
  await clickButtonByText(page, 'Verify code');
  await page.waitForURL((url) => url.pathname === '/login', { timeout: 60_000 });

  await page.locator('input[autocomplete="email"]').fill(email);
  await page.locator('input[autocomplete="current-password"]').fill(password);
  await page.getByRole('button', { name: /^(Sign in|Log in)$/i }).first().click();

  await page.waitForURL((url) => url.pathname === '/app', { timeout: 60_000 });
  await page.locator('a[href^="/app/w/"]').first().click();
  await page.waitForURL((url) => /^\/app\/w\/[^/]+/.test(url.pathname), { timeout: 60_000 });

  const workspaceMatch = page.url().match(/\/app\/w\/([^/?#]+)/);
  if (!workspaceMatch?.[1]) {
    throw new Error(`Unable to resolve workspace id from URL: ${page.url()}`);
  }
  return workspaceMatch[1];
}

async function finalizeBrandDna(page: Page) {
  await page.getByLabel('Mission').fill('Scale high-converting short-form content with consistent brand narrative.');
  await page.getByLabel('Value Proposition').fill('We blend strategy and creative systems to drive measurable demand.');
  await page.getByLabel('Product / Service').fill('Viral content strategy and production.');
  await page.getByLabel('Region').fill('MENA');
  await clickButtonByText(page, 'Next');

  await page.getByLabel('Audience Personas').fill('Founders, Growth marketers');
  await page.getByLabel('Pains').fill('Inconsistent content performance');
  await page.getByLabel('Desires').fill('Predictable pipeline growth');
  await page.getByLabel('Objections').fill('Not sure what angle works');
  await clickButtonByText(page, 'Next');

  await page.getByLabel('Banned Phrases').fill('guaranteed overnight success');
  await page.getByLabel('Required Claims').fill('results depend on execution');
  await clickButtonByText(page, 'Next');

  await page.getByLabel('Exemplar Inputs').fill('Strong hook + proof + CTA');
  await page
    .getByLabel('Brand DNA Summary')
    .fill('Direct, strategic, and execution-focused messaging for growth-minded teams.');
  await clickButtonByText(page, 'Finalize DNA');
  await page.getByText('Brand DNA is finalized and active.').waitFor({ timeout: 60_000 });
}

async function runExtraction(page: Page) {
  await clickButtonByText(page, 'Extract Best Videos');
  await page.getByRole('dialog', { name: /Extract best videos/i }).waitFor({ timeout: 20_000 });
  await page.getByLabel('Source URL').fill('https://instagram.com/viral.studio.reference');
  await clickButtonByText(page, 'Start Extraction Run');
}

async function waitForReferenceBoard(page: Page): Promise<void> {
  const cards = page.locator('.vbs-reference-card .vbs-reference-card-head');
  await cards.first().waitFor({ timeout: 70_000 });
  const count = await cards.count();
  assert.ok(count > 0, 'Expected at least one reference card after extraction.');
}

async function validateDrawerAndShortcuts(page: Page) {
  const firstReference = page.locator('.vbs-reference-card .vbs-reference-card-head').first();
  await firstReference.click();
  const drawer = page.locator('.vbs-analysis-drawer');
  await drawer.waitFor({ timeout: 15_000 });

  await page.keyboard.press('2');
  await waitForSelectedShortlistState(page, 'Must-use');
  await waitForTextContains(page, '.vbs-curation-notice', 'Must-use');

  await page.keyboard.press('3');
  await waitForSelectedShortlistState(page, 'Exclude');
  await waitForTextContains(page, '.vbs-curation-notice', 'Excluded');

  await page.keyboard.press('0');
  await waitForSelectedShortlistState(page, 'Clear');
  await waitForTextContains(page, '.vbs-curation-notice', 'cleared');

  await page.keyboard.press('1');
  await waitForSelectedShortlistState(page, 'Pin');
  await waitForTextContains(page, '.vbs-curation-notice', 'Pinned');

  await drawer.getByText('Source Context').waitFor({ timeout: 10_000 });
  await drawer.getByText(/Formula viral-score-v1/i).waitFor({ timeout: 10_000 });
  await drawer.getByText(/Shortcuts: 1 pin, 2 must-use, 3 exclude, 0 clear/i).waitFor({ timeout: 10_000 });

  const kpiCards = await drawer.locator('.vbs-analysis-kpi-grid > div').count();
  assert.ok(kpiCards >= 4, `Expected >=4 KPI cards in analysis drawer, got ${kpiCards}`);

  const driverChips = await drawer.locator('.vbs-driver-chip').count();
  assert.ok(driverChips >= 1, `Expected top-driver chips in analysis drawer, got ${driverChips}`);

  const normalizedMetricCards = await drawer.locator('.vbs-normalized-grid .vbs-analysis-metric').count();
  assert.ok(
    normalizedMetricCards >= 5,
    `Expected normalized metric rows in analysis drawer, got ${normalizedMetricCards}`
  );
}

async function collectDiagnostics(
  page: Page,
  consoleErrors: string[],
  httpErrors: Array<{ status: number; url: string }>
): Promise<FlowDiagnostics> {
  const domSnippet = await page
    .locator('body')
    .innerText()
    .then((text) => text.replace(/\s+/g, ' ').trim().slice(0, 800))
    .catch(() => 'Unable to capture DOM snippet.');
  return {
    currentUrl: page.url(),
    consoleErrors: consoleErrors.slice(0, 14),
    httpErrors: httpErrors.slice(0, 24),
    domSnippet,
  };
}

async function runFlowAttempt(baseUrl: string): Promise<void> {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const consoleErrors: string[] = [];
  const httpErrors: Array<{ status: number; url: string }> = [];
  let page: Page | null = null;

  try {
    const context = await browser.newContext();
    page = await context.newPage();
    page.setDefaultTimeout(60_000);

    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });
    page.on('response', (response) => {
      if (response.status() >= 400) {
        httpErrors.push({ status: response.status(), url: response.url() });
      }
    });

    const workspaceId = await completeAuthAndResolveWorkspace(page, baseUrl);
    await page.goto(`${baseUrl}/app/w/${workspaceId}/viral-studio`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Viral Brand Studio' }).waitFor({ timeout: 60_000 });

    await finalizeBrandDna(page);
    await runExtraction(page);
    await waitForReferenceBoard(page);
    await validateDrawerAndShortcuts(page);

    const cookiesAfterLogin = await context.cookies();
    const cookieHeader = cookieHeaderFrom(cookiesAfterLogin);
    assert.ok(cookieHeader.includes('portal_session='), 'Session cookie missing after auth flow');

    console.log(
      JSON.stringify(
        {
          ok: true,
          baseUrl,
          checks: [
            'signup_and_login_flow',
            'viral_studio_route_loaded',
            'brand_dna_finalize_gate',
            'extraction_run_completed_with_references',
            'analysis_drawer_renders_extended_sections',
            'shortlist_keyboard_shortcuts_1_2_3_0',
            'shortlist_notice_and_active_state_feedback',
          ],
        },
        null,
        2
      )
    );
  } catch (error) {
    const diagnostics = page
      ? await collectDiagnostics(page, consoleErrors, httpErrors)
      : {
          currentUrl: `${baseUrl}/signup`,
          consoleErrors: consoleErrors.slice(0, 14),
          httpErrors: httpErrors.slice(0, 24),
          domSnippet: 'No page context available.',
        };
    throw new FlowError(error instanceof Error ? error.message : String(error), diagnostics);
  } finally {
    await browser.close();
  }
}

async function main() {
  const baseUrl = String(process.env.PORTAL_UI_E2E_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const maxAttempts = 2;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await runFlowAttempt(baseUrl);
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) break;
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
  }

  if (lastError instanceof FlowError) {
    console.error('[ViralStudioPlaywrightE2E] FAILED');
    console.error(
      JSON.stringify(
        {
          ok: false,
          error: lastError.message,
          diagnostics: lastError.diagnostics,
        },
        null,
        2
      )
    );
  } else {
    console.error('[ViralStudioPlaywrightE2E] FAILED', lastError);
  }
  process.exit(1);
}

main().catch((error) => {
  console.error('[ViralStudioPlaywrightE2E] FAILED', error);
  process.exit(1);
});
