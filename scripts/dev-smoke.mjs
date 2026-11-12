import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';

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

const apiPort = await unusedPort();
const webPort = await unusedPort();
const databasePort = await unusedPort();
const databaseDir = await mkdtemp(path.join(tmpdir(), 'wodyssey-dev-smoke-'));
const child = spawn(process.execPath, [process.env.npm_execpath, 'run', 'dev'], {
  env: {
    ...process.env,
    PORT: String(apiPort),
    WEB_PORT: String(webPort),
    LOCAL_POSTGRES_PORT: String(databasePort),
    LOCAL_POSTGRES_DIR: databaseDir,
  },
  stdio: 'inherit',
  windowsHide: true,
});
let browser;

async function waitFor(url) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null)
      throw new Error(`Development server exited with ${child.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      await delay(1000);
      continue;
    }
    await delay(1000);
  }
  throw new Error(`Development server did not become ready at ${url}`);
}

try {
  const baseUrl = `http://localhost:${webPort}`;
  await waitFor(baseUrl);
  browser = await chromium.launch();
  const page = await browser.newPage();
  for (const host of ['localhost', '127.0.0.1']) {
    await page.goto(`http://${host}:${webPort}/login`);
    await page.getByRole('heading', { name: 'Welcome back' }).waitFor();
    await page.getByLabel('Email address').fill('smoke@example.test');
    const email = await page.getByLabel('Email address').inputValue();
    if (email !== 'smoke@example.test') throw new Error(`Login form failed at ${host}`);
  }
  console.log('Development startup smoke check passed for localhost and 127.0.0.1.');
} finally {
  await browser?.close();
  if (child.exitCode === null) {
    if (process.platform === 'win32') {
      await new Promise((resolve) => {
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        });
        killer.once('exit', resolve);
        killer.once('error', resolve);
      });
    } else {
      child.kill('SIGTERM');
    }
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(10000)]);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  await rm(databaseDir, { recursive: true, force: true });
}
