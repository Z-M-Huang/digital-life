import type { MiddlewareHandler } from 'hono';

export type BearerAuthOptions = {
  token: string;
  exempt?: ReadonlyArray<string>;
};

const isExempt = (path: string, exempt: ReadonlyArray<string>): boolean => {
  for (const pattern of exempt) {
    if (pattern.endsWith('*')) {
      if (path.startsWith(pattern.slice(0, -1))) {
        return true;
      }
    } else if (pattern === path) {
      return true;
    }
  }
  return false;
};

const constantTimeEqual = (received: string, expected: string): boolean => {
  // Compare against `expected` byte-by-byte regardless of `received` length to
  // avoid leaking the expected length via timing. Any divergence (including
  // length mismatch) flips the accumulator.
  let result = received.length ^ expected.length;
  const length = Math.max(received.length, expected.length);
  for (let index = 0; index < length; index += 1) {
    const expectedCode = expected.charCodeAt(index) | 0;
    const receivedCode = index < received.length ? received.charCodeAt(index) : 0;
    result |= expectedCode ^ receivedCode;
  }
  return result === 0;
};

export const createBearerAuth = ({
  token,
  exempt = ['/health', '/ready'],
}: BearerAuthOptions): MiddlewareHandler => {
  if (!token) {
    throw new Error('createBearerAuth requires a non-empty token.');
  }
  return async (context, next) => {
    if (isExempt(context.req.path, exempt)) {
      return next();
    }
    const header = context.req.header('authorization') ?? '';
    const expected = `Bearer ${token}`;
    if (!constantTimeEqual(header, expected)) {
      return context.json({ error: 'unauthorized' }, 401);
    }
    return next();
  };
};
