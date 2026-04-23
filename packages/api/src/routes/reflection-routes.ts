import type { DigitalLifeRuntime } from '@digital-life/orchestrator';
import { Hono } from 'hono';

export const createReflectionRoutes = (runtime: DigitalLifeRuntime) => {
  const app = new Hono();

  app.get('/reflection', async (context) =>
    context.json(await runtime.reflectionService.listItems()),
  );
  app.post('/reflection/recompute', async (context) =>
    context.json(await runtime.reflectionService.recompute()),
  );

  return app;
};
