import { defineConfig } from '@playwright/test';

const apiOrigin = process.env.E2E_API_ORIGIN ?? 'http://127.0.0.1:3000';

export default defineConfig({
  testDir: './e2e',
  outputDir: 'test-results/expiry',
  testMatch: ['account-expiry.spec.ts', 'invitations-expiry.spec.ts'],
  use: { headless: true },
  webServer: {
    command: 'npm run e2e:api',
    url: `${apiOrigin}/health`,
    env: { PORT: new URL(apiOrigin).port },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
