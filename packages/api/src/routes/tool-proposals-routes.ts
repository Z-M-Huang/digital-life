import type { DigitalLifeRuntime } from '@digital-life/orchestrator';
import { Hono } from 'hono';
import { z } from 'zod';

const createProposalSchema = z.object({
  type: z.enum(['connector', 'action_tool', 'workflow_improvement']),
  risk: z.enum(['low', 'medium', 'high']),
  title: z.string().min(1),
  problem: z.string().min(1),
  expectedValue: z.string().min(1),
  evidenceRefs: z.array(z.string()).optional(),
  implementationPlan: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const transitionSchema = z.object({
  status: z.enum(['draft', 'review', 'approved', 'rejected', 'staged', 'active']),
});

export const createToolProposalsRoutes = (runtime: DigitalLifeRuntime) => {
  const app = new Hono();

  app.get('/tool-proposals', async (context) =>
    context.json(await runtime.toolLearningService.listProposals()),
  );

  app.get('/tool-needs', async (context) =>
    context.json(await runtime.toolLearningService.listToolNeeds()),
  );

  app.post('/tool-proposals', async (context) => {
    const parsed = createProposalSchema.safeParse(await context.req.json());
    if (!parsed.success) {
      return context.json({ error: 'invalid proposal payload' }, 400);
    }
    const proposal = await runtime.toolLearningService.createProposal({
      type: parsed.data.type,
      risk: parsed.data.risk,
      title: parsed.data.title,
      problem: parsed.data.problem,
      expectedValue: parsed.data.expectedValue,
      ...(parsed.data.evidenceRefs ? { evidenceRefs: parsed.data.evidenceRefs } : {}),
      ...(parsed.data.implementationPlan
        ? { implementationPlan: parsed.data.implementationPlan }
        : {}),
      ...(parsed.data.metadata ? { metadata: parsed.data.metadata } : {}),
    });
    return context.json(proposal, 201);
  });

  app.post('/tool-proposals/:id/transition', async (context) => {
    const parsed = transitionSchema.safeParse(await context.req.json());
    if (!parsed.success) {
      return context.json({ error: 'invalid transition' }, 400);
    }
    try {
      const updated = await runtime.toolLearningService.transition(
        context.req.param('id'),
        parsed.data.status,
      );
      return context.json(updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'transition failed';
      return context.json({ error: message }, 400);
    }
  });

  return app;
};
