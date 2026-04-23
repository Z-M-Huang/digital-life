import { describe, expect, it } from 'vitest';

import { loadBuiltinConnectors } from '../src/loaders/builtin-loader';
import { loadExtensionConnectors } from '../src/loaders/extension-loader';
import { createMcpConnector, loadMcpConnectors } from '../src/mcp/mcp-connector';

describe('connector loaders', () => {
  it('loads built-in connectors from config', async () => {
    const connectors = loadBuiltinConnectors({
      demo: {
        kind: 'builtin',
        enabled: true,
        source: 'demo',
        config: {
          repositories: [{ id: 'repo-1', label: 'digital-life' }],
          inboxWindows: [{ id: 'inbox-7d', label: 'Last 7 days' }],
        },
        headers: {},
        hardDeny: [],
      },
    });

    expect(connectors).toHaveLength(1);
    expect(connectors[0]?.id).toBe('demo');
    await expect(connectors[0]?.listTools()).resolves.toHaveLength(3);
  });

  it('loads extension connectors through jiti', async () => {
    const connectors = await loadExtensionConnectors({
      fixture: {
        kind: 'extension',
        enabled: true,
        exportName: 'default',
        path: new URL('./fixtures/extension-connector.ts', import.meta.url).pathname,
        config: {},
        headers: {},
        hardDeny: [],
      },
    });

    expect(connectors).toHaveLength(1);
    expect(connectors[0]?.kind).toBe('extension');
  });

  it('reports an extension export mismatch', async () => {
    await expect(
      loadExtensionConnectors({
        fixture: {
          kind: 'extension',
          enabled: true,
          exportName: 'missingExport',
          path: new URL('./fixtures/bad-extension.ts', import.meta.url).pathname,
          config: {},
          headers: {},
          hardDeny: [],
        },
      }),
    ).rejects.toThrow('Extension connector export must resolve to a connector');
  });

  it('validates extension connector config schema at load time', async () => {
    await expect(
      loadExtensionConnectors({
        fixture: {
          kind: 'extension',
          enabled: true,
          exportName: 'default',
          path: new URL('./fixtures/schema-extension-connector.ts', import.meta.url).pathname,
          config: {},
          headers: {},
          hardDeny: [],
        },
      }),
    ).rejects.toThrow('Invalid configuration for connector fixture');
  });

  it('loads MCP connectors through the bridge abstraction', async () => {
    const connector = await createMcpConnector({
      connectorId: 'filesystem',
      registration: {
        kind: 'mcp',
        enabled: true,
        transport: {
          type: 'process',
          command: 'bunx',
          args: ['server'],
          env: {},
        },
        headers: {},
        hardDeny: [],
      },
      bridgeFactory: async () => ({
        async close() {
          return undefined;
        },
        async startupCheck() {
          return { ok: true, messages: [{ level: 'info', message: 'connected' }] };
        },
        async callTool(toolName) {
          return { toolName };
        },
        async listTools() {
          return [{ name: 'search', description: 'Search files' }];
        },
      }),
    });

    const tools = await connector.listTools();

    expect(connector.kind).toBe('mcp');
    expect(tools[0]?.id).toBe('filesystem.search');
  });

  it('returns an empty MCP list when all MCP connectors are disabled', async () => {
    await expect(
      loadMcpConnectors({
        connectors: {
          filesystem: {
            kind: 'mcp',
            enabled: false,
            transport: {
              type: 'process',
              command: 'bunx',
              args: ['server'],
              env: {},
            },
            headers: {},
            hardDeny: [],
          },
        },
      }),
    ).resolves.toEqual([]);
  });

  it('throws when a builtin source is unknown', () => {
    expect(() =>
      loadBuiltinConnectors({
        unknown: {
          kind: 'builtin',
          enabled: true,
          source: 'missing',
          config: {},
          headers: {},
          hardDeny: [],
        },
      }),
    ).toThrow('Unknown builtin connector source');
  });
});
