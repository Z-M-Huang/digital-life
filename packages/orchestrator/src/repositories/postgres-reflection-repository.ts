import { type DigitalLifeDatabase, schema } from '@digital-life/core';
import { asc } from 'drizzle-orm';

import type { ReflectionItemRecord, ReflectionRepository } from './reflection-repository';

const mapItem = (row: typeof schema.reflectionItemsTable.$inferSelect): ReflectionItemRecord => ({
  category: row.category as ReflectionItemRecord['category'],
  connectorId: row.connectorId,
  createdAt: row.createdAt,
  detail: row.detail,
  id: row.id,
  metadata: row.metadata,
  runId: row.runId,
  severity: row.severity as ReflectionItemRecord['severity'],
  status: row.status as ReflectionItemRecord['status'],
  title: row.title,
  updatedAt: row.updatedAt,
});

export const createPostgresReflectionRepository = ({
  database,
}: {
  database: DigitalLifeDatabase;
}): ReflectionRepository => ({
  async listReflectionItems() {
    const rows = await database
      .select()
      .from(schema.reflectionItemsTable)
      .orderBy(asc(schema.reflectionItemsTable.createdAt), asc(schema.reflectionItemsTable.id));

    return rows.map(mapItem);
  },
  async replaceReflectionItems(items) {
    await database.transaction(async (transaction) => {
      await transaction.delete(schema.reflectionItemsTable);
      if (items.length === 0) {
        return;
      }

      const createdAt = new Date();
      await transaction.insert(schema.reflectionItemsTable).values(
        items.map((item, index) => ({
          id: crypto.randomUUID(),
          category: item.category,
          connectorId: item.connectorId,
          createdAt: new Date(createdAt.valueOf() + index),
          detail: item.detail,
          metadata: item.metadata,
          runId: item.runId,
          severity: item.severity,
          status: item.status,
          title: item.title,
          updatedAt: new Date(createdAt.valueOf() + index),
        })),
      );
    });

    const rows = await database
      .select()
      .from(schema.reflectionItemsTable)
      .orderBy(asc(schema.reflectionItemsTable.createdAt), asc(schema.reflectionItemsTable.id));

    return rows.map(mapItem);
  },
});
