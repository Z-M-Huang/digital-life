import type { DigitalLifeRuntime } from '@digital-life/orchestrator';
import { Hono } from 'hono';

export const createStartupRoutes = (runtime: DigitalLifeRuntime) => {
  const app = new Hono();

  app.get('/startup', async (context) => context.json(await runtime.startupService.getSummary()));
  app.post('/startup/validate', async (context) =>
    context.json(await runtime.startupService.validate()),
  );
  app.get('/startup/logs', async (context) => context.json(await runtime.startupService.getLogs()));

  return app;
};
