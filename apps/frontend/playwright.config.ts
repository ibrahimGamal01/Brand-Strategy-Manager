import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  workers: 1,
  expect: {
    timeout: 45_000,
  },
  retries: Number(process.env.PW_RETRIES || (process.env.CI ? '2' : '1')),
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: process.env.FRONTEND_BASE_URL || 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
});
