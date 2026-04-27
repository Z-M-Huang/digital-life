import type { MiddlewareHandler } from 'hono';

export type LogLevel = 'info' | 'warn' | 'error';

export type StructuredLogEntry = {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
};

export type StructuredLogger = {
  log: (level: LogLevel, message: string, context?: Record<string, unknown>) => void;
};

export const createStructuredLogger = (
  sink: (entry: StructuredLogEntry) => void = (entry) => console.log(JSON.stringify(entry)),
): StructuredLogger => ({
  log(level, message, context) {
    const entry: StructuredLogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      ...(context ? { context } : {}),
    };
    sink(entry);
  },
});

export const createRequestLogger =
  (logger: StructuredLogger): MiddlewareHandler =>
  async (context, next) => {
    const start = Date.now();
    await next();
    const duration = Date.now() - start;
    logger.log('info', 'http_request', {
      method: context.req.method,
      path: context.req.path,
      status: context.res.status,
      durationMs: duration,
    });
  };
