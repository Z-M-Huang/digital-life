import type { MiddlewareHandler } from 'hono';

export type RateLimitOptions = {
  windowMs: number;
  max: number;
  keyExtractor?: (request: Request) => string;
};

type Bucket = {
  count: number;
  resetAt: number;
};

const defaultKey = (request: Request): string =>
  request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? 'global';

export const createRateLimitMiddleware = ({
  windowMs,
  max,
  keyExtractor = defaultKey,
}: RateLimitOptions): MiddlewareHandler => {
  const buckets = new Map<string, Bucket>();
  return async (context, next) => {
    const key = keyExtractor(context.req.raw);
    const now = Date.now();
    const existing = buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (existing.count >= max) {
      const retryAfter = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      context.res.headers.set('retry-after', String(retryAfter));
      return context.json({ error: 'rate limited' }, 429);
    }
    existing.count += 1;
    return next();
  };
};
