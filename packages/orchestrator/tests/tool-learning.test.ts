import { describe, expect, it } from 'vitest';

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
});
