import { describe, expect, it } from 'vitest';
import type { QueryAgent } from '@digital-life/agents';

import { createInMemoryKnowledgeRepository } from '../src/repositories/knowledge-repository';
import type { BootstrapService } from '../src/services/bootstrap-service';
import { ChatService, type ChatStreamEvent } from '../src/services/chat-service';
import type { KnowledgeSearchResult, KnowledgeService } from '../src/services/knowledge-service';
import { createTestRuntime } from '../src/testing/create-test-runtime';

describe('knowledge and chat services', () => {
  it('persists learned facts, exposes evidence communities, and answers grounded chat queries', async () => {
    const runtime = await createTestRuntime();

    await runtime.connectorService.setScope('demo', [
      { id: 'repo-1', label: 'digital-life', metadata: { kind: 'repository' } },
    ]);
    const run = await runtime.learningService.createRun({
      mode: 'baseline',
      connectorIds: ['demo'],
    });
    const knowledge = await runtime.knowledgeService.search('baseline', 5);
    const fact = await runtime.knowledgeService.getFact(knowledge[0]?.id ?? 'missing');
    const communities = await runtime.knowledgeService.listCommunities();
    const chat = await runtime.chatService.query({
      query: 'What did we learn about the baseline source?',
    });

    expect(run.status).toBe('completed');
    expect(knowledge.length).toBeGreaterThan(0);
    expect(knowledge[0]?.content).toContain('baseline learning source');
    expect(fact?.provenance.kind).toBeDefined();
    expect(communities[0]?.factCount).toBeGreaterThan(0);
    expect(chat.answer).toContain('Grounded answer');
    expect(chat.evidence.length).toBeGreaterThan(0);
    expect(chat.conversation.messages).toHaveLength(2);
    expect(chat.conversation.messages[1]?.evidenceFactIds.length).toBeGreaterThan(0);
  });

  it('requests clarification when no grounded evidence matches', async () => {
    const runtime = await createTestRuntime();
    const chat = await runtime.chatService.query({
      query: 'Tell me about an unlearned billing system',
    });
    const events = await runtime.chatService.streamQuery({
      query: 'Tell me about an unlearned billing system',
    });

    expect(chat.answer).toBe('');
    expect(chat.clarificationRequest).toContain('No grounded evidence matched');
    expect(events[0]?.type).toBe('clarification_request');
    expect(events.at(-1)?.type).toBe('done');
  });

  it('handles empty queries, missing conversations, and continued conversations', async () => {
    const runtime = await createTestRuntime();
    const blank = await runtime.chatService.query({
      query: '   ',
    });
    const initial = await runtime.chatService.query({
      query: 'First grounded turn',
    });
    const continued = await runtime.chatService.query({
      conversationId: initial.conversation.id,
      query: 'Second grounded turn',
    });
    const missingConversationEvents = await runtime.chatService.streamQuery({
      conversationId: '00000000-0000-4000-8000-000000000099',
      query: 'hello',
    });

    expect(blank.clarificationRequest).toContain('Ask a specific question');
    expect(await runtime.chatService.getConversation(initial.conversation.id)).not.toBeNull();
    expect(continued.conversation.messages.length).toBeGreaterThan(
      initial.conversation.messages.length,
    );
    expect(missingConversationEvents[0]?.type).toBe('error');
    if (missingConversationEvents[0]?.type !== 'error') {
      throw new Error('Expected an error event for the missing conversation.');
    }

    expect(missingConversationEvents[0].payload.message).toContain('Unknown conversation');
  });

  it('uses manual context as chat evidence', async () => {
    const runtime = await createTestRuntime();
    await runtime.bootstrapService.saveManualContext([
      { source: 'operator', text: 'The persona only played Dream Journey.' },
    ]);

    const chat = await runtime.chatService.query({
      query: 'Which game did the persona play?',
    });

    expect(chat.evidence.map((entry) => entry.id)).toContain('manual-context-1');
    expect(chat.conversation.messages[1]?.evidenceFactIds).toContain('manual-context-1');
  });

  it('returns only cited evidence with chat responses', async () => {
    const evidence: KnowledgeSearchResult[] = [
      {
        connectorIds: ['filesystem'],
        content: 'The user only played Dream Journey.',
        id: 'fact-1',
        kind: 'factual',
        score: 0.9,
        sourceCount: 1,
        sourceIds: ['source-1'],
        updatedAt: new Date(),
      },
      {
        connectorIds: ['filesystem'],
        content: 'The user had no time to keep playing.',
        id: 'fact-2',
        kind: 'factual',
        score: 0.7,
        sourceCount: 1,
        sourceIds: ['source-2'],
        updatedAt: new Date(),
      },
    ];
    const chatService = new ChatService(
      {
        search: async (query: string) => (query.trim().length > 0 ? evidence : []),
      } as unknown as KnowledgeService,
      createInMemoryKnowledgeRepository(),
      {
        buildAnswerPrompt: () => ({ messages: [], prompt: '', system: '' }),
        decide: async () => ({
          mode: 'grounded',
          answer: 'Only Dream Journey.',
          clarificationQuestion: null,
          citedEvidenceIds: ['fact-1'],
          reflectionSignals: [],
        }),
      } as QueryAgent,
      {
        getState: async () => ({
          baselineRunId: null,
          manualContext: [],
          persona: { displayName: 'Meeting', systemPromptAppendix: 'Stay concise.' },
          recommendedConnectors: [],
          status: 'complete',
          updatedAt: new Date(),
        }),
      } as unknown as BootstrapService,
    );

    const result = await chatService.query({ query: 'Which game did you play last year?' });
    const streamEvents: ChatStreamEvent[] = [];
    for await (const event of chatService.streamTokens({
      query: 'Which game did you play last year?',
    })) {
      streamEvents.push(event);
    }
    const evidenceEvents = streamEvents.filter(
      (event): event is Extract<ChatStreamEvent, { type: 'evidence' }> =>
        event.type === 'evidence',
    );

    expect(result.evidence.map((entry) => entry.id)).toEqual(['fact-1']);
    expect(evidenceEvents.map((event) => event.payload.id)).toEqual(['fact-1']);
  });
});
