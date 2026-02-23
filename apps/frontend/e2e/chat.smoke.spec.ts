import { expect, test } from '@playwright/test';

const configuredJobIds = String(
  process.env.CHAT_SMOKE_JOB_IDS ||
    'f3f6ccd8-c995-4e9f-8d48-d1df90f80ba2,0d4c899a-ad2c-48f8-94df-576247fdbfd8',
)
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);

for (const jobId of configuredJobIds) {
  test(`workspace chat smoke (${jobId})`, async ({ page }) => {
    await page.goto(`/research/${jobId}?module=chat`, { waitUntil: 'domcontentloaded' });

    const textarea = page.getByPlaceholder(/Ask BAT anything about your brand/i);
    await expect(textarea).toBeVisible();

    const assistantLabels = page.getByText('BAT Intelligence', { exact: true });
    const beforeCount = await assistantLabels.count();
    const prompt = `smoke-test-${Date.now()} link examples`;

    await textarea.fill(prompt);
    await textarea.press('Enter');

    await expect(page.getByText(prompt)).toBeVisible();
    await expect(assistantLabels).toHaveCount(beforeCount + 1, { timeout: 75_000 });
  });

  test(`strategy doc chat smoke (${jobId})`, async ({ page }) => {
    await page.goto(`/research/${jobId}?module=strategy_docs`, { waitUntil: 'domcontentloaded' });

    const sessionResponse = await page.request.post(`/api/strategy/${jobId}/chat/sessions`, {
      data: { scope: 'ALL' },
    });
    expect(sessionResponse.ok()).toBeTruthy();
    const sessionPayload = (await sessionResponse.json()) as {
      success?: boolean;
      session?: { id?: string };
    };
    expect(sessionPayload.success).toBeTruthy();
    const sessionId = String(sessionPayload.session?.id || '');
    expect(sessionId.length).toBeGreaterThan(0);

    const prompt = `smoke-test-${Date.now()} improve this strategy`;
    const messageResponse = await page.request.post(`/api/strategy/${jobId}/chat/sessions/${sessionId}/messages`, {
      data: { message: prompt },
    });
    expect(messageResponse.ok()).toBeTruthy();
    const messagePayload = (await messageResponse.json()) as {
      success?: boolean;
      assistantMessage?: { content?: string };
      messages?: Array<{ role?: string; content?: string }>;
    };
    expect(messagePayload.success).toBeTruthy();
    expect(String(messagePayload.assistantMessage?.content || '').trim().length).toBeGreaterThan(0);
    expect(Array.isArray(messagePayload.messages)).toBeTruthy();
  });
}
