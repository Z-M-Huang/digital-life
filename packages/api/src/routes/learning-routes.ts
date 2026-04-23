import type { DigitalLifeRuntime } from '@digital-life/orchestrator';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';

const createLearningRunSchema = z.object({
  connectorIds: z.array(z.string()).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
  mode: z.enum(['baseline', 'incremental', 'resync']),
});

export const createLearningRoutes = (runtime: DigitalLifeRuntime) => {
  const app = new Hono();

  app.get('/learning/runs', async (context) =>
    context.json(await runtime.learningService.listRuns()),
  );
  app.post('/learning/runs', async (context) => {
    const payload = createLearningRunSchema.parse(await context.req.json());
    return context.json(
      await runtime.learningService.createRun({
        mode: payload.mode,
        ...(payload.connectorIds ? { connectorIds: payload.connectorIds } : {}),
        ...(payload.details ? { details: payload.details } : {}),
      }),
      201,
    );
  });

  app.get('/learning/runs/:id', async (context) => {
    const run = await runtime.learningService.getRun(context.req.param('id'));
    return run ? context.json(run) : context.json({ error: 'run not found' }, 404);
  });

  app.get('/learning/runs/:id/logs', async (context) =>
    context.json(await runtime.learningService.getRunEvents(context.req.param('id'))),
  );

  app.get('/learning/runs/:id/stream', async (context) => {
    const events = await runtime.learningService.getRunEvents(context.req.param('id'));
    return streamSSE(context, async (stream) => {
      for (const event of events) {
        await stream.writeSSE({
          data: JSON.stringify(event.payload),
          event: event.type,
        });
      }
    });
  });

  return app;
};
