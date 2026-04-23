import type { DigitalLifeRuntime } from '@digital-life/orchestrator';
import { Hono } from 'hono';
import { z } from 'zod';

const personaSchema = z.record(z.string(), z.unknown());
const manualContextSchema = z.array(z.record(z.string(), z.unknown()));

export const createBootstrapRoutes = (runtime: DigitalLifeRuntime) => {
  const app = new Hono();

  app.get('/bootstrap', async (context) => context.json(await runtime.bootstrapService.getState()));
  app.post('/bootstrap/persona', async (context) =>
    context.json(
      await runtime.bootstrapService.savePersona(personaSchema.parse(await context.req.json())),
    ),
  );
  app.post('/bootstrap/manual-context', async (context) =>
    context.json(
      await runtime.bootstrapService.saveManualContext(
        manualContextSchema.parse(await context.req.json()),
      ),
    ),
  );
  app.post('/bootstrap/start', async (context) =>
    context.json(await runtime.bootstrapService.startBaselineRun()),
  );

  return app;
};
