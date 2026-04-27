import type { DigitalLifeRuntime } from '@digital-life/orchestrator';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { createGapsRoutes } from '../src/routes/gaps-routes';
import { createToolProposalsRoutes } from '../src/routes/tool-proposals-routes';

const buildApp = () => {
  const now = new Date('2026-01-01T00:00:00Z');
  const gap = {
    id: 'gap-1',
    type: 'missing_context' as const,
    status: 'open' as const,
    severity: 50,
    title: 'Missing context',
    description: 'The runtime is missing baseline context.',
    evidenceRefs: ['run-1'],
    relatedConnector: 'demo',
    relatedScope: null,
    resolutionHint: null,
    metadata: {},
    createdAt: now,
    updatedAt: now,
  };
  const proposal = {
    id: 'proposal-1',
    type: 'connector' as const,
    status: 'draft' as const,
    title: 'Add connector',
    problem: 'Important data is unavailable.',
    expectedValue: 'Improved evidence coverage.',
    risk: 'low' as const,
    approvalRequired: false,
    evidenceRefs: ['gap-1'],
    implementationPlan: ['Build connector'],
    metadata: {},
    createdAt: now,
    updatedAt: now,
  };
  const need = {
    id: 'need-1',
    signal: 'abstention',
    detail: 'No connector can answer billing questions.',
    occurrences: 2,
    lastSeenAt: now,
    metadata: {},
  };

  const gapService = {
    listGaps: vi.fn(async () => [gap]),
    recompute: vi.fn(async () => [gap]),
    updateStatus: vi.fn(async (id: string, status: typeof gap.status) => {
      if (id === 'missing') {
        return null;
      }
      return { ...gap, id, status, updatedAt: now };
    }),
  };
  const toolLearningService = {
    listProposals: vi.fn(async () => [proposal]),
    listToolNeeds: vi.fn(async () => [need]),
    createProposal: vi.fn(
      async (input: {
        type: 'connector' | 'action_tool' | 'workflow_improvement';
        risk: 'low' | 'medium' | 'high';
        title: string;
        problem: string;
        expectedValue: string;
        evidenceRefs?: string[];
        implementationPlan?: string[];
        metadata?: Record<string, unknown>;
      }) => ({
        ...proposal,
        ...input,
        id: 'proposal-2',
        status: 'draft' as const,
        approvalRequired: input.risk !== 'low',
        evidenceRefs: input.evidenceRefs ?? [],
        implementationPlan: input.implementationPlan ?? [],
        metadata: input.metadata ?? {},
        createdAt: now,
        updatedAt: now,
      }),
    ),
    transition: vi.fn(
      async (
        id: string,
        status: 'draft' | 'review' | 'approved' | 'rejected' | 'staged' | 'active',
      ) => {
        if (id === 'missing') {
          throw new Error(`Unknown proposal: ${id}`);
        }
        return { ...proposal, id, status, updatedAt: now };
      },
    ),
  };

  const runtime = {
    gapService,
    toolLearningService,
  } as unknown as DigitalLifeRuntime;
  const app = new Hono();

  app.route('/api', createGapsRoutes(runtime));
  app.route('/api', createToolProposalsRoutes(runtime));

  return { app, gapService, toolLearningService };
};

describe('tool learning routes', () => {
  it('serves gap endpoints and validates gap status updates', async () => {
    const { app, gapService } = buildApp();

    const listResponse = await app.request('/api/gaps');
    const recomputeResponse = await app.request('/api/gaps/recompute', { method: 'POST' });
    const invalidStatusResponse = await app.request('/api/gaps/gap-1/status', {
      method: 'PATCH',
      body: 'not-json',
      headers: { 'content-type': 'application/json' },
    });
    const missingGapResponse = await app.request('/api/gaps/missing/status', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'resolved' }),
      headers: { 'content-type': 'application/json' },
    });
    const updateResponse = await app.request('/api/gaps/gap-1/status', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'resolved' }),
      headers: { 'content-type': 'application/json' },
    });

    expect(listResponse.status).toBe(200);
    expect(await listResponse.json()).toHaveLength(1);
    expect(recomputeResponse.status).toBe(200);
    expect(await recomputeResponse.json()).toHaveLength(1);
    expect(invalidStatusResponse.status).toBe(400);
    expect(await invalidStatusResponse.json()).toEqual({ error: 'invalid status' });
    expect(missingGapResponse.status).toBe(404);
    expect(await missingGapResponse.json()).toEqual({ error: 'gap not found' });
    expect(updateResponse.status).toBe(200);
    expect((await updateResponse.json()).status).toBe('resolved');
    expect(gapService.updateStatus).toHaveBeenCalledWith('gap-1', 'resolved');
  });

  it('serves tool proposal endpoints and validates creation and transitions', async () => {
    const { app, toolLearningService } = buildApp();

    const proposalsResponse = await app.request('/api/tool-proposals');
    const needsResponse = await app.request('/api/tool-needs');
    const invalidCreateResponse = await app.request('/api/tool-proposals', {
      method: 'POST',
      body: JSON.stringify({ title: '' }),
      headers: { 'content-type': 'application/json' },
    });
    const createResponse = await app.request('/api/tool-proposals', {
      method: 'POST',
      body: JSON.stringify({
        type: 'workflow_improvement',
        risk: 'medium',
        title: 'Add escalation workflow',
        problem: 'Important questions are deferred too often.',
        expectedValue: 'Better operator follow-through.',
        evidenceRefs: ['gap-1'],
        implementationPlan: ['Draft', 'Review'],
        metadata: { owner: 'ops' },
      }),
      headers: { 'content-type': 'application/json' },
    });
    const invalidTransitionResponse = await app.request(
      '/api/tool-proposals/proposal-1/transition',
      {
        method: 'POST',
        body: JSON.stringify({ status: 'queued' }),
        headers: { 'content-type': 'application/json' },
      },
    );
    const missingTransitionResponse = await app.request('/api/tool-proposals/missing/transition', {
      method: 'POST',
      body: JSON.stringify({ status: 'review' }),
      headers: { 'content-type': 'application/json' },
    });
    const transitionResponse = await app.request('/api/tool-proposals/proposal-1/transition', {
      method: 'POST',
      body: JSON.stringify({ status: 'approved' }),
      headers: { 'content-type': 'application/json' },
    });

    expect(proposalsResponse.status).toBe(200);
    expect(await proposalsResponse.json()).toHaveLength(1);
    expect(needsResponse.status).toBe(200);
    expect(await needsResponse.json()).toHaveLength(1);
    expect(invalidCreateResponse.status).toBe(400);
    expect(await invalidCreateResponse.json()).toEqual({ error: 'invalid proposal payload' });
    expect(createResponse.status).toBe(201);
    expect((await createResponse.json()).status).toBe('draft');
    expect(toolLearningService.createProposal).toHaveBeenCalledWith({
      type: 'workflow_improvement',
      risk: 'medium',
      title: 'Add escalation workflow',
      problem: 'Important questions are deferred too often.',
      expectedValue: 'Better operator follow-through.',
      evidenceRefs: ['gap-1'],
      implementationPlan: ['Draft', 'Review'],
      metadata: { owner: 'ops' },
    });
    expect(invalidTransitionResponse.status).toBe(400);
    expect(await invalidTransitionResponse.json()).toEqual({ error: 'invalid transition' });
    expect(missingTransitionResponse.status).toBe(400);
    expect(await missingTransitionResponse.json()).toEqual({
      error: 'Unknown proposal: missing',
    });
    expect(transitionResponse.status).toBe(200);
    expect((await transitionResponse.json()).status).toBe('approved');
    expect(toolLearningService.transition).toHaveBeenCalledWith('proposal-1', 'approved');
  });
});
