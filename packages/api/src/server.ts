import { resolve } from 'node:path';

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
const app = createApp(runtime);

serve({
  fetch: app.fetch,
  port,
});

console.log(`digital-life api listening on http://localhost:${port}`);
