import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { databaseUrl, exitUnlessDatabaseAvailable } from './database.mjs';
import { startProcessTree, stopProcessTree } from './processes.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
if (existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));
if (process.env.NODE_ENV === 'production')
  throw new Error('The local development runner is not a production server.');

const children = [];
const env = {
  ...process.env,
  HOST: '127.0.0.1',
  PORT: process.env.PORT ?? '3000',
  DATABASE_URL: databaseUrl(),
};
const webPort = process.env.WEB_PORT ?? '5173';
env.WEB_ORIGIN = `http://localhost:${webPort}`;
env.VITE_API_URL = `http://localhost:${env.PORT}`;
if (!env.SMTP_URL) {
  env.EMAIL_TRANSPORT = 'memory';
  env.TEST_MAILBOX_ENABLED = 'true';
}

function start(command, args) {
  const child = startProcessTree(command, args, { cwd: root, env });
  children.push(child);
  return child;
}

await exitUnlessDatabaseAvailable(env.DATABASE_URL);

try {
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
  await Promise.allSettled(children.map(stopProcessTree));
}
