import { describe, expect, it } from 'vitest';

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
});
