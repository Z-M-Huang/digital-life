import type { DigitalLifeRuntime } from '@digital-life/orchestrator';
import { Hono } from 'hono';
import { z } from 'zod';

const querySchema = z.object({
  limit: z.coerce.number().int().positive().max(50).optional(),
  q: z.string().optional(),
});

export const createKnowledgeRoutes = (runtime: DigitalLifeRuntime) => {
  const app = new Hono();

  app.get('/knowledge/search', async (context) => {
    const query = querySchema.parse(context.req.query());
    return context.json(await runtime.knowledgeService.search(query.q ?? '', query.limit ?? 10));
  });
  app.get('/evidence/facts/:id', async (context) => {
    const fact = await runtime.knowledgeService.getFact(context.req.param('id'));
    return fact ? context.json(fact) : context.json({ error: 'fact not found' }, 404);
  });
  app.get('/evidence/communities', async (context) =>
    context.json(await runtime.knowledgeService.listCommunities()),
  );

  return app;
};
