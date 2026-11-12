import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { database, inTransaction } from './database';

// Arbitrary constant shared by every process that migrates this database.
const MIGRATION_LOCK = 4_172_031;

/**
 * Applies pending migrations once each, in name order. Safe to call from several
 * processes at once: an advisory lock serializes them.
 */
export async function applyMigrations(): Promise<void> {
  const directory = join(__dirname, 'migrations');
  const files = (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort();
  const client = await database.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK]);
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const applied = new Set(
      (await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map(
        (row) => row.name,
      ),
    );
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(join(directory, file), 'utf8');
      await inTransaction(client, async () => {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [file]);
      });
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]).catch(() => undefined);
    client.release();
  }
}
