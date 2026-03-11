import assert from 'node:assert/strict';
import { chromium, Locator, Page } from 'playwright';

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

async function waitForEnabled(locator: Locator, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const disabled = await locator.isDisabled().catch(() => true);
    if (!disabled) {
      return;
    }
    await locator.scrollIntoViewIfNeeded().catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('Timed out waiting for control to become enabled');
}

async function waitForInputValue(page: Page, selector: string, expectedValue: string, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const values = await page
      .locator(selector)
      .evaluateAll((elements) =>
        elements.map((element) => {
          if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
            return element.value;
          }
          return '';
        })
      )
      .catch(() => []);
    if (values.includes(expectedValue)) {
      return;
    }
    await page.waitForTimeout(150);
  }
  throw new Error(`Timed out waiting for input selector "${selector}" to contain "${expectedValue}"`);
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

async function loginExistingUser(
  page: Page,
  baseUrl: string,
  email: string,
  password: string
): Promise<string> {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[autocomplete="email"]', { timeout: 60_000 });
  await page.waitForSelector('input[autocomplete="current-password"]', { timeout: 60_000 });
  await page.locator('input[autocomplete="email"]').fill(email);
  await page.locator('input[autocomplete="current-password"]').fill(password);
  await page.getByRole('button', { name: /^(Sign in|Log in)$/i }).first().click();

  await page.waitForURL((url) => url.pathname.startsWith('/app'), { timeout: 60_000 });
  const viralStudioLink = page.getByRole('link', { name: 'Open Viral Studio' }).first();
  const hasViralStudioLink = (await viralStudioLink.count().catch(() => 0)) > 0;
  if (hasViralStudioLink) {
    await viralStudioLink.click();
    await page.waitForURL((url) => /^\/app\/w\/[^/]+\/viral-studio/.test(url.pathname), { timeout: 60_000 });
  } else {
    await page.locator('a[href^="/app/w/"]').first().click();
    await page.waitForURL((url) => /^\/app\/w\/[^/]+/.test(url.pathname), { timeout: 60_000 });
  }

  const workspaceMatch = page.url().match(/\/app\/w\/([^/?#]+)/);
  if (!workspaceMatch?.[1]) {
    throw new Error(`Unable to resolve workspace id from URL after login: ${page.url()}`);
  }
  return workspaceMatch[1];
}

async function completeAuthAndResolveWorkspace(page: Page, baseUrl: string): Promise<string> {
  const existingEmail = String(process.env.PORTAL_UI_E2E_EMAIL || '').trim();
  const existingPassword = String(process.env.PORTAL_UI_E2E_PASSWORD || '').trim();
  if (existingEmail && existingPassword) {
    return loginExistingUser(page, baseUrl, existingEmail, existingPassword);
  }

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
  const onboardingSection = page.locator('#vbs-section-onboarding');
  await onboardingSection.scrollIntoViewIfNeeded();
  if (await onboardingSection.getByText('Brand DNA is finalized and active.').isVisible().catch(() => false)) {
    return;
  }

  await onboardingSection.getByLabel('Mission').fill('Scale high-converting short-form content with consistent brand narrative.');
  await onboardingSection.getByLabel('Value Proposition').fill('We blend strategy and creative systems to drive measurable demand.');
  await onboardingSection.getByLabel('Product / Service').fill('Viral content strategy and production.');
  await onboardingSection.getByLabel('Region').fill('MENA');
  await onboardingSection.getByRole('button', { name: 'Next', exact: true }).click();

  await onboardingSection.getByLabel('Audience Personas').fill('Founders, Growth marketers');
  await onboardingSection.getByLabel('Pains').fill('Inconsistent content performance');
  await onboardingSection.getByLabel('Desires').fill('Predictable pipeline growth');
  await onboardingSection.getByLabel('Objections').fill('Not sure what angle works');
  await onboardingSection.getByRole('button', { name: 'Next', exact: true }).click();

  await onboardingSection.getByLabel('Banned Phrases').fill('guaranteed overnight success');
  await onboardingSection.getByLabel('Required Claims').fill('results depend on execution');
  await onboardingSection.getByRole('button', { name: 'Next', exact: true }).click();

  await onboardingSection.getByLabel('Exemplar Inputs').fill('Strong hook + proof + CTA');
  await onboardingSection
    .getByLabel('Brand DNA Summary')
    .fill('Direct, strategic, and execution-focused messaging for growth-minded teams.');
  await onboardingSection.getByRole('button', { name: 'Finalize DNA', exact: true }).click();
  await page.getByText('Brand DNA is finalized and active.').waitFor({ timeout: 60_000 });
}

async function runExtraction(page: Page) {
  if ((await page.locator('.vbs-reference-card .vbs-reference-card-head').count().catch(() => 0)) > 0) {
    return;
  }
  const extractButton = page.getByRole('button', { name: 'Extract Best Videos', exact: true });
  await page.locator('#vbs-section-extraction').scrollIntoViewIfNeeded();
  await extractButton.first().waitFor({ timeout: 20_000 });
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
  const actionButtons = page.locator('.vbs-launchpad-grid .vbs-launchpad-card .vbs-launchpad-foot button');
  await actionButtons.first().scrollIntoViewIfNeeded();
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
  const onboardingSection = page.locator('#vbs-section-onboarding');
  await onboardingSection.scrollIntoViewIfNeeded();
  await onboardingSection.waitFor({ timeout: 20_000 });
  await onboardingSection.locator('.vbs-detail-grid article').first().waitFor({ timeout: 20_000 });
  await waitForCountAtLeast(page, '#vbs-section-onboarding .vbs-detail-grid article', 3, 20_000);
  const finalizedView = await onboardingSection.getByText('Brand DNA is finalized and active.').isVisible().catch(() => false);
  if (finalizedView) {
    await onboardingSection.getByRole('button', { name: /Edit Brand DNA/i }).waitFor({ timeout: 20_000 });
    return;
  }
  await onboardingSection.locator('.vbs-dna-step-tabs').waitFor({ timeout: 20_000 });
  await waitForCountAtLeast(page, '#vbs-section-onboarding .vbs-dna-step-tabs button', 4, 20_000);
  await onboardingSection.locator('.vbs-dna-sidecar').waitFor({ timeout: 20_000 });
}

async function validateDrawerAndShortcuts(page: Page) {
  await page.locator('#vbs-section-extraction').scrollIntoViewIfNeeded();
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

  const boardMetricCards = await page.locator('.vbs-reference-metric-strip > div').count();
  assert.ok(boardMetricCards >= 3, `Expected reference card metrics in board, got ${boardMetricCards}`);

  await drawer.locator('.vbs-source-context').waitFor({ timeout: 10_000 });
}

async function validateCreateAndSaveFlow(page: Page) {
  const createSection = page.locator('#vbs-section-create-save');
  await createSection.scrollIntoViewIfNeeded();
  await createSection.waitFor({ timeout: 20_000 });
  await createSection.locator('.vbs-staged-planner').waitFor({ timeout: 20_000 });

  await createSection.getByRole('button', { name: /Analyze design directions/i }).first().click();
  await waitForCountAtLeast(page, '#vbs-section-create-save .vbs-planner-card-grid .vbs-planner-card', 3, 80_000);

  const compareButton = createSection
    .locator('.vbs-planner-card')
    .first()
    .getByRole('button', { name: /^Compare$/i });
  await compareButton.click();
  await waitForCountAtLeast(page, '#vbs-section-create-save .vbs-planner-compare-card', 1, 20_000);

  const useDesignButton = createSection
    .locator('.vbs-planner-card')
    .first()
    .getByRole('button', { name: /Use this design|Approved/i });
  await useDesignButton.click();
  await useDesignButton.getByText(/Approved/i).waitFor({ timeout: 20_000 }).catch(() => undefined);
  await createSection.getByText(/Design locked:/i).waitFor({ timeout: 20_000 });

  await createSection.getByRole('button', { name: /Analyze content directions/i }).first().click();
  await waitForCountAtLeast(page, '#vbs-section-create-save .vbs-planner-card-grid .vbs-planner-card', 3, 80_000);

  const useContentButton = createSection
    .locator('.vbs-planner-step')
    .nth(1)
    .locator('.vbs-planner-card')
    .first()
    .getByRole('button', { name: /Use this content|Approved/i });
  await useContentButton.click();
  await useContentButton.getByText(/Approved/i).waitFor({ timeout: 20_000 }).catch(() => undefined);

  await createSection.getByRole('button', { name: 'Carousel', exact: true }).click();
  const generateButton = createSection.getByRole('button', { name: /Generate format details|Generate next format/i }).first();
  await waitForEnabled(generateButton, 20_000);
  await generateButton.click();

  await waitForCountAtLeast(page, '#vbs-section-create-save .vbs-format-result-grid .vbs-planner-result-card', 3, 80_000);
  await createSection.locator('.vbs-planner-result-card').nth(0).getByText(/^Design details$/i).waitFor({ timeout: 20_000 });
  await createSection.locator('.vbs-planner-result-card').nth(1).getByText(/^Content details$/i).waitFor({ timeout: 20_000 });

  const saveButton = createSection.getByRole('button', { name: /Save To Document|Document Ready/i }).first();
  await saveButton.waitFor({ timeout: 20_000 });
  const saveLabel = (await saveButton.textContent().catch(() => '')).trim();
  const saveDisabled = await saveButton.isDisabled().catch(() => false);
  if (!saveDisabled && /save to document/i.test(saveLabel)) {
    await saveButton.click();
  }
  await page.locator('#vbs-section-documents').scrollIntoViewIfNeeded();
  await waitForInputValue(page, '#vbs-section-documents .vbs-doc-section-head input', 'Design Details', 20_000);
  await waitForInputValue(page, '#vbs-section-documents .vbs-doc-section-head input', 'Content Details', 20_000);

  await createSection.locator('.vbs-advanced-fallback').waitFor({ timeout: 20_000 });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Viral Brand Studio' }).waitFor({ timeout: 60_000 });
  await page.locator('#vbs-section-create-save').scrollIntoViewIfNeeded();
  await page.locator('#vbs-section-create-save .vbs-staged-planner').waitFor({ timeout: 20_000 });
  await page.locator('#vbs-section-documents').scrollIntoViewIfNeeded();
  await waitForInputValue(page, '#vbs-section-documents .vbs-doc-section-head input', 'Design Details', 20_000);
  await waitForInputValue(page, '#vbs-section-documents .vbs-doc-section-head input', 'Content Details', 20_000);
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
    await page.locator('#vbs-section-onboarding').getByText('Brand DNA is finalized and active.').waitFor({ timeout: 20_000 });
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
            'reference_board_metrics_render',
            'shortlist_keyboard_shortcuts_1_2_3_0',
            'shortlist_notice_and_active_state_feedback',
            'staged_design_direction_board_rendered',
            'staged_content_direction_board_rendered',
            'single_format_generation_rendered',
            'staged_document_save_survives_reload',
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
