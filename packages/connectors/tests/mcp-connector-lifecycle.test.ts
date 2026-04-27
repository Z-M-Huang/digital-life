import { describe, expect, it, vi } from 'vitest';

import { scopeDiscoveryFromConfig } from '../src/mcp/adapters/types';
import {
  closeMcpConnector,
  closeMcpConnectors,
  createMcpConnector,
  loadMcpConnectors,
} from '../src/mcp/mcp-connector';

describe('MCP connector helpers', () => {
  it('builds scope discovery manifests from MCP config', () => {
    expect(
      scopeDiscoveryFromConfig(
        'filesystem',
        {
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
        () => [],
      ),
    ).toBeUndefined();

    const manifest = scopeDiscoveryFromConfig(
      'filesystem',
      {
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
        scopeDiscovery: {
          selectionKind: 'mcp-scope',
          toolIds: ['search', 'read'],
        },
      },
      () => [{ id: 'repo-1', label: 'digital-life' }],
    );

    expect(manifest?.toolIds).toEqual(['filesystem.search', 'filesystem.read']);
    expect(manifest?.mapResult('filesystem.search', {})).toEqual([
      { id: 'repo-1', label: 'digital-life' },
    ]);
  });

  it('closes registered MCP bridges and ignores non-MCP connectors', async () => {
    const close = vi.fn(async () => undefined);
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
        close,
        async startupCheck() {
          return { ok: true, messages: [] };
        },
        async callTool() {
          return {};
        },
        async listTools() {
          return [];
        },
      }),
    });

    await closeMcpConnector(connector);
    await closeMcpConnector(connector);
    await closeMcpConnectors([
      connector,
      {
        id: 'demo',
        displayName: 'Demo',
        kind: 'builtin',
        async startupCheck() {
          return { ok: true, messages: [] };
        },
        async listTools() {
          return [];
        },
      },
    ]);

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('loads only enabled MCP registrations from mixed connector config', async () => {
    const bridgeFactory = vi.fn(async (connectorId: string) => ({
      async close() {
        return undefined;
      },
      async startupCheck() {
        return { ok: true, messages: [{ level: 'info' as const, message: connectorId }] };
      },
      async callTool() {
        return {};
      },
      async listTools() {
        return [];
      },
    }));

    const connectors = await loadMcpConnectors({
      bridgeFactory,
      connectors: {
        builtin: {
          kind: 'builtin',
          enabled: true,
          source: 'demo',
          config: {},
          headers: {},
          hardDeny: [],
        },
        disabledMcp: {
          kind: 'mcp',
          enabled: false,
          transport: {
            type: 'process',
            command: 'bunx',
            args: ['disabled'],
            env: {},
          },
          headers: {},
          hardDeny: [],
        },
        enabledMcp: {
          kind: 'mcp',
          enabled: true,
          transport: {
            type: 'process',
            command: 'bunx',
            args: ['enabled'],
            env: {},
          },
          headers: {},
          hardDeny: [],
        },
      },
    });

    expect(connectors).toHaveLength(1);
    expect(connectors[0]?.id).toBe('enabledMcp');
    expect(bridgeFactory).toHaveBeenCalledTimes(1);
  });
});
