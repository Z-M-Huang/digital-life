import { describe, expect, it } from 'vitest';

import { createInMemoryToolLearningRepository } from '../src/repositories/tool-learning-repository';
import { ToolLearningService } from '../src/services/tool-learning-service';
import { createTestRuntime } from '../src/testing/create-test-runtime';

describe('GapService', () => {
  it('recomputes gaps from reflection items', async () => {
    const runtime = await createTestRuntime();
    await runtime.reflectionService.recompute();
    const gaps = await runtime.gapService.recompute();
    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps.every((gap) => typeof gap.severity === 'number')).toBe(true);
  });

  it('updates gap status', async () => {
    const runtime = await createTestRuntime();
    await runtime.reflectionService.recompute();
    const [first] = await runtime.gapService.recompute();
    if (!first) {
      throw new Error('expected at least one gap');
    }
    const resolved = await runtime.gapService.updateStatus(first.id, 'resolved');
    expect(resolved?.status).toBe('resolved');
  });
});

describe('ToolLearningService', () => {
  it('creates a proposal in draft status with risk-driven approval flag', async () => {
    const runtime = await createTestRuntime();
    const proposal = await runtime.toolLearningService.createProposal({
      type: 'connector',
      risk: 'medium',
      title: 'Add MCP gmail connector',
      problem: 'No email source configured.',
      expectedValue: 'Capture inbox decisions for memory.',
    });
    expect(proposal.status).toBe('draft');
    expect(proposal.approvalRequired).toBe(true);
  });

  it('enforces transition rules', async () => {
    const runtime = await createTestRuntime();
    const proposal = await runtime.toolLearningService.createProposal({
      type: 'workflow_improvement',
      risk: 'low',
      title: 'Tighten retry policy',
      problem: 'Retries are too aggressive.',
      expectedValue: 'Stable nightly cycle.',
    });
    await expect(runtime.toolLearningService.transition(proposal.id, 'active')).rejects.toThrow(
      'Disallowed transition',
    );
    const review = await runtime.toolLearningService.transition(proposal.id, 'review');
    expect(review.status).toBe('review');
    const approved = await runtime.toolLearningService.transition(proposal.id, 'approved');
    expect(approved.status).toBe('approved');
    const staged = await runtime.toolLearningService.transition(proposal.id, 'staged');
    expect(staged.status).toBe('staged');
    const active = await runtime.toolLearningService.transition(proposal.id, 'active');
    expect(active.status).toBe('active');
  });

  it('records tool needs with occurrence aggregation', async () => {
    const runtime = await createTestRuntime();
    const first = await runtime.toolLearningService.recordNeed({
      signal: 'abstention',
      detail: 'Unanswered questions about billing.',
      metadata: { id: 'need-1' },
    });
    expect(first.occurrences).toBe(1);
    const repeat = await runtime.toolLearningRepository.recordToolNeed({
      id: first.id,
      signal: 'abstention',
      detail: 'Same topic repeats.',
      occurrences: 1,
      metadata: {},
    });
    expect(repeat.occurrences).toBe(2);
  });

  it('lists tool needs and auto-applies approved low-risk proposals', async () => {
    const repository = createInMemoryToolLearningRepository();
    const service = new ToolLearningService(repository);

    await service.recordNeed({
      signal: 'abstention',
      detail: 'A billing question could not be answered.',
    });
    await service.recordNeed({
      signal: 'abstention',
      detail: 'A CRM question could not be answered.',
      metadata: { source: 'chat' },
    });

    const lowRisk = await service.createProposal({
      type: 'workflow_improvement',
      risk: 'low',
      title: 'Auto-summarize repeated asks',
      problem: 'Repeated operator questions slow the loop.',
      expectedValue: 'Faster follow-up summaries.',
    });
    const higherRisk = await service.createProposal({
      type: 'connector',
      risk: 'high',
      title: 'Add a production CRM connector',
      problem: 'CRM data is unavailable.',
      expectedValue: 'Grounded answers can cite CRM records.',
    });

    await service.transition(lowRisk.id, 'review');
    await service.transition(lowRisk.id, 'approved');
    await service.transition(higherRisk.id, 'review');
    await service.transition(higherRisk.id, 'approved');

    const needs = await service.listToolNeeds();
    const applied = await service.autoApplyEligibleProposals();
    const proposals = await service.listProposals();

    expect(needs).toHaveLength(2);
    expect(needs.map((need) => need.metadata)).toContainEqual({ source: 'chat' });
    expect(needs.map((need) => need.metadata)).toContainEqual({});
    expect(applied.map((proposal) => proposal.id)).toEqual([lowRisk.id]);
    expect(proposals.find((proposal) => proposal.id === lowRisk.id)?.status).toBe('active');
    expect(proposals.find((proposal) => proposal.id === higherRisk.id)?.status).toBe('approved');
  });

  it('throws when transitions target unknown proposals or repositories that fail to update', async () => {
    const repository = createInMemoryToolLearningRepository();
    const service = new ToolLearningService(repository);

    await expect(service.transition('missing', 'review')).rejects.toThrow('Unknown proposal');

    const proposal = await service.createProposal({
      type: 'connector',
      risk: 'low',
      title: 'Add a docs connector',
      problem: 'Documentation is missing from memory.',
      expectedValue: 'Grounded answers can cite docs.',
    });
    const failingService = new ToolLearningService({
      ...repository,
      async updateProposalStatus() {
        return null;
      },
    });

    await expect(failingService.transition(proposal.id, 'review')).rejects.toThrow(
      'Failed to update proposal',
    );
  });
});

describe('createInMemoryToolLearningRepository', () => {
  it('handles missing updates and list ordering across gaps, needs, and proposals', async () => {
    const repository = createInMemoryToolLearningRepository();

    expect(await repository.updateGapStatus('missing', 'resolved')).toBeNull();
    expect(await repository.updateProposalStatus('missing', 'review')).toBeNull();

    await repository.upsertGap({
      id: 'gap-b',
      type: 'missing_context',
      status: 'open',
      severity: 10,
      title: 'Beta gap',
      description: 'Needs more baseline context.',
      evidenceRefs: [],
      relatedConnector: null,
      relatedScope: null,
      resolutionHint: null,
      metadata: {},
    });
    await repository.upsertGap({
      id: 'gap-a',
      type: 'missing_context',
      status: 'open',
      severity: 10,
      title: 'Alpha gap',
      description: 'Needs more source data.',
      evidenceRefs: [],
      relatedConnector: null,
      relatedScope: null,
      resolutionHint: null,
      metadata: {},
    });

    await repository.recordToolNeed({
      id: 'need-1',
      signal: 'abstention',
      detail: 'First need',
      occurrences: 1,
      metadata: {},
    });
    await repository.recordToolNeed({
      id: 'need-2',
      signal: 'abstention',
      detail: 'Second need',
      occurrences: 1,
      metadata: {},
    });

    await repository.createProposal({
      type: 'connector',
      status: 'draft',
      title: 'First proposal',
      problem: 'Missing source one.',
      expectedValue: 'Adds source one.',
      risk: 'low',
      approvalRequired: false,
      evidenceRefs: [],
      implementationPlan: [],
      metadata: {},
    });
    await repository.createProposal({
      type: 'connector',
      status: 'draft',
      title: 'Second proposal',
      problem: 'Missing source two.',
      expectedValue: 'Adds source two.',
      risk: 'low',
      approvalRequired: false,
      evidenceRefs: [],
      implementationPlan: [],
      metadata: {},
    });

    expect((await repository.listGaps()).map((gap) => gap.title)).toEqual([
      'Alpha gap',
      'Beta gap',
    ]);
    expect(await repository.listToolNeeds()).toHaveLength(2);
    expect(await repository.listProposals()).toHaveLength(2);
  });
});
