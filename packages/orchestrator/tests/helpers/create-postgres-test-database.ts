import { type DigitalLifeDatabase, schema } from '@digital-life/core';
import { drizzle } from 'drizzle-orm/node-postgres';
import { newDb } from 'pg-mem';

import { ensureKnowledgeTables } from '../../src/repositories/knowledge-state-schema';
import { ensureReflectionTables } from '../../src/repositories/reflection-state-schema';
import { ensureRuntimeStateTables } from '../../src/repositories/runtime-state-schema';

export const createPostgresTestDatabase = async (): Promise<{
  database: DigitalLifeDatabase;
  dispose: () => Promise<void>;
}> => {
  const memory = newDb({ noAstCoverageCheck: true });
  const adapter = memory.adapters.createPg();
  const patchAdapter = (Constructor: {
    prototype: { adaptQuery?: unknown; adaptResults?: unknown };
  }) => {
    const originalAdaptQuery = Constructor.prototype.adaptQuery;
    if (typeof originalAdaptQuery !== 'function') {
      return;
    }
    const originalAdaptResults =
      'adaptResults' in Constructor.prototype ? Constructor.prototype.adaptResults : undefined;

    Constructor.prototype.adaptQuery = function adaptQuery(query: unknown, values: unknown) {
      if (typeof query === 'object' && query && 'types' in query) {
        query = { ...query, types: undefined };
      }

      return originalAdaptQuery.call(this, query, values);
    };
    if (typeof originalAdaptResults === 'function') {
      Constructor.prototype.adaptResults = function adaptResults(
        query: { rowMode?: string },
        result: {
          fields: Array<{ name: string }>;
          rows: Array<Record<string, unknown>>;
        },
      ) {
        if (query.rowMode === 'array') {
          return {
            ...result,
            rows: result.rows.map((row) => result.fields.map((field) => row[field.name])),
          };
        }

        return originalAdaptResults.call(this, query, result);
      };
    }
  };
  patchAdapter(adapter.Pool);
  patchAdapter(adapter.Client);
  const pool = new adapter.Pool();
  const database = drizzle(pool as never, { schema }) as DigitalLifeDatabase;

  await ensureRuntimeStateTables(database);
  await ensureKnowledgeTables(database);
  await ensureReflectionTables(database);

  return {
    database,
    async dispose() {
      await pool.end();
    },
  };
};
