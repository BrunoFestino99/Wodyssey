import { pool } from './database';
import { applyMigrations } from './migrations';

// Manual entry point; the API also applies pending migrations when it starts.
void applyMigrations()
  .catch((error: unknown) => {
    console.error('Database migration failed', error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
