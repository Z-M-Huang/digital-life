import type { ConsolidatedFragment } from '../services/consolidation-service';

export type KnowledgeFactRecord = {
  id: string;
  runId: string | null;
  kind: string;
  content: string;
  sourceCount: number;
  connectorIds: string[];
  sourceIds: string[];
  provenance: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

export type ConversationMessageRecord = {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  evidenceFactIds: string[];
  createdAt: Date;
};

export type ConversationRecord = {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  messages: ConversationMessageRecord[];
};

export type KnowledgeRepository = {
  appendConversationMessages: (
    conversationId: string,
    messages: Array<Omit<ConversationMessageRecord, 'conversationId' | 'createdAt' | 'id'>>,
  ) => Promise<ConversationRecord>;
  createConversation: () => Promise<ConversationRecord>;
  getConversation: (conversationId: string) => Promise<ConversationRecord | null>;
  getFact: (id: string) => Promise<KnowledgeFactRecord | null>;
  listFacts: () => Promise<KnowledgeFactRecord[]>;
  saveFacts: (runId: string, fragments: ConsolidatedFragment[]) => Promise<KnowledgeFactRecord[]>;
};

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

const mapFragmentToFact = (runId: string, fragment: ConsolidatedFragment): KnowledgeFactRecord => {
  const kind = typeof fragment.provenance.kind === 'string' ? fragment.provenance.kind : 'unknown';
  const now = new Date();

  return {
    id: fragment.id,
    runId,
    kind,
    content: fragment.content,
    sourceCount: fragment.sourceCount,
    connectorIds: connectorIdsFromProvenance(fragment.provenance),
    sourceIds: sourceIdsFromProvenance(fragment.provenance),
    provenance: fragment.provenance,
    createdAt: now,
    updatedAt: now,
  };
};

export const createInMemoryKnowledgeRepository = (): KnowledgeRepository => {
  const facts = new Map<string, KnowledgeFactRecord>();
  const conversations = new Map<string, ConversationRecord>();

  return {
    async appendConversationMessages(conversationId, messages) {
      const current = conversations.get(conversationId);
      if (!current) {
        throw new Error(`Unknown conversation: ${conversationId}`);
      }

      const createdMessages = messages.map((message) => ({
        id: crypto.randomUUID(),
        conversationId,
        role: message.role,
        content: message.content,
        evidenceFactIds: message.evidenceFactIds,
        createdAt: new Date(),
      }));
      const updatedConversation: ConversationRecord = {
        ...current,
        updatedAt: createdMessages.at(-1)?.createdAt ?? new Date(),
        messages: [...current.messages, ...createdMessages],
      };
      conversations.set(conversationId, updatedConversation);
      return updatedConversation;
    },
    async createConversation() {
      const now = new Date();
      const conversation: ConversationRecord = {
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
        messages: [],
      };
      conversations.set(conversation.id, conversation);
      return conversation;
    },
    async getConversation(conversationId) {
      return conversations.get(conversationId) ?? null;
    },
    async getFact(id) {
      return facts.get(id) ?? null;
    },
    async listFacts() {
      return Array.from(facts.values()).sort(
        (left, right) => right.updatedAt.valueOf() - left.updatedAt.valueOf(),
      );
    },
    async saveFacts(runId, fragments) {
      const records = fragments.map((fragment) => mapFragmentToFact(runId, fragment));
      for (const record of records) {
        const existing = facts.get(record.id);
        facts.set(record.id, existing ? { ...record, createdAt: existing.createdAt } : record);
      }

      return records.map((record) => facts.get(record.id) ?? record);
    },
  };
};
