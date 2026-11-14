import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

const file = new URL('../.env', import.meta.url);
const fromFile = existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {};

/**
 * A local setting from the environment, or else from .env, which docker-compose.yml and
 * npm run dev also read, so every script agrees on databases and ports.
 */
export function localSetting(name) {
  return process.env[name] ?? fromFile[name];
}
