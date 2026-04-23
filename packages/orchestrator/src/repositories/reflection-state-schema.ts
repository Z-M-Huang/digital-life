import type { DigitalLifeDatabase } from '@digital-life/core';
import { sql } from 'drizzle-orm';

const reflectionStateStatements = [
  `create table if not exists reflection_items (
    id uuid primary key,
    category text not null,
    severity text not null,
    status text not null,
    title text not null,
    detail text not null,
    connector_id text,
    run_id uuid,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`,
  `create index if not exists reflection_items_created_at_idx
    on reflection_items (created_at, severity)`,
];

export const ensureReflectionTables = async (database: DigitalLifeDatabase): Promise<void> => {
  for (const statement of reflectionStateStatements) {
    await database.execute(sql.raw(statement));
  }
};
