import type { MiddlewareHandler } from 'hono';

export type CorsOptions = {
  origin?: string | ReadonlyArray<string>;
  allowHeaders?: string[];
  allowMethods?: string[];
};

const matchOrigin = (origin: string, allowed: string | ReadonlyArray<string>): boolean => {
  if (allowed === '*' || allowed === origin) {
    return true;
  }
  if (Array.isArray(allowed)) {
    return allowed.includes(origin);
  }
  return false;
};

export const createCorsMiddleware = (options: CorsOptions = {}): MiddlewareHandler => {
  const allowOrigin = options.origin ?? '*';
  const allowHeaders = options.allowHeaders ?? ['authorization', 'content-type'];
  const allowMethods = options.allowMethods ?? ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

  return async (context, next) => {
    const requestOrigin = context.req.header('origin') ?? '';
    if (allowOrigin === '*') {
      context.res.headers.set('access-control-allow-origin', '*');
    } else if (matchOrigin(requestOrigin, allowOrigin)) {
      context.res.headers.set('access-control-allow-origin', requestOrigin);
      context.res.headers.set('vary', 'Origin');
    }
    context.res.headers.set('access-control-allow-headers', allowHeaders.join(', '));
    context.res.headers.set('access-control-allow-methods', allowMethods.join(', '));

    if (context.req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: context.res.headers });
    }
    return next();
  };
};
