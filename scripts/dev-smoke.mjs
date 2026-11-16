import { chromium } from '@playwright/test';
import { databaseUrl, exitUnlessDatabaseAvailable, withTemporaryDatabase } from './database.mjs';
import { unusedPort } from './ports.mjs';
import { answers, run, startProcessTree, stopProcessTree, waitUntil } from './processes.mjs';
import { localSetting } from './settings.mjs';

// Checks that a development environment serves a working sign-in form on both loopback
// host names. Without arguments it starts `npm run dev` against a temporary database;
// with --compose it builds and starts the Docker Compose environment and stops it after.

async function checkSignIn(webPort) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (const host of ['localhost', '127.0.0.1']) {
      await page.goto(`http://${host}:${webPort}/login`);
      await page.getByRole('heading', { name: 'Welcome back' }).waitFor();
      await page.getByLabel('Email address').fill('smoke@example.test');
      const email = await page.getByLabel('Email address').inputValue();
      if (email !== 'smoke@example.test') throw new Error(`Login form failed at ${host}`);
    }
  } finally {
    await browser.close();
  }
}

async function smokeNpmRunDev() {
  const serverUrl = databaseUrl();
  await exitUnlessDatabaseAvailable(serverUrl);
  await withTemporaryDatabase(serverUrl, 'wodyssey_dev_smoke', async (url) => {
    const apiPort = await unusedPort();
    const webPort = await unusedPort();
    const child = startProcessTree(process.execPath, [process.env.npm_execpath, 'run', 'dev'], {
      env: {
        ...process.env,
        DATABASE_URL: url,
        PORT: String(apiPort),
        WEB_PORT: String(webPort),
      },
    });
    const serving = (target) => () => {
      if (child.exitCode !== null)
        throw new Error(`Development server exited with ${child.exitCode}`);
      return answers(target);
    };
    try {
      await waitUntil('the API', serving(`http://localhost:${apiPort}/health`));
      await waitUntil('the web app', serving(`http://localhost:${webPort}`));
      await checkSignIn(webPort);
    } finally {
      await stopProcessTree(child);
    }
  });
  console.log('npm run dev smoke check passed for localhost and 127.0.0.1.');
}

async function smokeCompose() {
  const apiPort = localSetting('PORT') ?? '3000';
  const webPort = localSetting('WEB_PORT') ?? '5173';
  try {
    // --wait returns once every service reports healthy.
    await run('docker', ['compose', 'up', '--detach', '--build', '--wait']);
    if (!(await answers(`http://localhost:${apiPort}/health`)))
      throw new Error('The API did not answer its health check');
    await checkSignIn(webPort);
  } catch (error) {
    await run('docker', ['compose', 'logs', 'api', 'web']).catch(() => {});
    throw error;
  } finally {
    await run('docker', ['compose', 'down']);
  }
  console.log('Docker Compose smoke check passed for localhost and 127.0.0.1.');
}

if (process.argv.includes('--compose')) await smokeCompose();
else await smokeNpmRunDev();
