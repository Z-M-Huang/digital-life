import type {
  ConversationTurn,
  EvidenceItem,
  LLMClient,
  QueryAgent,
  QueryAgentOutput,
  ReflectionSignal,
} from '@digital-life/agents';

import type { ConversationRecord, KnowledgeRepository } from '../repositories/knowledge-repository';
import type { KnowledgeSearchResult, KnowledgeService } from './knowledge-service';

export type ChatEvidence = KnowledgeSearchResult;

export type ChatQueryResult = {
  answer: string;
  clarificationRequest: string | null;
  conversation: ConversationRecord;
  evidence: ChatEvidence[];
  mode: QueryAgentOutput['mode'];
  reflectionSignals: ReflectionSignal[];
};

export type ChatStreamEvent =
  | { payload: { delta: string }; type: 'text_delta' }
  | { payload: ChatEvidence; type: 'evidence' }
  | { payload: { message: string }; type: 'clarification_request' }
  | { payload: ReflectionSignal; type: 'reflection_signal' }
  | {
      payload: {
        answer: string;
        clarificationRequest: string | null;
        conversationId: string;
        evidenceCount: number;
        mode: QueryAgentOutput['mode'];
      };
      type: 'done';
    }
  | { payload: { message: string }; type: 'error' };

const splitIntoDeltas = (answer: string): string[] =>
  answer
    .split(/(?<=[.!?])\s+/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);

const evidenceFromSearch = (search: KnowledgeSearchResult): EvidenceItem => ({
  id: search.id,
  content: search.content,
  score: search.score,
  kind: search.kind,
  connectorIds: search.connectorIds,
});

const turnsFromConversation = (conversation: ConversationRecord): ConversationTurn[] =>
  conversation.messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => ({
      role: message.role as 'user' | 'assistant',
      content: message.content,
    }));

const FALLBACK_CLARIFICATION = 'Ask a specific question about learned material.';

export class ChatService {
  constructor(
    private readonly knowledgeService: KnowledgeService,
    private readonly repository: KnowledgeRepository,
    private readonly queryAgent: QueryAgent,
    private readonly llmClient: LLMClient,
  ) {}

  async getConversation(conversationId: string): Promise<ConversationRecord | null> {
    return this.repository.getConversation(conversationId);
  }

  async query({
    conversationId,
    query,
    signal,
  }: {
    conversationId?: string;
    query: string;
    signal?: AbortSignal;
  }): Promise<ChatQueryResult> {
    const trimmedQuery = query.trim();
    const conversation = conversationId
      ? await this.loadConversation(conversationId)
      : await this.repository.createConversation();
    const evidence =
      trimmedQuery.length === 0 ? [] : await this.knowledgeService.search(trimmedQuery, 5);

    const decision: QueryAgentOutput =
      trimmedQuery.length === 0
        ? {
            mode: 'clarification',
            answer: '',
            clarificationQuestion: FALLBACK_CLARIFICATION,
            citedEvidenceIds: [],
            reflectionSignals: [],
          }
        : await this.queryAgent.decide({
            query: trimmedQuery,
            evidence: evidence.map(evidenceFromSearch),
            conversation: turnsFromConversation(conversation),
            ...(signal ? { signal } : {}),
          });

    const clarificationRequest =
      decision.mode === 'clarification'
        ? (decision.clarificationQuestion ?? FALLBACK_CLARIFICATION)
        : decision.mode === 'abstention' && decision.answer.trim().length === 0
          ? `No grounded evidence matched "${trimmedQuery}". Narrow the question or run learning first.`
          : null;
    const answer = clarificationRequest ? '' : decision.answer.trim();

    const updatedConversation = await this.repository.appendConversationMessages(conversation.id, [
      {
        role: 'user',
        content: trimmedQuery.length === 0 ? query : trimmedQuery,
        evidenceFactIds: [],
      },
      {
        role: 'assistant',
        content: clarificationRequest ?? answer,
        evidenceFactIds: decision.citedEvidenceIds,
      },
    ]);

    return {
      answer,
      clarificationRequest,
      conversation: updatedConversation,
      evidence,
      mode: decision.mode,
      reflectionSignals: decision.reflectionSignals,
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
              mode: result.mode,
            },
          },
        ];
      }

      const events: ChatStreamEvent[] = [
        ...splitIntoDeltas(result.answer).map((delta) => ({
          type: 'text_delta' as const,
          payload: { delta },
        })),
        ...result.evidence.map(
          (entry) =>
            ({
              type: 'evidence' as const,
              payload: entry,
            }) as ChatStreamEvent,
        ),
        ...result.reflectionSignals.map(
          (signal) =>
            ({
              type: 'reflection_signal' as const,
              payload: signal,
            }) as ChatStreamEvent,
        ),
        {
          type: 'done',
          payload: {
            answer: result.answer,
            clarificationRequest: null,
            conversationId: result.conversation.id,
            evidenceCount: result.evidence.length,
            mode: result.mode,
          },
        },
      ];
      return events;
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

  /**
   * Stream chat tokens via the configured LLM. Used by SSE consumers that want
   * real incremental deltas instead of post-hoc sentence splits.
   */
  async *streamTokens(input: {
    conversationId?: string;
    query: string;
  }): AsyncGenerator<ChatStreamEvent> {
    const trimmedQuery = input.query.trim();
    if (trimmedQuery.length === 0) {
      yield {
        type: 'clarification_request',
        payload: { message: FALLBACK_CLARIFICATION },
      };
      return;
    }

    const conversation = input.conversationId
      ? await this.loadConversation(input.conversationId)
      : await this.repository.createConversation();
    const evidence = await this.knowledgeService.search(trimmedQuery, 5);

    for (const item of evidence) {
      yield { type: 'evidence', payload: item };
    }

    const { system, prompt } = this.queryAgent.buildAnswerPrompt({
      query: trimmedQuery,
      evidence: evidence.map(evidenceFromSearch),
      conversation: turnsFromConversation(conversation),
    });
    const stream = this.llmClient.streamText({
      system,
      prompt,
      context: { promptId: 'query', promptVersion: 'stream' },
    });

    let fullAnswer = '';
    for await (const delta of stream.textStream) {
      fullAnswer += delta;
      yield { type: 'text_delta', payload: { delta } };
    }

    const updatedConversation = await this.repository.appendConversationMessages(conversation.id, [
      {
        role: 'user',
        content: trimmedQuery,
        evidenceFactIds: [],
      },
      {
        role: 'assistant',
        content: fullAnswer,
        evidenceFactIds: evidence.map((entry) => entry.id),
      },
    ]);

    yield {
      type: 'done',
      payload: {
        answer: fullAnswer,
        clarificationRequest: null,
        conversationId: updatedConversation.id,
        evidenceCount: evidence.length,
        mode: 'grounded',
      },
    };
  }

  private async loadConversation(conversationId: string): Promise<ConversationRecord> {
    const conversation = await this.repository.getConversation(conversationId);
    if (!conversation) {
      throw new Error(`Unknown conversation: ${conversationId}`);
    }

    return conversation;
  }
}
