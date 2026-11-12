import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

const root = fileURLToPath(new URL('../', import.meta.url));
if (existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));
if (process.env.NODE_ENV === 'production')
  throw new Error('The local development runner is not a production server.');

let postgres;
const children = [];
const env = { ...process.env, HOST: '127.0.0.1', PORT: process.env.PORT ?? '3000' };
const webPort = process.env.WEB_PORT ?? '5173';
env.WEB_ORIGIN = `http://localhost:${webPort}`;
env.VITE_API_URL = `http://localhost:${env.PORT}`;
if (!env.SMTP_URL) {
  env.EMAIL_TRANSPORT = 'memory';
  env.TEST_MAILBOX_ENABLED = 'true';
}

function start(command, args) {
  const child = spawn(command, args, {
    cwd: root,
    env,
    stdio: 'inherit',
    windowsHide: true,
    detached: process.platform !== 'win32',
  });
  children.push(child);
  return child;
}

async function stop(child) {
  if (!child.pid || child.exitCode !== null) return;
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
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
}

try {
  if (!env.DATABASE_URL) {
    const databaseDir = path.join(root, '.local', 'development-postgres');
    await mkdir(databaseDir, { recursive: true });
    const port = Number(process.env.LOCAL_POSTGRES_PORT ?? 55432);
    postgres = new EmbeddedPostgres({
      databaseDir,
      port,
      user: 'wodyssey',
      password: 'local-development-only',
      persistent: true,
      autoRehydrateSymlinks: true,
      initdbFlags: ['--encoding=UTF8', '--locale=C'],
      postgresFlags: ['-h', '127.0.0.1'],
      onLog: () => {},
      onError: (message) => {
        if (String(message).includes('FATAL')) console.error(message);
      },
    });
    if (!existsSync(path.join(databaseDir, 'PG_VERSION'))) await postgres.initialise();
    await postgres.start();
    const client = postgres.getPgClient();
    await client.connect();
    const database = await client.query("SELECT 1 FROM pg_database WHERE datname = 'wodyssey'");
    await client.end();
    if (database.rowCount === 0) await postgres.createDatabase('wodyssey');
    env.DATABASE_URL = `postgres://wodyssey:local-development-only@127.0.0.1:${port}/wodyssey`;
  }
  const api = start(process.execPath, [process.env.npm_execpath, 'run', 'dev:api']);
  const web = start(process.execPath, [
    path.join(root, 'node_modules/vite/bin/vite.js'),
    'apps/web',
    '--host',
    '127.0.0.1',
    '--port',
    webPort,
    '--strictPort',
  ]);
  console.log(`Web: ${env.WEB_ORIGIN}`);
  if (env.EMAIL_TRANSPORT === 'memory')
    console.log(`Local email inbox: ${env.VITE_API_URL}/auth/test/mailbox`);
  await new Promise((resolve, reject) => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
    for (const child of [api, web]) {
      child.once('error', reject);
      child.once('exit', (code) => {
        process.exitCode = code ?? 1;
        resolve();
      });
    }
  });
} finally {
  await Promise.allSettled(children.map(stop));
  if (postgres) await postgres.stop();
}
