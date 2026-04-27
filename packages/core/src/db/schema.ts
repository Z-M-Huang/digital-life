import {
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const bootstrapStateTable = pgTable('bootstrap_state', {
  personaId: text('persona_id').primaryKey(),
  status: text('status').notNull(),
  persona: jsonb('persona').$type<Record<string, unknown>>().notNull().default({}),
  manualContext: jsonb('manual_context').$type<Record<string, unknown>[]>().notNull().default([]),
  recommendedConnectors: jsonb('recommended_connectors').$type<string[]>().notNull().default([]),
  baselineRunId: uuid('baseline_run_id'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const connectorScopesTable = pgTable('connector_scopes', {
  connectorId: text('connector_id').primaryKey(),
  selectedScope: jsonb('selected_scope').$type<Record<string, unknown>[]>().notNull().default([]),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const toolPoliciesTable = pgTable(
  'tool_policies',
  {
    toolId: text('tool_id').notNull(),
    phase: text('phase').notNull(),
    enabled: boolean('enabled').notNull(),
    reason: text('reason'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.toolId, table.phase] }),
  }),
);

export const startupLogsTable = pgTable('startup_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  connectorId: text('connector_id'),
  level: text('level').notNull(),
  message: text('message').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const learningRunsTable = pgTable('learning_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  mode: text('mode').notNull(),
  status: text('status').notNull(),
  connectorIds: jsonb('connector_ids').$type<string[]>().notNull().default([]),
  details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const learningRunEventsTable = pgTable('learning_run_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  runId: uuid('run_id').notNull(),
  eventType: text('event_type').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const cursorWindowsTable = pgTable(
  'cursor_windows',
  {
    runId: uuid('run_id').notNull(),
    connectorId: text('connector_id').notNull(),
    cursorKey: text('cursor_key').notNull(),
    cursorValue: text('cursor_value'),
    windowStart: timestamp('window_start', { withTimezone: true }),
    windowEnd: timestamp('window_end', { withTimezone: true }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.runId, table.connectorId, table.cursorKey] }),
  }),
);

export const readinessStateTable = pgTable('readiness_state', {
  personaId: text('persona_id').primaryKey(),
  status: text('status').notNull(),
  score: integer('score').notNull(),
  blockers: jsonb('blockers').$type<string[]>().notNull().default([]),
  warnings: jsonb('warnings').$type<string[]>().notNull().default([]),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const knowledgeFactsTable = pgTable('knowledge_facts', {
  id: text('id').primaryKey(),
  runId: uuid('run_id'),
  kind: text('kind').notNull(),
  content: text('content').notNull(),
  sourceCount: integer('source_count').notNull(),
  connectorIds: jsonb('connector_ids').$type<string[]>().notNull().default([]),
  sourceIds: jsonb('source_ids').$type<string[]>().notNull().default([]),
  provenance: jsonb('provenance').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const conversationThreadsTable = pgTable('conversation_threads', {
  id: uuid('id').defaultRandom().primaryKey(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const conversationMessagesTable = pgTable('conversation_messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  conversationId: uuid('conversation_id').notNull(),
  role: text('role').notNull(),
  content: text('content').notNull(),
  evidenceFactIds: jsonb('evidence_fact_ids').$type<string[]>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const reflectionItemsTable = pgTable('reflection_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  category: text('category').notNull(),
  severity: text('severity').notNull(),
  status: text('status').notNull(),
  title: text('title').notNull(),
  detail: text('detail').notNull(),
  connectorId: text('connector_id'),
  runId: uuid('run_id'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const gapsTable = pgTable('gaps', {
  id: uuid('id').defaultRandom().primaryKey(),
  type: text('type').notNull(),
  status: text('status').notNull(),
  severity: integer('severity').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  evidenceRefs: jsonb('evidence_refs').$type<string[]>().notNull().default([]),
  relatedConnector: text('related_connector'),
  relatedScope: text('related_scope'),
  resolutionHint: text('resolution_hint'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const toolNeedsTable = pgTable('tool_needs', {
  id: uuid('id').defaultRandom().primaryKey(),
  signal: text('signal').notNull(),
  detail: text('detail').notNull(),
  occurrences: integer('occurrences').notNull().default(1),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
});

export const toolProposalsTable = pgTable('tool_proposals', {
  id: uuid('id').defaultRandom().primaryKey(),
  type: text('type').notNull(),
  status: text('status').notNull(),
  title: text('title').notNull(),
  problem: text('problem').notNull(),
  expectedValue: text('expected_value').notNull(),
  risk: text('risk').notNull(),
  approvalRequired: boolean('approval_required').notNull().default(true),
  evidenceRefs: jsonb('evidence_refs').$type<string[]>().notNull().default([]),
  implementationPlan: jsonb('implementation_plan').$type<string[]>().notNull().default([]),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
