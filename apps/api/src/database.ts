import { sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ?? 'postgres://wodyssey:wodyssey@localhost:5432/wodyssey',
});

export const db = drizzle({ client: pool, schema });

export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The database clock, so time comparisons do not depend on the API server's clock. */
export const now = (): SQL<Date> => sql`now()`;

export const lower = (column: AnyColumn): SQL<string> => sql`lower(${column})`;
