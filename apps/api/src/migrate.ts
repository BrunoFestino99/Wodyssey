import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { database } from './database';

async function migrate(): Promise<void> {
  try {
    const migration = await readFile(
      join(__dirname, 'migrations', '001-account-access.sql'),
      'utf8',
    );
    await database.query(migration);
  } finally {
    await database.end();
  }
}

void migrate().catch((error: unknown) => {
  console.error('Database migration failed', error);
  process.exitCode = 1;
});
