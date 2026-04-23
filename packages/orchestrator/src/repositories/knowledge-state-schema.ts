import type { DigitalLifeDatabase } from '@digital-life/core';
import { sql } from 'drizzle-orm';

const knowledgeStateStatements = [
  `create table if not exists knowledge_facts (
    id text primary key,
    run_id uuid,
    kind text not null,
    content text not null,
    source_count integer not null,
    connector_ids jsonb not null default '[]'::jsonb,
    source_ids jsonb not null default '[]'::jsonb,
    provenance jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`,
  `create table if not exists conversation_threads (
    id uuid primary key,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`,
  `create table if not exists conversation_messages (
    id uuid primary key,
    conversation_id uuid not null,
    role text not null,
    content text not null,
    evidence_fact_ids jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default now()
  )`,
  `create index if not exists knowledge_facts_updated_at_idx
    on knowledge_facts (updated_at desc)`,
  `create index if not exists conversation_messages_conversation_id_idx
    on conversation_messages (conversation_id, created_at)`,
];

export const ensureKnowledgeTables = async (database: DigitalLifeDatabase): Promise<void> => {
  for (const statement of knowledgeStateStatements) {
    await database.execute(sql.raw(statement));
  }
};
