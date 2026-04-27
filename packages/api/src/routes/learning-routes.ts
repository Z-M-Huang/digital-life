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
    const runId = context.req.param('id');
    return streamSSE(context, async (stream) => {
      let cursor = 0;
      const terminalTypes = new Set(['done', 'error']);
      const sleep = (ms: number) =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, ms);
        });

      // Poll the event log every 250ms; emit any new entries; stop on done/error
      // or after 60 idle ticks (~15 seconds with no progress) so abandoned
      // streams don't hang HTTP/2 connections forever.
      let idleTicks = 0;
      let lastEmittedType: string | undefined;
      while (!stream.aborted) {
        const events = await runtime.learningService.getRunEvents(runId);
        const newEvents = events.slice(cursor);
        cursor = events.length;
        if (newEvents.length === 0) {
          idleTicks += 1;
        } else {
          idleTicks = 0;
        }
        for (const event of newEvents) {
          await stream.writeSSE({
            data: JSON.stringify(event.payload),
            event: event.type,
          });
          lastEmittedType = event.type;
        }
        if (lastEmittedType && terminalTypes.has(lastEmittedType)) {
          return;
        }
        if (idleTicks >= 60) {
          await stream.writeSSE({
            data: JSON.stringify({ message: 'stream timed out waiting for activity' }),
            event: 'warning',
          });
          return;
        }
        await sleep(250);
      }
    });
  });

  return app;
};
