import { Pool, type QueryResult, type QueryResultRow } from 'pg';

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
