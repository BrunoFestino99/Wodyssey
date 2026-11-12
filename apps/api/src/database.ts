import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

export const database = new Pool({
  connectionString:
    process.env.DATABASE_URL ?? 'postgres://wodyssey:wodyssey@localhost:5432/wodyssey',
});

export function query<Row extends QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<QueryResult<Row>> {
  return database.query<Row>(text, values);
}

/** Runs `work` in a transaction on `client`, rolling back if it throws. */
export async function inTransaction<T>(
  client: PoolClient,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  await client.query('BEGIN');
  try {
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

/** Runs `work` in a transaction on a pooled connection. */
export async function withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await database.connect();
  try {
    return await inTransaction(client, work);
  } finally {
    client.release();
  }
}
