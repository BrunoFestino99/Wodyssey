import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { localSetting } from './settings.mjs';

/** DATABASE_URL when set, here or in .env, otherwise the Docker Compose PostgreSQL. */
export function databaseUrl() {
  const composePort = localSetting('POSTGRES_PORT') ?? 5432;
  return (
    localSetting('DATABASE_URL') ?? `postgres://wodyssey:wodyssey@localhost:${composePort}/wodyssey`
  );
}

function redacted(url) {
  const parsed = new URL(url);
  if (parsed.password) parsed.password = '***';
  return parsed.href;
}

/**
 * Connects once and exits with guidance when PostgreSQL is unreachable, instead of a stack
 * trace from deep inside the API.
 */
export async function exitUnlessDatabaseAvailable(url) {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    await client.query('SELECT 1');
  } catch (error) {
    console.error(
      [
        `Cannot connect to PostgreSQL at ${redacted(url)} (${error.code ?? error.message}).`,
        'Start the Docker Compose database with `npm run dev:db`,',
        'or set DATABASE_URL in .env to a PostgreSQL server you run.',
      ].join('\n'),
    );
    process.exit(1);
  } finally {
    await client.end().catch(() => {});
  }
}

async function runAdminStatement(url, statement) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

/**
 * Runs `use` with the URL of a new, empty database on the server that `serverUrl` points to,
 * and drops that database afterward, so test runs never touch development data or each other.
 */
export async function withTemporaryDatabase(serverUrl, prefix, use) {
  const name = `${prefix}_${randomBytes(6).toString('hex')}`;
  await runAdminStatement(serverUrl, `CREATE DATABASE "${name}"`);
  const temporary = new URL(serverUrl);
  temporary.pathname = `/${name}`;
  try {
    return await use(temporary.href);
  } finally {
    await runAdminStatement(serverUrl, `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  }
}
