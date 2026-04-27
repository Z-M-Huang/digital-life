import { resolve } from 'node:path';

import { closeMcpConnectors } from '@digital-life/connectors';
import { loadConfig } from '@digital-life/core';
import { createRuntime } from '@digital-life/orchestrator';
import { serve } from '@hono/node-server';

import { createApp } from './create-app';

const defaultConfigPath = new URL('../../../config/digital-life.yaml', import.meta.url).pathname;
const configuredPort = Number(process.env.PORT ?? '3000');
const port = Number.isFinite(configuredPort) ? configuredPort : 3000;
const configPath = process.env.DIGITAL_LIFE_CONFIG_PATH
  ? resolve(process.cwd(), process.env.DIGITAL_LIFE_CONFIG_PATH)
  : defaultConfigPath;

const config = await loadConfig(configPath);
const runtime = await createRuntime({ config });
const parseRateLimit = (raw: string | undefined): { windowMs: number; max: number } | undefined => {
  if (!raw) {
    return undefined;
  }
  const [windowPart, maxPart] = raw.split(':');
  const windowMs = Number(windowPart);
  const max = Number(maxPart);
  if (!Number.isFinite(windowMs) || !Number.isFinite(max) || windowMs <= 0 || max <= 0) {
    return undefined;
  }
  return { windowMs, max };
};

const rateLimit = parseRateLimit(process.env.DIGITAL_LIFE_RATE_LIMIT);

const app = createApp(runtime, {
  ...(process.env.DIGITAL_LIFE_API_TOKEN ? { authToken: process.env.DIGITAL_LIFE_API_TOKEN } : {}),
  ...(process.env.DIGITAL_LIFE_CORS_ORIGIN
    ? { corsOrigin: process.env.DIGITAL_LIFE_CORS_ORIGIN }
    : {}),
  ...(rateLimit ? { rateLimit } : {}),
  enableRequestLogger: process.env.DIGITAL_LIFE_REQUEST_LOG !== '0',
});

const server = serve({
  fetch: app.fetch,
  port,
});

runtime.scheduler.start();

const shutdown = async (signal: NodeJS.Signals) => {
  console.log(`digital-life api received ${signal}, draining...`);
  runtime.scheduler.stop();
  try {
    await new Promise<void>((resolveClose, reject) =>
      server.close((error) => (error ? reject(error) : resolveClose())),
    );
  } finally {
    await closeMcpConnectors(runtime.connectors);
    process.exit(0);
  }
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

console.log(`digital-life api listening on http://localhost:${port}`);
