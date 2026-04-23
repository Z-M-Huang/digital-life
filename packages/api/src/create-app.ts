import type { DigitalLifeRuntime } from '@digital-life/orchestrator';
import { Hono } from 'hono';

import { createBootstrapRoutes } from './routes/bootstrap-routes';
import { createChatRoutes } from './routes/chat-routes';
import { createConnectorsRoutes } from './routes/connectors-routes';
import { createKnowledgeRoutes } from './routes/knowledge-routes';
import { createLearningRoutes } from './routes/learning-routes';
import { createReadinessRoutes } from './routes/readiness-routes';
import { createReflectionRoutes } from './routes/reflection-routes';
import { createStartupRoutes } from './routes/startup-routes';
import { checkRuntimeReadiness } from './runtime/readiness';

export const createApp = (runtime: DigitalLifeRuntime) => {
  const app = new Hono();

  app.get('/health', (context) => context.json({ ok: true }));
  app.get('/ready', async (context) => {
    const readiness = await checkRuntimeReadiness({
      ...(process.env.DATABASE_URL ? { databaseUrl: process.env.DATABASE_URL } : {}),
      denseMemUrl: runtime.config.denseMem.baseUrl,
    });

    return context.json(readiness, readiness.ok ? 200 : 503);
  });
  app.route('/api', createStartupRoutes(runtime));
  app.route('/api', createConnectorsRoutes(runtime));
  app.route('/api', createBootstrapRoutes(runtime));
  app.route('/api', createLearningRoutes(runtime));
  app.route('/api', createReadinessRoutes(runtime));
  app.route('/api', createReflectionRoutes(runtime));
  app.route('/api', createKnowledgeRoutes(runtime));
  app.route('/api', createChatRoutes(runtime));

  return app;
};
