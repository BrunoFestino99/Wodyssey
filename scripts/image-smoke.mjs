import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { databaseUrl, exitUnlessDatabaseAvailable, withTemporaryDatabase } from './database.mjs';
import { unusedPort } from './ports.mjs';
import { answers, run, waitUntil } from './processes.mjs';

// Builds both production images and checks them as a host would run them: the API applies
// its migrations to an empty database and answers its health check, and the web server
// serves the app shell for client-side routes.

const root = fileURLToPath(new URL('../', import.meta.url));
const apiImage = 'wodyssey-api:smoke';
const webImage = 'wodyssey-web:smoke';

function docker(args, options = {}) {
  return run('docker', args, { cwd: root, ...options });
}

function waitForHealthy(container) {
  return waitUntil(`${container} to become healthy`, async () => {
    const state = await docker(
      ['inspect', '--format', '{{.State.Status}} {{.State.Health.Status}}', container],
      { capture: true },
    );
    if (!state.startsWith('running')) throw new Error(`${container} stopped: ${state}`);
    return state === 'running healthy';
  });
}

async function expectResponse(url, status, check = () => true) {
  const response = await fetch(url);
  const body = await response.text();
  if (response.status !== status || !check(body))
    throw new Error(`Unexpected response from ${url}: ${response.status}\n${body.slice(0, 500)}`);
}

async function smokeApi(serverUrl) {
  await withTemporaryDatabase(serverUrl, 'wodyssey_image_smoke', async (url) => {
    // The container reaches PostgreSQL published on the host through the host gateway.
    const containerUrl = new URL(url);
    if (['localhost', '127.0.0.1'].includes(containerUrl.hostname))
      containerUrl.hostname = 'host.docker.internal';
    const port = await unusedPort();
    const container = `wodyssey-api-smoke-${port}`;
    await docker([
      'run',
      '--detach',
      '--name',
      container,
      '--add-host=host.docker.internal:host-gateway',
      '--publish',
      `127.0.0.1:${port}:3000`,
      '--env',
      `DATABASE_URL=${containerUrl.href}`,
      '--env',
      'WEB_ORIGIN=https://wodyssey.example',
      '--env',
      'SMTP_URL=smtp://smtp.example:587',
      '--env',
      'EMAIL_FROM=Wodyssey <accounts@wodyssey.example>',
      apiImage,
    ]);
    try {
      await waitForHealthy(container);
      await expectResponse(`http://127.0.0.1:${port}/health`, 200);
      const journal = JSON.parse(
        await readFile(new URL('../apps/api/src/migrations/meta/_journal.json', import.meta.url)),
      );
      const client = new pg.Client({ connectionString: url });
      await client.connect();
      try {
        const { rows } = await client.query(
          'SELECT count(*)::int AS applied FROM drizzle.__drizzle_migrations',
        );
        if (rows[0].applied !== journal.entries.length)
          throw new Error(
            `Expected ${journal.entries.length} applied migrations, found ${rows[0].applied}`,
          );
      } finally {
        await client.end();
      }
    } catch (error) {
      await docker(['logs', container]).catch(() => {});
      throw error;
    } finally {
      await docker(['rm', '--force', container], { capture: true });
    }
  });
  console.log('API image applied its migrations and answered its health check.');
}

async function smokeWeb() {
  const port = await unusedPort();
  const container = `wodyssey-web-smoke-${port}`;
  await docker([
    'run',
    '--detach',
    '--name',
    container,
    '--publish',
    `127.0.0.1:${port}:8080`,
    webImage,
  ]);
  try {
    const origin = `http://127.0.0.1:${port}`;
    await waitUntil('the web server', () => answers(origin), 30);
    const appShell = (body) => body.includes('<div id="root">');
    await expectResponse(`${origin}/`, 200, appShell);
    await expectResponse(`${origin}/login`, 200, appShell);
    await expectResponse(`${origin}/assets/missing.js`, 404);
  } catch (error) {
    await docker(['logs', container]).catch(() => {});
    throw error;
  } finally {
    await docker(['rm', '--force', container], { capture: true });
  }
  console.log('Web image served the app shell for client-side routes.');
}

const serverUrl = databaseUrl();
await exitUnlessDatabaseAvailable(serverUrl);
await docker([
  'build',
  '--file',
  'apps/api/Dockerfile',
  '--target',
  'production',
  '--tag',
  apiImage,
  '.',
]);
await docker([
  'build',
  '--file',
  'apps/web/Dockerfile',
  '--target',
  'production',
  '--build-arg',
  'VITE_API_URL=https://api.wodyssey.example',
  '--tag',
  webImage,
  '.',
]);
await smokeApi(serverUrl);
await smokeWeb();
