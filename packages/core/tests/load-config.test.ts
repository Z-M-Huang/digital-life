import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  collectHardDeniedToolIds,
  loadConfig,
  loadConfigFromText,
} from '../src/config/load-config';

const yamlText = `
persona:
  id: primary
  displayName: Digital Life
ai:
  model: \${OPENAI_MODEL}
  temperature: 0.2
  promptOverrides:
    system: prompts/system.md
safety:
  defaults:
    read: allow
    write: deny
    execute: deny
  hardDeny:
    - global.blocked
denseMem:
  baseUrl: \${DENSE_MEM_URL}
  namespace: digital-life
  timeoutMs: 5000
connectors:
  demo:
    kind: builtin
    enabled: true
    source: demo
    hardDeny:
      - demo.blocked
    config: {}
`;

describe('loadConfigFromText', () => {
  it('parses yaml and resolves environment variables', () => {
    const config = loadConfigFromText(yamlText, {
      DENSE_MEM_URL: 'http://localhost:8081',
      OPENAI_MODEL: 'gpt-test',
    });

    expect(config.ai.model).toBe('gpt-test');
    expect(config.denseMem.baseUrl).toBe('http://localhost:8081');
    expect(config.connectors.demo?.kind).toBe('builtin');
  });

  it('collects hard deny tool ids from root and connectors', () => {
    const config = loadConfigFromText(yamlText, {
      DENSE_MEM_URL: 'http://localhost:8081',
      OPENAI_MODEL: 'gpt-test',
    });

    const denied = collectHardDeniedToolIds(config);
    expect(denied.has('global.blocked')).toBe(true);
    expect(denied.has('demo.blocked')).toBe(true);
  });

  it('throws when an environment variable is missing', () => {
    expect(() =>
      loadConfigFromText(yamlText, {
        OPENAI_MODEL: 'gpt-test',
      }),
    ).toThrow('Missing environment variable: DENSE_MEM_URL');
  });

  it('resolves prompt overrides and connector paths relative to the config file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'digital-life-config-'));
    await mkdir(join(root, 'prompts'));
    await mkdir(join(root, 'connectors'));
    await mkdir(join(root, 'mcp'));
    await writeFile(join(root, 'prompts/system.md'), 'system prompt');
    await writeFile(join(root, 'connectors/custom.ts'), 'export default { ok: true };');
    await writeFile(join(root, 'server.js'), 'console.log("ok");');
    await writeFile(
      join(root, 'digital-life.yaml'),
      `
persona:
  id: primary
  displayName: Digital Life
ai:
  model: \${OPENAI_MODEL}
  promptOverrides:
    system: prompts/system.md
safety:
  defaults:
    read: allow
    write: deny
    execute: deny
denseMem:
  baseUrl: \${DENSE_MEM_URL}
  namespace: digital-life
connectors:
  custom:
    kind: extension
    enabled: true
    path: connectors/custom.ts
    config: {}
    headers: {}
    hardDeny: []
  filesystem:
    kind: mcp
    enabled: true
    transport:
      type: process
      command: ./server.js
      cwd: mcp
      env: {}
    headers: {}
    hardDeny: []
`,
    );

    const config = await loadConfig(join(root, 'digital-life.yaml'), {
      DENSE_MEM_URL: 'http://localhost:8081',
      OPENAI_MODEL: 'gpt-test',
    });

    expect(config.ai.promptOverrides.system).toBe(join(root, 'prompts/system.md'));
    const customConnector = config.connectors.custom;
    const filesystemConnector = config.connectors.filesystem;

    expect(customConnector?.kind).toBe('extension');
    expect(filesystemConnector?.kind).toBe('mcp');
    if (customConnector?.kind !== 'extension' || filesystemConnector?.kind !== 'mcp') {
      throw new Error('Expected extension and MCP connectors.');
    }

    expect(customConnector.path).toBe(join(root, 'connectors/custom.ts'));
    expect(filesystemConnector.transport.type).toBe('process');
    if (filesystemConnector.transport.type !== 'process') {
      throw new Error('Expected process transport.');
    }

    expect(filesystemConnector.transport.command).toBe(join(root, 'server.js'));
    expect(filesystemConnector.transport.cwd).toBe(join(root, 'mcp'));
  });

  it('fails when a prompt override file is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'digital-life-missing-prompt-'));
    await writeFile(
      join(root, 'digital-life.yaml'),
      `
persona:
  id: primary
  displayName: Digital Life
ai:
  model: \${OPENAI_MODEL}
  promptOverrides:
    system: prompts/missing.md
safety:
  defaults:
    read: allow
    write: deny
    execute: deny
denseMem:
  baseUrl: \${DENSE_MEM_URL}
  namespace: digital-life
connectors: {}
`,
    );

    await expect(
      loadConfig(join(root, 'digital-life.yaml'), {
        DENSE_MEM_URL: 'http://localhost:8081',
        OPENAI_MODEL: 'gpt-test',
      }),
    ).rejects.toThrow('Prompt override "system" could not be loaded');
  });
});
