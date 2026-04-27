import { describe, expect, it } from 'vitest';

import { createPostgresKnowledgeRepository } from '../src/repositories/postgres-knowledge-repository';
import { createPostgresTestDatabase } from './helpers/create-postgres-test-database';

describe('createPostgresKnowledgeRepository', () => {
  it('stores facts and conversations in Postgres', async () => {
    const { database, dispose } = await createPostgresTestDatabase();

    try {
      const repository = createPostgresKnowledgeRepository({ database });
      const storedFacts = await repository.saveFacts('00000000-0000-4000-8000-000000000001', [
        {
          id: 'fact-1',
          content: 'Fact: digital-life can be used as a baseline learning source',
          sourceCount: 2,
          confidence: 0.85,
          kind: 'factual',
          authorities: ['connector:demo'],
          status: 'fragment',
          provenance: {
            entries: [
              {
                source: 'demo.fetchRepository',
                materialId: 'material-1',
                metadata: {
                  connectorId: 'demo',
                },
              },
            ],
            kind: 'factual',
            sources: ['demo.fetchRepository'],
          },
        },
      ]);
      const facts = await repository.listFacts();
      const fact = await repository.getFact('fact-1');
      const conversation = await repository.createConversation();
      const updatedConversation = await repository.appendConversationMessages(conversation.id, [
        {
          role: 'user',
          content: 'What is the baseline source?',
          evidenceFactIds: [],
        },
        {
          role: 'assistant',
          content: 'Grounded answer',
          evidenceFactIds: ['fact-1'],
        },
      ]);
      const reloadedConversation = await repository.getConversation(conversation.id);

      expect(storedFacts[0]?.connectorIds).toEqual(['demo']);
      expect(facts[0]?.sourceIds).toEqual(['demo.fetchRepository']);
      expect(fact?.kind).toBe('factual');
      expect(updatedConversation.messages).toHaveLength(2);
      expect(reloadedConversation?.messages[1]?.evidenceFactIds).toEqual(['fact-1']);
    } finally {
      await dispose();
    }
  });

  it('returns null or errors for missing rows', async () => {
    const { database, dispose } = await createPostgresTestDatabase();

    try {
      const repository = createPostgresKnowledgeRepository({ database });

      expect(await repository.getFact('missing')).toBeNull();
      expect(await repository.getConversation('00000000-0000-4000-8000-000000000099')).toBeNull();
      await expect(
        repository.appendConversationMessages('00000000-0000-4000-8000-000000000099', [
          {
            role: 'assistant',
            content: 'Missing',
            evidenceFactIds: [],
          },
        ]),
      ).rejects.toThrow('Unknown conversation');
    } finally {
      await dispose();
    }
  });
});
