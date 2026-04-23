import {
  type DigitalLifeDatabase,
  type GovernedPhase,
  type RuntimeToolPolicyRecord,
  schema,
} from '@digital-life/core';
import { asc, desc, eq } from 'drizzle-orm';

import type {
  BootstrapState,
  CursorWindowRecord,
  LearningRunEvent,
  LearningRunRecord,
  ReadinessState,
  RuntimeStateRepository,
  StartupLogRecord,
  StoredScopeSelection,
} from './runtime-state-repository';

const createInitialBootstrapState = (): BootstrapState => ({
  status: 'not_started',
  persona: {},
  manualContext: [],
  recommendedConnectors: [],
  baselineRunId: null,
  updatedAt: new Date(),
});

const createInitialReadinessState = (): ReadinessState => ({
  status: 'partial',
  score: 0,
  blockers: [],
  warnings: [],
  updatedAt: new Date(),
});

const mapBootstrapState = (
  row: typeof schema.bootstrapStateTable.$inferSelect | undefined,
): BootstrapState =>
  row
    ? {
        status: row.status as BootstrapState['status'],
        persona: row.persona,
        manualContext: row.manualContext,
        recommendedConnectors: row.recommendedConnectors,
        baselineRunId: row.baselineRunId,
        updatedAt: row.updatedAt,
      }
    : createInitialBootstrapState();

const mapCursorWindow = (
  row: typeof schema.cursorWindowsTable.$inferSelect,
): CursorWindowRecord => ({
  runId: row.runId,
  connectorId: row.connectorId,
  cursorKey: row.cursorKey,
  cursorValue: row.cursorValue,
  windowStart: row.windowStart,
  windowEnd: row.windowEnd,
  metadata: row.metadata,
});

const mapLearningRun = (row: typeof schema.learningRunsTable.$inferSelect): LearningRunRecord => ({
  id: row.id,
  mode: row.mode as LearningRunRecord['mode'],
  status: row.status as LearningRunRecord['status'],
  connectorIds: row.connectorIds,
  details: row.details,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const mapLearningRunEvent = (
  row: typeof schema.learningRunEventsTable.$inferSelect,
): LearningRunEvent => ({
  runId: row.runId,
  type: row.eventType as LearningRunEvent['type'],
  payload: row.payload,
  createdAt: row.createdAt,
});

const mapReadinessState = (
  row: typeof schema.readinessStateTable.$inferSelect | undefined,
): ReadinessState =>
  row
    ? {
        status: row.status as ReadinessState['status'],
        score: row.score,
        blockers: row.blockers,
        warnings: row.warnings,
        updatedAt: row.updatedAt,
      }
    : createInitialReadinessState();

const mapStartupLog = (row: typeof schema.startupLogsTable.$inferSelect): StartupLogRecord => ({
  connectorId: row.connectorId,
  createdAt: row.createdAt,
  level: row.level as StartupLogRecord['level'],
  message: row.message,
});

const mapToolPolicy = (
  row: typeof schema.toolPoliciesTable.$inferSelect,
): RuntimeToolPolicyRecord => ({
  toolId: row.toolId,
  phase: row.phase as GovernedPhase,
  enabled: row.enabled,
  reason: row.reason,
  updatedAt: row.updatedAt,
});

const loadBootstrapState = async (
  database: DigitalLifeDatabase,
  personaId: string,
): Promise<BootstrapState> => {
  const [row] = await database
    .select()
    .from(schema.bootstrapStateTable)
    .where(eq(schema.bootstrapStateTable.personaId, personaId))
    .limit(1);

  return mapBootstrapState(row);
};

const requireRow = <TRow>(row: TRow | undefined, message: string): TRow => {
  if (!row) {
    throw new Error(message);
  }

  return row;
};

export const createPostgresRuntimeStateRepository = ({
  database,
  personaId,
}: {
  database: DigitalLifeDatabase;
  personaId: string;
}): RuntimeStateRepository => ({
  async appendLearningRunEvent(event) {
    await database.insert(schema.learningRunEventsTable).values({
      id: crypto.randomUUID(),
      runId: event.runId,
      eventType: event.type,
      payload: event.payload,
      createdAt: event.createdAt,
    });
  },
  async createLearningRun(input) {
    const now = new Date();
    const [row] = await database
      .insert(schema.learningRunsTable)
      .values({
        id: crypto.randomUUID(),
        connectorIds: input.connectorIds,
        details: input.details,
        mode: input.mode,
        status: input.status,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return mapLearningRun(requireRow(row, 'Learning run insert did not return a row.'));
  },
  async getBootstrapState() {
    return loadBootstrapState(database, personaId);
  },
  async getConnectorScope(connectorId) {
    const [row] = await database
      .select()
      .from(schema.connectorScopesTable)
      .where(eq(schema.connectorScopesTable.connectorId, connectorId))
      .limit(1);

    return (row?.selectedScope as StoredScopeSelection | undefined) ?? [];
  },
  async listCursorWindows(connectorId) {
    const query = database
      .select()
      .from(schema.cursorWindowsTable)
      .orderBy(
        asc(schema.cursorWindowsTable.connectorId),
        asc(schema.cursorWindowsTable.cursorKey),
        asc(schema.cursorWindowsTable.runId),
      );
    const rows = connectorId
      ? await query.where(eq(schema.cursorWindowsTable.connectorId, connectorId))
      : await query;

    return rows.map(mapCursorWindow);
  },
  async getLearningRun(runId) {
    const [row] = await database
      .select()
      .from(schema.learningRunsTable)
      .where(eq(schema.learningRunsTable.id, runId))
      .limit(1);

    return row ? mapLearningRun(row) : null;
  },
  async getReadinessState() {
    const [row] = await database
      .select()
      .from(schema.readinessStateTable)
      .where(eq(schema.readinessStateTable.personaId, personaId))
      .limit(1);

    return mapReadinessState(row);
  },
  async listConnectorScopes() {
    const rows = await database
      .select()
      .from(schema.connectorScopesTable)
      .orderBy(asc(schema.connectorScopesTable.connectorId));

    return Object.fromEntries(
      rows.map((row) => [row.connectorId, row.selectedScope as StoredScopeSelection]),
    );
  },
  async listLearningRunEvents(runId) {
    const rows = await database
      .select()
      .from(schema.learningRunEventsTable)
      .where(eq(schema.learningRunEventsTable.runId, runId))
      .orderBy(asc(schema.learningRunEventsTable.createdAt), asc(schema.learningRunEventsTable.id));

    return rows.map(mapLearningRunEvent);
  },
  async listLearningRuns() {
    const rows = await database
      .select()
      .from(schema.learningRunsTable)
      .orderBy(desc(schema.learningRunsTable.createdAt), desc(schema.learningRunsTable.id));

    return rows.map(mapLearningRun);
  },
  async listStartupLogs() {
    const rows = await database
      .select()
      .from(schema.startupLogsTable)
      .orderBy(asc(schema.startupLogsTable.createdAt), asc(schema.startupLogsTable.id));

    return rows.map(mapStartupLog);
  },
  async listToolPolicies() {
    const rows = await database
      .select()
      .from(schema.toolPoliciesTable)
      .orderBy(asc(schema.toolPoliciesTable.toolId), asc(schema.toolPoliciesTable.phase));

    return rows.map(mapToolPolicy);
  },
  async replaceStartupLogs(logs) {
    await database.transaction(async (transaction) => {
      await transaction.delete(schema.startupLogsTable);
      if (logs.length === 0) {
        return;
      }

      await transaction.insert(schema.startupLogsTable).values(
        logs.map((log) => ({
          id: crypto.randomUUID(),
          connectorId: log.connectorId,
          level: log.level,
          message: log.message,
          createdAt: log.createdAt,
        })),
      );
    });
  },
  async saveBootstrapState(state) {
    const current = await loadBootstrapState(database, personaId);
    const nextState: BootstrapState = {
      ...current,
      ...state,
      updatedAt: new Date(),
    };

    await database
      .insert(schema.bootstrapStateTable)
      .values({
        personaId,
        status: nextState.status,
        persona: nextState.persona,
        manualContext: nextState.manualContext,
        recommendedConnectors: nextState.recommendedConnectors,
        baselineRunId: nextState.baselineRunId,
        updatedAt: nextState.updatedAt,
      })
      .onConflictDoUpdate({
        target: schema.bootstrapStateTable.personaId,
        set: {
          status: nextState.status,
          persona: nextState.persona,
          manualContext: nextState.manualContext,
          recommendedConnectors: nextState.recommendedConnectors,
          baselineRunId: nextState.baselineRunId,
          updatedAt: nextState.updatedAt,
        },
      });

    return nextState;
  },
  async saveConnectorScope(connectorId, scope) {
    const updatedAt = new Date();
    await database
      .insert(schema.connectorScopesTable)
      .values({
        connectorId,
        selectedScope: scope,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: schema.connectorScopesTable.connectorId,
        set: {
          selectedScope: scope,
          updatedAt,
        },
      });
  },
  async saveCursorWindow(record) {
    await database
      .insert(schema.cursorWindowsTable)
      .values({
        runId: record.runId,
        connectorId: record.connectorId,
        cursorKey: record.cursorKey,
        cursorValue: record.cursorValue,
        windowStart: record.windowStart,
        windowEnd: record.windowEnd,
        metadata: record.metadata,
      })
      .onConflictDoUpdate({
        target: [
          schema.cursorWindowsTable.runId,
          schema.cursorWindowsTable.connectorId,
          schema.cursorWindowsTable.cursorKey,
        ],
        set: {
          cursorValue: record.cursorValue,
          windowStart: record.windowStart,
          windowEnd: record.windowEnd,
          metadata: record.metadata,
        },
      });
  },
  async saveReadinessState(state) {
    await database
      .insert(schema.readinessStateTable)
      .values({
        personaId,
        status: state.status,
        score: state.score,
        blockers: state.blockers,
        warnings: state.warnings,
        updatedAt: state.updatedAt,
      })
      .onConflictDoUpdate({
        target: schema.readinessStateTable.personaId,
        set: {
          status: state.status,
          score: state.score,
          blockers: state.blockers,
          warnings: state.warnings,
          updatedAt: state.updatedAt,
        },
      });
  },
  async upsertToolPolicy(policy) {
    const updatedAt = new Date();
    const [row] = await database
      .insert(schema.toolPoliciesTable)
      .values({
        toolId: policy.toolId,
        phase: policy.phase,
        enabled: policy.enabled,
        reason: policy.reason ?? null,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: [schema.toolPoliciesTable.toolId, schema.toolPoliciesTable.phase],
        set: {
          enabled: policy.enabled,
          reason: policy.reason ?? null,
          updatedAt,
        },
      })
      .returning();

    return mapToolPolicy(requireRow(row, 'Tool policy upsert did not return a row.'));
  },
  async updateLearningRun(runId, patch) {
    const current = await database
      .select()
      .from(schema.learningRunsTable)
      .where(eq(schema.learningRunsTable.id, runId))
      .limit(1);
    const row = current[0];
    if (!row) {
      throw new Error(`Unknown learning run: ${runId}`);
    }

    const updatedAt = new Date();
    const [updatedRow] = await database
      .update(schema.learningRunsTable)
      .set({
        details: patch.details ?? row.details,
        status: patch.status ?? row.status,
        updatedAt,
      })
      .where(eq(schema.learningRunsTable.id, runId))
      .returning();

    return mapLearningRun(
      requireRow(updatedRow, `Learning run update did not return a row: ${runId}`),
    );
  },
});
