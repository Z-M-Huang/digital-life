import type { DigitalLifeRuntime } from '@digital-life/orchestrator';
import { Hono } from 'hono';

import { createBearerAuth } from './middleware/auth';
import { createCorsMiddleware } from './middleware/cors';
import { createRequestLogger, createStructuredLogger } from './middleware/logger';
import { createRateLimitMiddleware } from './middleware/rate-limit';
import { createBootstrapRoutes } from './routes/bootstrap-routes';
import { createChatRoutes } from './routes/chat-routes';
import { createConnectorsRoutes } from './routes/connectors-routes';
import { createGapsRoutes } from './routes/gaps-routes';
import { createKnowledgeRoutes } from './routes/knowledge-routes';
import { createLearningRoutes } from './routes/learning-routes';
import { createReadinessRoutes } from './routes/readiness-routes';
import { createReflectionRoutes } from './routes/reflection-routes';
import { createStartupRoutes } from './routes/startup-routes';
import { createToolProposalsRoutes } from './routes/tool-proposals-routes';
import { checkRuntimeReadiness } from './runtime/readiness';

export type CreateAppOptions = {
  authToken?: string;
  corsOrigin?: string | ReadonlyArray<string>;
  rateLimit?: { windowMs: number; max: number };
  enableRequestLogger?: boolean;
};

export const createApp = (runtime: DigitalLifeRuntime, options: CreateAppOptions = {}) => {
  const app = new Hono();

  app.use('*', createCorsMiddleware({ origin: options.corsOrigin ?? '*' }));
  if (options.enableRequestLogger) {
    app.use('*', createRequestLogger(createStructuredLogger()));
  }
  if (options.rateLimit) {
    app.use('/api/*', createRateLimitMiddleware(options.rateLimit));
  }
  if (options.authToken) {
    app.use('/api/*', createBearerAuth({ token: options.authToken }));
  }

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
  app.route('/api', createGapsRoutes(runtime));
  app.route('/api', createToolProposalsRoutes(runtime));

  return app;
};
