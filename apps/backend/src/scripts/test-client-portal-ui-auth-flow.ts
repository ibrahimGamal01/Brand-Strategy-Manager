import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';

function cookieHeaderFrom(pageCookies: Array<{ name: string; value: string }>) {
  return pageCookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
}

async function apiRequest(
  baseUrl: string,
  path: string,
  input: RequestInit,
  cookieHeader: string
) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...input,
    headers: {
      ...(input.headers || {}),
      cookie: cookieHeader,
    },
  });
  const json = await response.json().catch(() => ({}));
  return { status: response.status, json };
}

async function main() {
  const baseUrl = String(process.env.PORTAL_UI_E2E_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const email = `portal.ui.e2e.${Date.now()}@example.com`;
  const password = 'TestPass123!';
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(30_000);

    await page.goto(`${baseUrl}/signup`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('form');
    await page.type('input[autocomplete="name"]', 'Portal UI E2E');
    await page.type('input[autocomplete="email"]', email);
    await page.type('input[autocomplete="organization"]', 'Portal UI QA');
    await page.type('input[autocomplete="new-password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForFunction(
      () => window.location.pathname === '/app',
      { timeout: 30_000 }
    );

    await page.waitForSelector('a[href^="/app/w/"]');
    await page.click('a[href^="/app/w/"]');
    await page.waitForFunction(
      () => window.location.pathname.startsWith('/app/w/'),
      { timeout: 30_000 }
    );
    await page.waitForFunction(
      () => document.body.innerText.includes('Initialize BAT Brain'),
      { timeout: 30_000 }
    );

    await page.click('input[required]');
    await page.keyboard.type('Portal UI E2E Brand');
    await page.click('input[placeholder="@username"]');
    await page.keyboard.type('portaluie2e');
    await page.click('button[type="submit"]');

    await page.waitForFunction(
      () => document.body.innerText.includes('Confirm and start BAT'),
      { timeout: 30_000 }
    );
    await page.evaluate(() => {
      const button = Array.from(document.querySelectorAll('button')).find((entry) =>
        (entry.textContent || '').includes('Confirm and start BAT')
      ) as HTMLButtonElement | undefined;
      if (!button) {
        throw new Error('Confirm and start BAT button not found');
      }
      button.click();
    });

    await page.waitForFunction(
      () => document.body.innerText.includes('Workspace') && !document.body.innerText.includes('Initialize BAT Brain'),
      { timeout: 60_000 }
    );

    const cookiesAfterSignup = await page.cookies();
    const signupCookieHeader = cookieHeaderFrom(cookiesAfterSignup);
    assert.ok(signupCookieHeader.includes('portal_session='), 'Signup UI flow did not establish session cookie');

    const resend = await apiRequest(
      baseUrl,
      '/api/portal/auth/resend-verification',
      { method: 'POST' },
      signupCookieHeader
    );
    assert.equal(resend.status, 200, 'Resend verification failed during UI flow test');
    const debugToken = String(resend.json?.debugVerificationToken || '');
    assert.ok(debugToken, 'Resend verification did not return debug token (non-production expected)');

    await page.goto(`${baseUrl}/verify-email?token=${encodeURIComponent(debugToken)}`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.body.innerText.includes('verified successfully'), { timeout: 20_000 });

    await page.goto(`${baseUrl}/app`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('button');
    await page.evaluate(() => {
      const button = Array.from(document.querySelectorAll('button')).find((entry) =>
        (entry.textContent || '').includes('Log out')
      ) as HTMLButtonElement | undefined;
      if (!button) {
        throw new Error('Logout button not found in app shell');
      }
      button.click();
    });
    await page.waitForFunction(
      () => window.location.pathname === '/login',
      { timeout: 30_000 }
    );

    await page.waitForSelector('form');
    await page.type('input[autocomplete="email"]', email);
    await page.type('input[autocomplete="current-password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForFunction(
      () => window.location.pathname === '/app',
      { timeout: 30_000 }
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          baseUrl,
        checks: [
          'signup_form_submission',
          'workspace_intro_form_completion',
          'session_cookie_created',
          'verify_email_via_verify_page',
          'logout_button_flow',
            'login_form_submission',
          ],
        },
        null,
        2
      )
    );
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error('[ClientPortalUIAuthFlow] FAILED', error);
  process.exit(1);
});
