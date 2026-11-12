import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: 'account-expiry.spec.ts',
  use: { headless: true },
  webServer: {
    command: 'npm run e2e:api',
    url: 'http://127.0.0.1:3000/health',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
