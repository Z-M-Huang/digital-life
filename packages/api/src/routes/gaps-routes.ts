import type { DigitalLifeRuntime } from '@digital-life/orchestrator';
import { Hono } from 'hono';
import { z } from 'zod';

const statusSchema = z.enum(['open', 'queued', 'surfaced', 'snoozed', 'resolved', 'dismissed']);

export const createGapsRoutes = (runtime: DigitalLifeRuntime) => {
  const app = new Hono();

  app.get('/gaps', async (context) => context.json(await runtime.gapService.listGaps()));

  app.post('/gaps/recompute', async (context) =>
    context.json(await runtime.gapService.recompute()),
  );

  app.patch('/gaps/:id/status', async (context) => {
    const id = context.req.param('id');
    const body = await context.req.json().catch(() => ({}));
    const parsed = z.object({ status: statusSchema }).safeParse(body);
    if (!parsed.success) {
      return context.json({ error: 'invalid status' }, 400);
    }
    const updated = await runtime.gapService.updateStatus(id, parsed.data.status);
    if (!updated) {
      return context.json({ error: 'gap not found' }, 404);
    }
    return context.json(updated);
  });

  return app;
};
