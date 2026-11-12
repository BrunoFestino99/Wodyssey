import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { database } from './database';

async function migrate(): Promise<void> {
  await database.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  const migration = await readFile(join(__dirname, 'migrations', '001-account-access.sql'), 'utf8');
  await database.query(migration);
  await database.end();
}

void migrate().catch((error: unknown) => {
  console.error('Database migration failed', error);
  process.exitCode = 1;
});
