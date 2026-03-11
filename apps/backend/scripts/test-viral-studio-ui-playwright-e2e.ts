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

async function waitForCountAtLeast(page: Page, selector: string, minimum: number, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const count = await page.locator(selector).count().catch(() => 0);
    if (count >= minimum) {
      return count;
    }
    await page.waitForTimeout(160);
  }
  throw new Error(`Timed out waiting for "${selector}" to reach count ${minimum}`);
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
  const openViralStudioLink = page.getByRole('link', { name: 'Open Viral Studio' }).first();
  const hasViralStudioLink = (await openViralStudioLink.count().catch(() => 0)) > 0;
  if (hasViralStudioLink) {
    await openViralStudioLink.click();
    await page.waitForURL((url) => /^\/app\/w\/[^/]+\/viral-studio/.test(url.pathname), { timeout: 60_000 });
  } else {
    await page.locator('a[href^="/app/w/"]').first().click();
    await page.waitForURL((url) => /^\/app\/w\/[^/]+/.test(url.pathname), { timeout: 60_000 });
  }

  const workspaceMatch = page.url().match(/\/app\/w\/([^/?#]+)/);
  if (!workspaceMatch?.[1]) {
    throw new Error(`Unable to resolve workspace id from URL: ${page.url()}`);
  }
  return workspaceMatch[1];
}

async function finalizeBrandDna(page: Page) {
  const foundationSlide = page.locator('#vbs-slide-foundation');
  await foundationSlide.getByLabel('Mission').fill('Scale high-converting short-form content with consistent brand narrative.');
  await foundationSlide.getByLabel('Value Proposition').fill('We blend strategy and creative systems to drive measurable demand.');
  await foundationSlide.getByLabel('Product / Service').fill('Viral content strategy and production.');
  await foundationSlide.getByLabel('Region').fill('MENA');
  await foundationSlide.getByRole('button', { name: 'Next', exact: true }).click();

  await foundationSlide.getByLabel('Audience Personas').fill('Founders, Growth marketers');
  await foundationSlide.getByLabel('Pains').fill('Inconsistent content performance');
  await foundationSlide.getByLabel('Desires').fill('Predictable pipeline growth');
  await foundationSlide.getByLabel('Objections').fill('Not sure what angle works');
  await foundationSlide.getByRole('button', { name: 'Next', exact: true }).click();

  await foundationSlide.getByLabel('Banned Phrases').fill('guaranteed overnight success');
  await foundationSlide.getByLabel('Required Claims').fill('results depend on execution');
  await foundationSlide.getByRole('button', { name: 'Next', exact: true }).click();

  await foundationSlide.getByLabel('Exemplar Inputs').fill('Strong hook + proof + CTA');
  await foundationSlide
    .getByLabel('Brand DNA Summary')
    .fill('Direct, strategic, and execution-focused messaging for growth-minded teams.');
  await foundationSlide.getByRole('button', { name: 'Finalize DNA', exact: true }).click();
  await page.getByText('Brand DNA is finalized and active.').waitFor({ timeout: 60_000 });
}

async function runExtraction(page: Page) {
  const extractButton = page.getByRole('button', { name: 'Extract Best Videos', exact: true });
  const visibleNow = await extractButton
    .first()
    .isVisible()
    .catch(() => false);
  if (!visibleNow) {
    const powerModeToggle = page
      .getByRole('button', { name: /Switch To Power Surface|Open Full Workspace/i })
      .first();
    const hasToggle = (await powerModeToggle.count().catch(() => 0)) > 0;
    if (hasToggle) {
      await powerModeToggle.click();
    }
    await extractButton.first().waitFor({ timeout: 20_000 });
  }
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

async function validateLaunchpadActionsAreClickable(page: Page): Promise<void> {
  const actionButtons = page.locator('.vbs-launchpad-foot .vbs-launchpad-action');
  await actionButtons.first().waitFor({ timeout: 20_000 });
  const actionCount = await actionButtons.count();
  assert.ok(actionCount >= 3, `Expected >=3 launchpad action buttons, got ${actionCount}`);

  for (let index = 0; index < Math.min(actionCount, 3); index += 1) {
    const button = actionButtons.nth(index);
    await button.scrollIntoViewIfNeeded();
    // trial click validates hit-target + interactivity without mutating workflow state.
    await button.click({ trial: true });
  }
}

async function validateFoundationGuidance(page: Page) {
  await page.getByRole('tab', { name: /Brand DNA/i }).click();
  await page.locator('#vbs-slide-foundation .vbs-foundation-pulse-grid').waitFor({ timeout: 20_000 });
  await waitForCountAtLeast(page, '#vbs-slide-foundation .vbs-foundation-pulse-card', 4, 20_000);
  await page.locator('#vbs-slide-foundation .vbs-dna-spotlight').waitFor({ timeout: 20_000 });
  await waitForCountAtLeast(page, '#vbs-slide-foundation .vbs-dna-spotlight-stat', 3, 20_000);
}

async function validateDrawerAndShortcuts(page: Page) {
  const firstReference = page.locator('.vbs-reference-card .vbs-reference-card-head').first();
  await firstReference.click();
  const drawer = page.locator('.vbs-analysis-drawer');
  await drawer.waitFor({ timeout: 15_000 });
  await page.locator('.vbs-reference-focus-card').waitFor({ timeout: 15_000 });
  await page.locator('.vbs-analysis-sidecar').waitFor({ timeout: 15_000 });

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

  const focusMetricCards = await page.locator('.vbs-reference-focus-metrics > div').count();
  assert.ok(focusMetricCards >= 3, `Expected focus metrics in reference sidecar, got ${focusMetricCards}`);

  const boardMetricChips = await page.locator('.vbs-reference-card-metrics span').count();
  assert.ok(boardMetricChips >= 3, `Expected reference card metric chips in board, got ${boardMetricChips}`);

  await drawer.locator('.vbs-analysis-why').waitFor({ timeout: 10_000 });
}

async function validateCreateAndSaveFlow(page: Page) {
  await page.getByRole('tab', { name: /Create & Save/i }).click();
  const createSlide = page.locator('#vbs-slide-create');
  await createSlide.waitFor({ timeout: 20_000 });

  await createSlide.getByRole('button', { name: 'Generate Multi-Pack', exact: true }).click();
  await waitForTextContains(page, '#vbs-slide-create .vbs-status-strip', 'Revision', 80_000);
  await page.locator('.vbs-create-preview-board').waitFor({ timeout: 20_000 });
  await waitForCountAtLeast(page, '.vbs-create-preview-card.is-ready', 1, 80_000);
  await waitForCountAtLeast(page, '.vbs-pack-card', 4, 20_000);
  await waitForCountAtLeast(page, '.vbs-quality-gate-card', 3, 20_000);
  await waitForCountAtLeast(page, '.vbs-save-vault-step:not(.is-empty)', 1, 80_000);
  await waitForTextContains(page, '#vbs-slide-create .vbs-status-strip', 'Document ready', 80_000);

  const firstPreviewCard = page.locator('.vbs-create-preview-card.is-ready').first();
  await firstPreviewCard.click();
  await page.waitForTimeout(250);
  const pressed = await firstPreviewCard.getAttribute('aria-pressed');
  assert.equal(pressed, 'true', 'Expected gallery preview handler to become active after click.');

  const versionHandler = page.locator('.vbs-save-vault-step:not(.is-empty)').first();
  await versionHandler.click();
  const versionPressed = await versionHandler.getAttribute('aria-pressed');
  assert.equal(versionPressed, 'true', 'Expected save vault step to become active after click.');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Viral Brand Studio' }).waitFor({ timeout: 60_000 });
  await page.getByRole('tab', { name: /Create & Save/i }).click();
  await page.locator('.vbs-create-preview-board').waitFor({ timeout: 20_000 });
  await waitForTextContains(page, '#vbs-slide-create .vbs-status-strip', 'Revision', 20_000);
  await waitForCountAtLeast(page, '.vbs-create-preview-card.is-ready', 1, 20_000);
  await waitForCountAtLeast(page, '.vbs-save-vault-step:not(.is-empty)', 1, 20_000);
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

    await validateLaunchpadActionsAreClickable(page);
    await validateFoundationGuidance(page);
    await finalizeBrandDna(page);
    await page.locator('#vbs-slide-foundation .vbs-dna-summary-shell').waitFor({ timeout: 20_000 });
    await runExtraction(page);
    await waitForReferenceBoard(page);
    await validateDrawerAndShortcuts(page);
    await validateCreateAndSaveFlow(page);

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
            'launchpad_right_actions_clickable',
            'brand_dna_guidance_surface_rendered',
            'brand_dna_finalize_gate',
            'brand_dna_summary_surface_rendered',
            'extraction_run_completed_with_references',
            'analysis_drawer_renders_extended_sections',
            'reference_sidecar_and_board_metrics_render',
            'shortlist_keyboard_shortcuts_1_2_3_0',
            'shortlist_notice_and_active_state_feedback',
            'generation_gallery_and_save_vault_render',
            'create_and_save_handlers_are_clickable',
            'generation_and_document_survive_reload',
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
