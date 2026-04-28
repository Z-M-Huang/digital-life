import type {
  ConversationTurn,
  EvidenceItem,
  QueryAgent,
  QueryAgentOutput,
  ReflectionSignal,
} from '@digital-life/agents';

import type { ConversationRecord, KnowledgeRepository } from '../repositories/knowledge-repository';
import type { BootstrapService } from './bootstrap-service';
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

const citedEvidenceFromDecision = (
  evidence: KnowledgeSearchResult[],
  citedEvidenceIds: string[],
): KnowledgeSearchResult[] => {
  const evidenceById = new Map(evidence.map((entry) => [entry.id, entry]));
  return citedEvidenceIds
    .map((id) => evidenceById.get(id))
    .filter((entry): entry is KnowledgeSearchResult => Boolean(entry));
};

const turnsFromConversation = (conversation: ConversationRecord): ConversationTurn[] =>
  conversation.messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => ({
      role: message.role as 'user' | 'assistant',
      content: message.content,
    }));

const FALLBACK_CLARIFICATION = 'Ask a specific question about learned material.';
const MANUAL_CONTEXT_LIMIT = 5;
const PERSONA_STYLE_LIMIT = 5;
const PERSONA_BEHAVIOR_LIMIT = 3;
const PERSONA_REASONING_LIMIT = 2;

const personaFieldString = (persona: Record<string, unknown>, key: string): string | undefined => {
  const value = persona[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
};

const manualContextText = (entry: Record<string, unknown>): string | undefined => {
  const text = entry.text;
  if (typeof text === 'string' && text.trim().length > 0) {
    return text.trim();
  }

  const serialized = JSON.stringify(entry);
  return serialized === '{}' ? undefined : serialized;
};

export class ChatService {
  constructor(
    private readonly knowledgeService: KnowledgeService,
    private readonly repository: KnowledgeRepository,
    private readonly queryAgent: QueryAgent,
    private readonly bootstrapService: BootstrapService,
  ) {}

  private async loadPersonaSlices(): Promise<string[]> {
    const slices: string[] = [];
    try {
      const state = await this.bootstrapService.getState();
      const persona = state.persona ?? {};
      const displayName =
        personaFieldString(persona, 'displayName') ??
        personaFieldString(persona, 'name') ??
        'unnamed user';
      const timezone = personaFieldString(persona, 'timezone');
      const idLine = `Your name (persona display name): ${displayName}.`;
      const localeBits = [timezone ? `timezone: ${timezone}` : null].filter(
        (entry): entry is string => entry !== null,
      );
      slices.push(idLine);
      if (localeBits.length > 0) {
        slices.push(`Locale — ${localeBits.join(', ')}.`);
      }
    } catch {
      // bootstrap state unavailable; fall through with empty persona context
    }

    try {
      const allFacts = await this.knowledgeService.search('', 200);
      const pickByKind = (kind: string, limit: number): KnowledgeSearchResult[] =>
        allFacts.filter((fact) => fact.kind === kind).slice(0, limit);
      const slicesByKind = [
        ...pickByKind('style', PERSONA_STYLE_LIMIT),
        ...pickByKind('behavior', PERSONA_BEHAVIOR_LIMIT),
        ...pickByKind('reasoning', PERSONA_REASONING_LIMIT),
      ];
      for (const fact of slicesByKind) {
        slices.push(`${fact.kind}: ${fact.content}`);
      }
    } catch {
      // knowledge unavailable; persona slices stay minimal
    }

    return slices;
  }

  private async loadSystemPromptAppendix(): Promise<string | undefined> {
    try {
      const state = await this.bootstrapService.getState();
      return personaFieldString(state.persona ?? {}, 'systemPromptAppendix');
    } catch {
      return undefined;
    }
  }

  private async loadManualContextEvidence(): Promise<KnowledgeSearchResult[]> {
    try {
      const state = await this.bootstrapService.getState();
      return state.manualContext
        .map((entry, index): KnowledgeSearchResult | null => {
          const content = manualContextText(entry);
          if (!content) {
            return null;
          }

          return {
            connectorIds: [],
            content,
            id: `manual-context-${index + 1}`,
            kind: 'manual',
            score: 1,
            sourceCount: 1,
            sourceIds: ['manual-context'],
            updatedAt: state.updatedAt,
          };
        })
        .filter((entry): entry is KnowledgeSearchResult => Boolean(entry))
        .slice(-MANUAL_CONTEXT_LIMIT);
    } catch {
      return [];
    }
  }

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
    const retrievedEvidence =
      trimmedQuery.length === 0 ? [] : await this.knowledgeService.search(trimmedQuery, 5);
    const manualEvidence =
      trimmedQuery.length === 0 ? [] : await this.loadManualContextEvidence();
    const evidence = [...manualEvidence, ...retrievedEvidence];

    const personaSlices = trimmedQuery.length === 0 ? [] : await this.loadPersonaSlices();
    const systemPromptAppendix =
      trimmedQuery.length === 0 ? undefined : await this.loadSystemPromptAppendix();
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
            personaSlices,
            ...(systemPromptAppendix ? { systemPromptAppendix } : {}),
            ...(signal ? { signal } : {}),
          });
    const citedEvidence = citedEvidenceFromDecision(evidence, decision.citedEvidenceIds);

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
      evidence: citedEvidence,
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
    const [manualEvidence, retrievedEvidence] = await Promise.all([
      this.loadManualContextEvidence(),
      this.knowledgeService.search(trimmedQuery, 5),
    ]);
    const evidence = [...manualEvidence, ...retrievedEvidence];

    const personaSlices = await this.loadPersonaSlices();
    const systemPromptAppendix = await this.loadSystemPromptAppendix();
    const decision = await this.queryAgent.decide({
      query: trimmedQuery,
      evidence: evidence.map(evidenceFromSearch),
      conversation: turnsFromConversation(conversation),
      personaSlices,
      ...(systemPromptAppendix ? { systemPromptAppendix } : {}),
    });
    const citedEvidence = citedEvidenceFromDecision(evidence, decision.citedEvidenceIds);

    const clarificationRequest =
      decision.mode === 'clarification'
        ? (decision.clarificationQuestion ?? FALLBACK_CLARIFICATION)
        : null;
    const answerText = clarificationRequest ?? decision.answer.trim();

    if (clarificationRequest) {
      yield {
        type: 'clarification_request',
        payload: { message: clarificationRequest },
      };
    } else {
      // Emit the answer in fixed-size text deltas so the frontend can render
      // progressively without any whitespace fudging.
      const deltaSize = 24;
      for (let offset = 0; offset < answerText.length; offset += deltaSize) {
        yield {
          type: 'text_delta',
          payload: { delta: answerText.slice(offset, offset + deltaSize) },
        };
      }
    }

    for (const item of citedEvidence) {
      yield { type: 'evidence', payload: item };
    }

    for (const signal of decision.reflectionSignals) {
      yield { type: 'reflection_signal', payload: signal };
    }

    const updatedConversation = await this.repository.appendConversationMessages(conversation.id, [
      {
        role: 'user',
        content: trimmedQuery,
        evidenceFactIds: [],
      },
      {
        role: 'assistant',
        content: clarificationRequest ?? decision.answer,
        evidenceFactIds: decision.citedEvidenceIds,
      },
    ]);

    yield {
      type: 'done',
      payload: {
        answer: clarificationRequest ? '' : decision.answer,
        clarificationRequest,
        conversationId: updatedConversation.id,
        evidenceCount: citedEvidence.length,
        mode: decision.mode,
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
