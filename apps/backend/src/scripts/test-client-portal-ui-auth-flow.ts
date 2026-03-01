import assert from 'node:assert/strict';
import puppeteer, { Page } from 'puppeteer';

type FlowDiagnostics = {
  currentUrl: string;
  consoleErrors: string[];
  httpErrors: Array<{ status: number; url: string }>;
  signupDomSnippet: string;
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
  await page.evaluate((label) => {
    const button = Array.from(document.querySelectorAll('button')).find((entry) =>
      (entry.textContent || '').trim() === label
    ) as HTMLButtonElement | undefined;
    if (!button) {
      throw new Error(`Button not found: ${label}`);
    }
    button.click();
  }, text);
}

async function waitForSignupHydration(page: Page, baseUrl: string): Promise<void> {
  await page.goto(`${baseUrl}/signup`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('body');

  // First stage: app shell visible.
  await page.waitForFunction(
    () => {
      const text = document.body.innerText || '';
      return /Checking session\.{3}|Create your BAT workspace/i.test(text);
    },
    { timeout: 45_000 }
  );

  // Second stage: hydration complete and form controls mounted.
  await page.waitForSelector('input[autocomplete="name"]', { timeout: 45_000 });
  await page.waitForSelector('input[autocomplete="email"]', { timeout: 45_000 });
  await page.waitForSelector('input[autocomplete="organization"]', { timeout: 45_000 });
  await page.waitForSelector('input[autocomplete="url"]', { timeout: 45_000 });
  await page.waitForSelector('input[autocomplete="new-password"]', { timeout: 45_000 });
}

async function collectDiagnostics(page: Page, consoleErrors: string[], httpErrors: Array<{ status: number; url: string }>): Promise<FlowDiagnostics> {
  const signupDomSnippet = await page
    .evaluate(() => {
      const signupRoot =
        document.querySelector('form') ||
        document.querySelector('main') ||
        document.querySelector('section') ||
        document.body;
      return (signupRoot?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 700);
    })
    .catch(() => 'Unable to capture signup DOM snippet.');

  return {
    currentUrl: page.url(),
    consoleErrors: consoleErrors.slice(0, 12),
    httpErrors: httpErrors.slice(0, 20),
    signupDomSnippet,
  };
}

async function runFlowAttempt(baseUrl: string): Promise<void> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const consoleErrors: string[] = [];
  const httpErrors: Array<{ status: number; url: string }> = [];

  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(45_000);
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

    const email = `portal.ui.e2e.${Date.now()}@example.com`;
    const password = 'TestPass123!';

    await waitForSignupHydration(page, baseUrl);
    await page.type('input[autocomplete="name"]', 'Portal UI E2E');
    await page.type('input[autocomplete="email"]', email);
    await page.type('input[autocomplete="organization"]', 'Portal UI QA');
    await page.type('input[autocomplete="url"]', 'https://portal-ui-qa.example.com');
    await page.type('input[autocomplete="new-password"]', password);
    await page.click('button[type="submit"]');

    await page.waitForFunction(() => window.location.pathname === '/verify-email-code', { timeout: 45_000 });
    await page.waitForSelector('input[type="text"]', { timeout: 45_000 });
    await page.click('input[type="text"]');
    await page.keyboard.type('00000');
    await clickButtonByText(page, 'Verify code');
    await page.waitForFunction(() => window.location.pathname === '/login', { timeout: 45_000 });

    await page.waitForSelector('input[autocomplete="email"]', { timeout: 45_000 });
    await page.waitForSelector('input[autocomplete="current-password"]', { timeout: 45_000 });
    await page.click('input[autocomplete="email"]', { clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.type('input[autocomplete="email"]', email);
    await page.type('input[autocomplete="current-password"]', password);
    await page.click('button[type="submit"]');

    await page.waitForFunction(() => window.location.pathname === '/app', { timeout: 45_000 });
    await page.waitForSelector('a[href^="/app/w/"]', { timeout: 45_000 });
    await page.click('a[href^="/app/w/"]');
    await page.waitForFunction(() => window.location.pathname.startsWith('/app/w/'), { timeout: 45_000 });
    await page.waitForFunction(() => document.body.innerText.includes('Initialize BAT Brain'), { timeout: 45_000 });

    const cookiesAfterLogin = await page.cookies();
    const loginCookieHeader = cookieHeaderFrom(cookiesAfterLogin);
    assert.ok(loginCookieHeader.includes('portal_session='), 'Login did not establish session cookie');

    console.log(
      JSON.stringify(
        {
          ok: true,
          baseUrl,
          checks: [
            'signup_shell_rendered',
            'signup_hydrated_form_rendered',
            'signup_form_submission',
            'redirect_to_verify_email_code',
            'verify_code_submission',
            'redirect_to_login_after_verification',
            'login_form_submission',
            'session_cookie_created_after_login',
            'workspace_intake_entry',
          ],
        },
        null,
        2
      )
    );
  } catch (error) {
    const page = (await browser.pages())[0];
    const diagnostics = page
      ? await collectDiagnostics(page, consoleErrors, httpErrors)
      : {
          currentUrl: `${baseUrl}/signup`,
          consoleErrors: consoleErrors.slice(0, 12),
          httpErrors: httpErrors.slice(0, 20),
          signupDomSnippet: 'No page context available.',
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
      if (attempt >= maxAttempts) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
  }

  if (lastError instanceof FlowError) {
    console.error('[ClientPortalUIAuthFlow] FAILED');
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
    console.error('[ClientPortalUIAuthFlow] FAILED', lastError);
  }

  process.exit(1);
}

main().catch((error) => {
  console.error('[ClientPortalUIAuthFlow] FAILED', error);
  process.exit(1);
});
