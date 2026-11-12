import { defineConfig, devices } from '@playwright/test';

const apiOrigin = process.env.E2E_API_ORIGIN ?? 'http://127.0.0.1:3000';
const webOrigin = process.env.E2E_WEB_ORIGIN ?? 'http://127.0.0.1:5173';

export default defineConfig({
  testDir: './e2e',
  outputDir: 'test-results/browser',
  workers: 1,
  projects: [
    {
      name: 'desktop',
      testMatch: 'account.spec.ts',
      use: { viewport: { width: 1280, height: 800 } },
    },
    { name: 'mobile', testMatch: 'account.spec.ts', use: { ...devices['Pixel 5'] } },
    { name: 'api', testMatch: 'account-api.spec.ts' },
  ],
  use: {
    baseURL: webOrigin,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'npm run e2e:api',
      url: `${apiOrigin}/health`,
      env: { PORT: new URL(apiOrigin).port, WEB_ORIGIN: webOrigin },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `node node_modules/vite/bin/vite.js apps/web --host 127.0.0.1 --port ${new URL(webOrigin).port} --strictPort`,
      url: webOrigin,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { VITE_API_URL: apiOrigin },
    },
  ],
});
