import { type DigitalLifeDatabase, schema } from '@digital-life/core';
import { asc, desc, eq } from 'drizzle-orm';

import type { ConsolidatedFragment } from '../services/consolidation-service';
import type {
  ConversationMessageRecord,
  KnowledgeFactRecord,
  KnowledgeRepository,
} from './knowledge-repository';

const connectorIdsFromProvenance = (provenance: Record<string, unknown>): string[] => {
  const entries = Array.isArray(provenance.entries) ? provenance.entries : [];
  const connectorIds = new Set<string>();

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const metadata =
      'metadata' in entry && entry.metadata && typeof entry.metadata === 'object'
        ? entry.metadata
        : undefined;
    const connectorId =
      metadata && 'connectorId' in metadata && typeof metadata.connectorId === 'string'
        ? metadata.connectorId
        : null;
    if (connectorId) {
      connectorIds.add(connectorId);
    }
  }

  return Array.from(connectorIds);
};

const sourceIdsFromProvenance = (provenance: Record<string, unknown>): string[] => {
  const sources = Array.isArray(provenance.sources)
    ? provenance.sources.filter((value): value is string => typeof value === 'string')
    : [];

  return Array.from(new Set(sources));
};

const mapFact = (row: typeof schema.knowledgeFactsTable.$inferSelect): KnowledgeFactRecord => ({
  id: row.id,
  runId: row.runId,
  kind: row.kind,
  content: row.content,
  sourceCount: row.sourceCount,
  connectorIds: row.connectorIds,
  sourceIds: row.sourceIds,
  provenance: row.provenance,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const mapMessage = (
  row: typeof schema.conversationMessagesTable.$inferSelect,
): ConversationMessageRecord => ({
  id: row.id,
  conversationId: row.conversationId,
  role: row.role as ConversationMessageRecord['role'],
  content: row.content,
  evidenceFactIds: row.evidenceFactIds,
  createdAt: row.createdAt,
});

const loadMessages = async (
  database: DigitalLifeDatabase,
  conversationId: string,
): Promise<ConversationMessageRecord[]> => {
  const rows = await database
    .select()
    .from(schema.conversationMessagesTable)
    .where(eq(schema.conversationMessagesTable.conversationId, conversationId))
    .orderBy(
      asc(schema.conversationMessagesTable.createdAt),
      asc(schema.conversationMessagesTable.id),
    );

  return rows.map(mapMessage);
};

const mapFragment = (runId: string, fragment: ConsolidatedFragment) => {
  const now = new Date();

  return {
    id: fragment.id,
    runId,
    kind: typeof fragment.provenance.kind === 'string' ? fragment.provenance.kind : 'unknown',
    content: fragment.content,
    sourceCount: fragment.sourceCount,
    connectorIds: connectorIdsFromProvenance(fragment.provenance),
    sourceIds: sourceIdsFromProvenance(fragment.provenance),
    provenance: fragment.provenance,
    createdAt: now,
    updatedAt: now,
  };
};

export const createPostgresKnowledgeRepository = ({
  database,
}: {
  database: DigitalLifeDatabase;
}): KnowledgeRepository => ({
  async appendConversationMessages(conversationId, messages) {
    const [thread] = await database
      .select()
      .from(schema.conversationThreadsTable)
      .where(eq(schema.conversationThreadsTable.id, conversationId))
      .limit(1);
    if (!thread) {
      throw new Error(`Unknown conversation: ${conversationId}`);
    }

    const createdAt = new Date();
    await database.transaction(async (transaction) => {
      await transaction.insert(schema.conversationMessagesTable).values(
        messages.map((message, index) => ({
          id: crypto.randomUUID(),
          conversationId,
          role: message.role,
          content: message.content,
          evidenceFactIds: message.evidenceFactIds,
          createdAt: new Date(createdAt.valueOf() + index),
        })),
      );
      await transaction
        .update(schema.conversationThreadsTable)
        .set({ updatedAt: createdAt })
        .where(eq(schema.conversationThreadsTable.id, conversationId));
    });

    const updated = await database
      .select()
      .from(schema.conversationThreadsTable)
      .where(eq(schema.conversationThreadsTable.id, conversationId))
      .limit(1);
    const reloadedThread = updated[0];
    if (!reloadedThread) {
      throw new Error(`Conversation disappeared after update: ${conversationId}`);
    }

    return {
      id: reloadedThread.id,
      createdAt: reloadedThread.createdAt,
      updatedAt: reloadedThread.updatedAt,
      messages: await loadMessages(database, conversationId),
    };
  },
  async createConversation() {
    const now = new Date();
    const [thread] = await database
      .insert(schema.conversationThreadsTable)
      .values({
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!thread) {
      throw new Error('Conversation insert did not return a row.');
    }

    return {
      id: thread.id,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      messages: [],
    };
  },
  async getConversation(conversationId) {
    const [thread] = await database
      .select()
      .from(schema.conversationThreadsTable)
      .where(eq(schema.conversationThreadsTable.id, conversationId))
      .limit(1);
    if (!thread) {
      return null;
    }

    return {
      id: thread.id,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      messages: await loadMessages(database, thread.id),
    };
  },
  async getFact(id) {
    const [row] = await database
      .select()
      .from(schema.knowledgeFactsTable)
      .where(eq(schema.knowledgeFactsTable.id, id))
      .limit(1);

    return row ? mapFact(row) : null;
  },
  async listFacts() {
    const rows = await database
      .select()
      .from(schema.knowledgeFactsTable)
      .orderBy(desc(schema.knowledgeFactsTable.updatedAt), asc(schema.knowledgeFactsTable.id));

    return rows.map(mapFact);
  },
  async saveFacts(runId, fragments) {
    const records = fragments.map((fragment) => mapFragment(runId, fragment));
    for (const record of records) {
      await database
        .insert(schema.knowledgeFactsTable)
        .values(record)
        .onConflictDoUpdate({
          target: schema.knowledgeFactsTable.id,
          set: {
            runId: record.runId,
            kind: record.kind,
            content: record.content,
            sourceCount: record.sourceCount,
            connectorIds: record.connectorIds,
            sourceIds: record.sourceIds,
            provenance: record.provenance,
            updatedAt: record.updatedAt,
          },
        });
    }

    const rows = await database
      .select()
      .from(schema.knowledgeFactsTable)
      .orderBy(asc(schema.knowledgeFactsTable.id));

    return rows.filter((row) => records.some((record) => record.id === row.id)).map(mapFact);
  },
});
