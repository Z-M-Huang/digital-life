import {
  type DigitalLifeDatabase,
  gapsTable,
  toolNeedsTable,
  toolProposalsTable,
} from '@digital-life/core';
import { desc, eq, sql } from 'drizzle-orm';

import type {
  GapRecord,
  GapStatus,
  ToolLearningRepository,
  ToolNeedRecord,
  ToolProposalRecord,
  ToolProposalStatus,
} from './tool-learning-repository';

type ToolLearningRow = typeof toolProposalsTable.$inferSelect;
type GapRow = typeof gapsTable.$inferSelect;
type NeedRow = typeof toolNeedsTable.$inferSelect;

const gapFromRow = (row: GapRow): GapRecord => ({
  id: row.id,
  type: row.type as GapRecord['type'],
  status: row.status as GapRecord['status'],
  severity: row.severity,
  title: row.title,
  description: row.description,
  evidenceRefs: row.evidenceRefs ?? [],
  relatedConnector: row.relatedConnector ?? null,
  relatedScope: row.relatedScope ?? null,
  resolutionHint: row.resolutionHint ?? null,
  metadata: row.metadata ?? {},
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const proposalFromRow = (row: ToolLearningRow): ToolProposalRecord => ({
  id: row.id,
  type: row.type as ToolProposalRecord['type'],
  status: row.status as ToolProposalStatus,
  title: row.title,
  problem: row.problem,
  expectedValue: row.expectedValue,
  risk: row.risk as ToolProposalRecord['risk'],
  approvalRequired: row.approvalRequired,
  evidenceRefs: row.evidenceRefs ?? [],
  implementationPlan: row.implementationPlan ?? [],
  metadata: row.metadata ?? {},
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const needFromRow = (row: NeedRow): ToolNeedRecord => ({
  id: row.id,
  signal: row.signal,
  detail: row.detail,
  occurrences: row.occurrences,
  lastSeenAt: row.lastSeenAt,
  metadata: row.metadata ?? {},
});

export const createPostgresToolLearningRepository = ({
  database,
}: {
  database: DigitalLifeDatabase;
}): ToolLearningRepository => ({
  async listGaps() {
    const rows = await database
      .select()
      .from(gapsTable)
      .orderBy(desc(gapsTable.severity), gapsTable.title);
    return rows.map(gapFromRow);
  },
  async upsertGap(input) {
    const id = input.id ?? crypto.randomUUID();
    const inserted = await database
      .insert(gapsTable)
      .values({
        id,
        type: input.type,
        status: input.status,
        severity: input.severity,
        title: input.title,
        description: input.description,
        evidenceRefs: input.evidenceRefs,
        relatedConnector: input.relatedConnector ?? null,
        relatedScope: input.relatedScope ?? null,
        resolutionHint: input.resolutionHint ?? null,
        metadata: input.metadata,
      })
      .onConflictDoUpdate({
        target: gapsTable.id,
        set: {
          type: input.type,
          status: input.status,
          severity: input.severity,
          title: input.title,
          description: input.description,
          evidenceRefs: input.evidenceRefs,
          relatedConnector: input.relatedConnector ?? null,
          relatedScope: input.relatedScope ?? null,
          resolutionHint: input.resolutionHint ?? null,
          metadata: input.metadata,
          updatedAt: sql`now()`,
        },
      })
      .returning();
    const row = inserted[0];
    if (!row) {
      throw new Error('upsertGap returned no row');
    }
    return gapFromRow(row);
  },
  async updateGapStatus(id: string, status: GapStatus) {
    const updated = await database
      .update(gapsTable)
      .set({ status, updatedAt: sql`now()` })
      .where(eq(gapsTable.id, id))
      .returning();
    return updated[0] ? gapFromRow(updated[0]) : null;
  },
  async listToolNeeds() {
    const rows = await database
      .select()
      .from(toolNeedsTable)
      .orderBy(desc(toolNeedsTable.lastSeenAt));
    return rows.map(needFromRow);
  },
  async recordToolNeed(input) {
    const id = input.id ?? crypto.randomUUID();
    const inserted = await database
      .insert(toolNeedsTable)
      .values({
        id,
        signal: input.signal,
        detail: input.detail,
        occurrences: input.occurrences,
        metadata: input.metadata,
      })
      .onConflictDoUpdate({
        target: toolNeedsTable.id,
        set: {
          signal: input.signal,
          detail: input.detail,
          occurrences: sql`${toolNeedsTable.occurrences} + ${input.occurrences}`,
          metadata: input.metadata,
          lastSeenAt: sql`now()`,
        },
      })
      .returning();
    const row = inserted[0];
    if (!row) {
      throw new Error('recordToolNeed returned no row');
    }
    return needFromRow(row);
  },
  async listProposals() {
    const rows = await database
      .select()
      .from(toolProposalsTable)
      .orderBy(desc(toolProposalsTable.createdAt));
    return rows.map(proposalFromRow);
  },
  async createProposal(input) {
    const inserted = await database
      .insert(toolProposalsTable)
      .values({
        id: crypto.randomUUID(),
        type: input.type,
        status: input.status,
        title: input.title,
        problem: input.problem,
        expectedValue: input.expectedValue,
        risk: input.risk,
        approvalRequired: input.approvalRequired,
        evidenceRefs: input.evidenceRefs,
        implementationPlan: input.implementationPlan,
        metadata: input.metadata,
      })
      .returning();
    const row = inserted[0];
    if (!row) {
      throw new Error('createProposal returned no row');
    }
    return proposalFromRow(row);
  },
  async updateProposalStatus(id: string, status: ToolProposalStatus) {
    const updated = await database
      .update(toolProposalsTable)
      .set({ status, updatedAt: sql`now()` })
      .where(eq(toolProposalsTable.id, id))
      .returning();
    return updated[0] ? proposalFromRow(updated[0]) : null;
  },
});
