import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createBearerAuth } from '../src/middleware/auth';
import { createCorsMiddleware } from '../src/middleware/cors';
import { createRequestLogger, createStructuredLogger } from '../src/middleware/logger';
import { createRateLimitMiddleware } from '../src/middleware/rate-limit';

describe('bearer auth middleware', () => {
  it('rejects missing tokens with 401', async () => {
    const app = new Hono();
    app.use('*', createBearerAuth({ token: 'secret' }));
    app.get('/protected', (context) => context.json({ ok: true }));
    const response = await app.request('/protected');
    expect(response.status).toBe(401);
  });

  it('allows requests with the correct bearer token', async () => {
    const app = new Hono();
    app.use('*', createBearerAuth({ token: 'secret' }));
    app.get('/protected', (context) => context.json({ ok: true }));
    const response = await app.request('/protected', {
      headers: { authorization: 'Bearer secret' },
    });
    expect(response.status).toBe(200);
  });

  it('exempts /health and /ready by default', async () => {
    const app = new Hono();
    app.use('*', createBearerAuth({ token: 'secret' }));
    app.get('/health', (context) => context.json({ ok: true }));
    expect((await app.request('/health')).status).toBe(200);
  });
});

describe('CORS middleware', () => {
  it('attaches CORS headers and short-circuits OPTIONS', async () => {
    const app = new Hono();
    app.use('*', createCorsMiddleware());
    app.get('/ping', (context) => context.json({ ok: true }));
    const optionsResponse = await app.request('/ping', { method: 'OPTIONS' });
    expect(optionsResponse.status).toBe(204);
    expect(optionsResponse.headers.get('access-control-allow-origin')).toBe('*');
  });
});

describe('rate-limit middleware', () => {
  it('returns 429 once the per-window cap is exceeded', async () => {
    const app = new Hono();
    app.use('*', createRateLimitMiddleware({ windowMs: 60_000, max: 2 }));
    app.get('/ping', (context) => context.json({ ok: true }));
    expect((await app.request('/ping')).status).toBe(200);
    expect((await app.request('/ping')).status).toBe(200);
    const limited = await app.request('/ping');
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).not.toBeNull();
  });
});

describe('structured logger middleware', () => {
  it('emits a single info entry per request', async () => {
    const entries: Array<{ level: string; context?: Record<string, unknown> }> = [];
    const logger = createStructuredLogger((entry) => entries.push(entry));
    const app = new Hono();
    app.use('*', createRequestLogger(logger));
    app.get('/ping', (context) => context.json({ ok: true }));
    await app.request('/ping');
    expect(entries).toHaveLength(1);
    expect(entries[0]?.level).toBe('info');
    expect(entries[0]?.context?.path).toBe('/ping');
  });
});
