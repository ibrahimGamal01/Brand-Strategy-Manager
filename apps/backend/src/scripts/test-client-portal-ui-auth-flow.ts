import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';

function cookieHeaderFrom(pageCookies: Array<{ name: string; value: string }>) {
  return pageCookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
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

    const clickButtonByText = async (text: string) => {
      await page.evaluate((label) => {
        const button = Array.from(document.querySelectorAll('button')).find((entry) =>
          (entry.textContent || '').trim() === label
        ) as HTMLButtonElement | undefined;
        if (!button) {
          throw new Error(`Button not found: ${label}`);
        }
        button.click();
      }, text);
    };

    await page.goto(`${baseUrl}/signup`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('form');
    await page.type('input[autocomplete="name"]', 'Portal UI E2E');
    await page.type('input[autocomplete="email"]', email);
    await page.type('input[autocomplete="organization"]', 'Portal UI QA');
    await page.type('input[autocomplete="url"]', 'https://portal-ui-qa.example.com');
    await page.type('input[autocomplete="new-password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForFunction(
      () => window.location.pathname === '/verify-email-code',
      { timeout: 30_000 }
    );

    await page.waitForSelector('input[type="text"]');
    await page.click('input[type="text"]');
    await page.keyboard.type('00000');
    await clickButtonByText('Verify code');
    await page.waitForFunction(
      () => window.location.pathname === '/login',
      { timeout: 30_000 }
    );

    await page.waitForSelector('form');
    await page.$eval('input[autocomplete="email"]', (el) => {
      (el as HTMLInputElement).value = '';
    });
    await page.$eval('input[autocomplete="current-password"]', (el) => {
      (el as HTMLInputElement).value = '';
    });
    await page.click('input[autocomplete="email"]');
    await page.keyboard.type(email);
    await page.type('input[autocomplete="current-password"]', password);
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

    const cookiesAfterLogin = await page.cookies();
    const loginCookieHeader = cookieHeaderFrom(cookiesAfterLogin);
    assert.ok(loginCookieHeader.includes('portal_session='), 'Login did not establish session cookie');

    console.log(
      JSON.stringify(
        {
          ok: true,
          baseUrl,
        checks: [
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
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error('[ClientPortalUIAuthFlow] FAILED', error);
  process.exit(1);
});
