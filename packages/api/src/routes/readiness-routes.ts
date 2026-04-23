import type { DigitalLifeRuntime } from '@digital-life/orchestrator';
import { Hono } from 'hono';

export const createReadinessRoutes = (runtime: DigitalLifeRuntime) => {
  const app = new Hono();

  app.get('/readiness', async (context) =>
    context.json(await runtime.readinessService.getReadiness()),
  );
  app.get('/dashboard', async (context) =>
    context.json(await runtime.readinessService.getDashboard()),
  );

  return app;
};
