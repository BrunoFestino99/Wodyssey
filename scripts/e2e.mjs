import { mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { tmpdir } from 'node:os';
import EmbeddedPostgres from 'embedded-postgres';

const root = fileURLToPath(new URL('../', import.meta.url));
const databaseDir = await mkdtemp(path.join(tmpdir(), 'wodyssey-e2e-'));

async function unusedPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

const databasePort = await unusedPort();
const apiPort = await unusedPort();
const webPort = await unusedPort();
const postgres = new EmbeddedPostgres({
  databaseDir,
  port: databasePort,
  user: 'wodyssey',
  password: 'local-e2e-only',
  persistent: false,
  autoRehydrateSymlinks: true,
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  postgresFlags: ['-h', '127.0.0.1'],
  onLog: () => {},
  onError: (message) => {
    if (String(message).includes('FATAL')) console.error(message);
  },
});

function playwright(args, extraEnvironment = {}) {
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
          DATABASE_URL: `postgres://wodyssey:local-e2e-only@127.0.0.1:${databasePort}/wodyssey_e2e`,
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

try {
  await postgres.initialise();
  await postgres.start();
  await postgres.createDatabase('wodyssey_e2e');
  console.log('Isolated PostgreSQL started. Running the real application E2E tests.');
  const args = process.argv.slice(2);
  if (args[0] === '--expiry') {
    process.exitCode = await playwright(
      ['--config', 'playwright.expiry.config.ts', ...args.slice(1)],
      { TEST_ACCOUNT_TOKEN_LIFETIME_MS: '3000', TEST_INVITATION_LIFETIME_MS: '3000' },
    );
  } else {
    process.exitCode = await playwright(args);
    if (process.exitCode === 0 && args.length === 0) {
      process.exitCode = await playwright(['--config', 'playwright.expiry.config.ts'], {
        TEST_ACCOUNT_TOKEN_LIFETIME_MS: '3000',
        TEST_INVITATION_LIFETIME_MS: '3000',
      });
    }
  }
} finally {
  await postgres.stop();
}
