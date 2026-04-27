import { describe, expect, it } from 'vitest';

import { createPostgresToolLearningRepository } from '../src/repositories/postgres-tool-learning-repository';
import { createPostgresTestDatabase } from './helpers/create-postgres-test-database';

describe('createPostgresToolLearningRepository', () => {
  const missingId = '00000000-0000-4000-8000-000000000099';

  it('stores gaps, tool needs, and proposals in Postgres', async () => {
    const { database, dispose } = await createPostgresTestDatabase();

    try {
      const repository = createPostgresToolLearningRepository({ database });

      expect(await repository.listGaps()).toEqual([]);
      expect(await repository.updateGapStatus(missingId, 'resolved')).toBeNull();
      expect(await repository.listToolNeeds()).toEqual([]);
      expect(await repository.listProposals()).toEqual([]);
      expect(await repository.updateProposalStatus(missingId, 'review')).toBeNull();

      const gap = await repository.upsertGap({
        type: 'missing_context',
        status: 'open',
        severity: 50,
        title: 'Missing context',
        description: 'The baseline run did not capture enough context.',
        evidenceRefs: ['run-1'],
        relatedConnector: 'demo',
        relatedScope: 'repo-1',
        resolutionHint: 'Run a targeted resync.',
        metadata: { source: 'reflection' },
      });
      const updatedGap = await repository.upsertGap({
        id: gap.id,
        type: 'missing_access',
        status: 'queued',
        severity: 80,
        title: 'Missing access',
        description: 'The connector has no authorized scope.',
        evidenceRefs: ['run-2'],
        relatedConnector: 'demo',
        relatedScope: 'repo-2',
        resolutionHint: null,
        metadata: { source: 'operator' },
      });
      const resolvedGap = await repository.updateGapStatus(gap.id, 'resolved');

      expect((await repository.listGaps())[0]).toMatchObject({
        id: gap.id,
        type: 'missing_access',
        status: 'resolved',
        severity: 80,
        title: 'Missing access',
        evidenceRefs: ['run-2'],
        relatedScope: 'repo-2',
        metadata: { source: 'operator' },
      });
      expect(updatedGap.relatedConnector).toBe('demo');
      expect(resolvedGap?.status).toBe('resolved');

      const firstNeed = await repository.recordToolNeed({
        signal: 'abstention',
        detail: 'No connector can answer billing questions.',
        occurrences: 1,
        metadata: { topic: 'billing' },
      });
      const repeatedNeed = await repository.recordToolNeed({
        id: firstNeed.id,
        signal: 'abstention',
        detail: 'The same billing question reappeared.',
        occurrences: 2,
        metadata: { topic: 'billing' },
      });

      expect((await repository.listToolNeeds())[0]).toMatchObject({
        id: firstNeed.id,
        signal: 'abstention',
        detail: 'The same billing question reappeared.',
        occurrences: 3,
        metadata: { topic: 'billing' },
      });
      expect(repeatedNeed.occurrences).toBe(3);

      const proposal = await repository.createProposal({
        type: 'connector',
        status: 'draft',
        title: 'Add a Gmail connector',
        problem: 'Inbox messages are unavailable.',
        expectedValue: 'Email evidence can be grounded in chat answers.',
        risk: 'medium',
        approvalRequired: true,
        evidenceRefs: ['gap-1'],
        implementationPlan: ['Design scopes', 'Build connector'],
        metadata: { owner: 'ops' },
      });
      const reviewedProposal = await repository.updateProposalStatus(proposal.id, 'review');

      expect((await repository.listProposals())[0]).toMatchObject({
        id: proposal.id,
        type: 'connector',
        status: 'review',
        title: 'Add a Gmail connector',
        risk: 'medium',
        approvalRequired: true,
        evidenceRefs: ['gap-1'],
        implementationPlan: ['Design scopes', 'Build connector'],
        metadata: { owner: 'ops' },
      });
      expect(reviewedProposal?.status).toBe('review');
    } finally {
      await dispose();
    }
  });
});
