import type { DigitalLifeDatabase } from '@digital-life/core';
import { sql } from 'drizzle-orm';

const runtimeStateStatements = [
  `create table if not exists bootstrap_state (
    persona_id text primary key,
    status text not null,
    persona jsonb not null default '{}'::jsonb,
    manual_context jsonb not null default '[]'::jsonb,
    recommended_connectors jsonb not null default '[]'::jsonb,
    baseline_run_id uuid,
    updated_at timestamptz not null default now()
  )`,
  `create table if not exists connector_scopes (
    connector_id text primary key,
    selected_scope jsonb not null default '[]'::jsonb,
    updated_at timestamptz not null default now()
  )`,
  `create table if not exists tool_policies (
    tool_id text not null,
    phase text not null,
    enabled boolean not null,
    reason text,
    updated_at timestamptz not null default now(),
    primary key (tool_id, phase)
  )`,
  `create table if not exists startup_logs (
    id uuid primary key,
    connector_id text,
    level text not null,
    message text not null,
    created_at timestamptz not null default now()
  )`,
  `create table if not exists learning_runs (
    id uuid primary key,
    mode text not null,
    status text not null,
    connector_ids jsonb not null default '[]'::jsonb,
    details jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`,
  `create table if not exists learning_run_events (
    id uuid primary key,
    run_id uuid not null,
    event_type text not null,
    payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
  )`,
  `create table if not exists cursor_windows (
    run_id uuid not null,
    connector_id text not null,
    cursor_key text not null,
    cursor_value text,
    window_start timestamptz,
    window_end timestamptz,
    metadata jsonb not null default '{}'::jsonb,
    primary key (run_id, connector_id, cursor_key)
  )`,
  `create table if not exists readiness_state (
    persona_id text primary key,
    status text not null,
    score integer not null,
    blockers jsonb not null default '[]'::jsonb,
    warnings jsonb not null default '[]'::jsonb,
    updated_at timestamptz not null default now()
  )`,
  `create index if not exists learning_run_events_run_id_idx
    on learning_run_events (run_id, created_at)`,
];

export const ensureRuntimeStateTables = async (database: DigitalLifeDatabase): Promise<void> => {
  for (const statement of runtimeStateStatements) {
    await database.execute(sql.raw(statement));
  }
};
