import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { databaseUrl, exitUnlessDatabaseAvailable, withTemporaryDatabase } from './database.mjs';
import { unusedPort } from './ports.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const apiPort = await unusedPort();
const webPort = await unusedPort();
const serverUrl = databaseUrl();
await exitUnlessDatabaseAvailable(serverUrl);

// Ctrl+C also reaches Playwright, which stops on its own; staying alive lets the
// temporary database be dropped afterward.
process.on('SIGINT', () => {});

function playwright(url, args, extraEnvironment = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(root, 'node_modules/@playwright/test/cli.js'), 'test', ...args],
      {
        cwd: root,
        stdio: 'inherit',
        windowsHide: true,
        env: {
          ...process.env,
          DATABASE_URL: url,
          E2E_API_ORIGIN: `http://127.0.0.1:${apiPort}`,
          E2E_WEB_ORIGIN: `http://127.0.0.1:${webPort}`,
          ...extraEnvironment,
        },
      },
    );
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
}

const shortLifetimes = {
  TEST_ACCOUNT_TOKEN_LIFETIME_MS: '3000',
  TEST_INVITATION_LIFETIME_MS: '3000',
};

await withTemporaryDatabase(serverUrl, 'wodyssey_e2e', async (url) => {
  console.log('Temporary PostgreSQL database created. Running the real application E2E tests.');
  const args = process.argv.slice(2);
  if (args[0] === '--expiry') {
    process.exitCode = await playwright(
      url,
      ['--config', 'playwright.expiry.config.ts', ...args.slice(1)],
      shortLifetimes,
    );
  } else {
    process.exitCode = await playwright(url, args);
    if (process.exitCode === 0 && args.length === 0) {
      process.exitCode = await playwright(
        url,
        ['--config', 'playwright.expiry.config.ts'],
        shortLifetimes,
      );
    }
  }
});
