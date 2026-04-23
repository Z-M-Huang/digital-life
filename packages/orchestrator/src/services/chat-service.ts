import type { ConversationRecord, KnowledgeRepository } from '../repositories/knowledge-repository';
import type { KnowledgeSearchResult, KnowledgeService } from './knowledge-service';

export type ChatEvidence = KnowledgeSearchResult;

export type ChatQueryResult = {
  answer: string;
  clarificationRequest: string | null;
  conversation: ConversationRecord;
  evidence: ChatEvidence[];
};

export type ChatStreamEvent =
  | { payload: { delta: string }; type: 'text_delta' }
  | { payload: ChatEvidence; type: 'evidence' }
  | { payload: { message: string }; type: 'clarification_request' }
  | {
      payload: {
        answer: string;
        clarificationRequest: string | null;
        conversationId: string;
        evidenceCount: number;
      };
      type: 'done';
    }
  | { payload: { message: string }; type: 'error' };

const splitIntoDeltas = (answer: string): string[] =>
  answer
    .split(/(?<=[.!?])\s+/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);

const buildAnswer = (query: string, evidence: ChatEvidence[]): string => {
  const lead = evidence[0]?.content ?? '';
  const remaining = evidence.slice(1).map((entry) => entry.content);
  if (remaining.length === 0) {
    return `Grounded answer for "${query}": ${lead}`;
  }

  return `Grounded answer for "${query}": ${lead} Additional evidence: ${remaining.join(' ')}`;
};

export class ChatService {
  constructor(
    private readonly knowledgeService: KnowledgeService,
    private readonly repository: KnowledgeRepository,
  ) {}

  async getConversation(conversationId: string): Promise<ConversationRecord | null> {
    return this.repository.getConversation(conversationId);
  }

  async query({
    conversationId,
    query,
  }: {
    conversationId?: string;
    query: string;
  }): Promise<ChatQueryResult> {
    const trimmedQuery = query.trim();
    const conversation = conversationId
      ? await this.loadConversation(conversationId)
      : await this.repository.createConversation();
    const evidence =
      trimmedQuery.length === 0 ? [] : await this.knowledgeService.search(trimmedQuery, 3);
    const clarificationRequest =
      trimmedQuery.length === 0
        ? 'Ask a specific question about learned material.'
        : evidence.length === 0
          ? `No grounded evidence matched "${trimmedQuery}". Narrow the question or run learning first.`
          : null;
    const answer = clarificationRequest ? '' : buildAnswer(trimmedQuery, evidence);

    const updatedConversation = await this.repository.appendConversationMessages(conversation.id, [
      {
        role: 'user',
        content: trimmedQuery.length === 0 ? query : trimmedQuery,
        evidenceFactIds: [],
      },
      {
        role: 'assistant',
        content: clarificationRequest ?? answer,
        evidenceFactIds: evidence.map((entry) => entry.id),
      },
    ]);

    return {
      answer,
      clarificationRequest,
      conversation: updatedConversation,
      evidence,
    };
  }

  async streamQuery(input: { conversationId?: string; query: string }): Promise<ChatStreamEvent[]> {
    try {
      const result = await this.query(input);
      if (result.clarificationRequest) {
        return [
          {
            type: 'clarification_request',
            payload: { message: result.clarificationRequest },
          },
          {
            type: 'done',
            payload: {
              answer: '',
              clarificationRequest: result.clarificationRequest,
              conversationId: result.conversation.id,
              evidenceCount: 0,
            },
          },
        ];
      }

      return [
        ...splitIntoDeltas(result.answer).map((delta) => ({
          type: 'text_delta' as const,
          payload: { delta },
        })),
        ...result.evidence.map((entry) => ({
          type: 'evidence' as const,
          payload: entry,
        })),
        {
          type: 'done',
          payload: {
            answer: result.answer,
            clarificationRequest: null,
            conversationId: result.conversation.id,
            evidenceCount: result.evidence.length,
          },
        },
      ];
    } catch (error) {
      return [
        {
          type: 'error',
          payload: {
            message: error instanceof Error ? error.message : 'Unknown chat error',
          },
        },
      ];
    }
  }

  private async loadConversation(conversationId: string): Promise<ConversationRecord> {
    const conversation = await this.repository.getConversation(conversationId);
    if (!conversation) {
      throw new Error(`Unknown conversation: ${conversationId}`);
    }

    return conversation;
  }
}
