import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createDemoConnector } from '../src/builtin/demo-connector';
import { createUnavailableMcpBridgeFactory, mcpDescriptorToSourceTool } from '../src/mcp/bridge';
import { createMcpConnector } from '../src/mcp/mcp-connector';
import { createUnifiedToolRegistry } from '../src/registry/tool-registry';

describe('connector runtime behavior', () => {
  it('executes demo connector tools and maps scope options', async () => {
    const connector = createDemoConnector({
      connectorId: 'demo',
      config: {
        repositories: [{ id: 'repo-1', label: 'digital-life' }],
        inboxWindows: [{ id: 'inbox-7d', label: 'Last 7 days' }],
      },
    });

    const startup = await connector.startupCheck();
    const tools = await connector.listTools();
    const repositories = await tools[0]?.execute({}, { connectorId: 'demo', phase: 'bootstrap' });
    const facts = await tools[2]?.execute(
      { repositoryId: 'repo-1' },
      { connectorId: 'demo', phase: 'learning' },
    );
    const scopeOptions = connector.scopeDiscovery?.mapResult(tools[0]?.id ?? '', repositories);

    expect(startup.ok).toBe(true);
    expect(scopeOptions?.[0]?.metadata?.kind).toBe('repository');
    expect(facts).toEqual({
      id: 'repo-1',
      label: 'digital-life',
      facts: [
        'digital-life is tracked by digital-life.',
        'digital-life can be used as a baseline learning source.',
      ],
    });

    await expect(
      tools[2]?.execute({ repositoryId: 'missing' }, { connectorId: 'demo', phase: 'learning' }),
    ).rejects.toThrow('Unknown repository');
  });

  it('exposes the unavailable MCP bridge behavior explicitly', async () => {
    const registration = {
      kind: 'mcp' as const,
      enabled: true,
      transport: {
        type: 'process' as const,
        command: 'bunx',
        args: ['server'],
        env: {},
      },
      headers: {},
      hardDeny: [],
    };
    const bridge = await createUnavailableMcpBridgeFactory()('filesystem', registration);
    const connector = await createMcpConnector({
      connectorId: 'filesystem',
      registration,
      bridgeFactory: createUnavailableMcpBridgeFactory(),
    });
    const startup = await connector.startupCheck();
    const descriptorTool = mcpDescriptorToSourceTool({
      connectorId: 'filesystem',
      descriptor: {
        name: 'search',
        description: 'Search files',
      },
      invoke: async (toolName, input) => ({ toolName, input }),
    });

    expect(startup.ok).toBe(false);
    await expect(bridge.callTool('search', {})).rejects.toThrow('not configured');
    await expect(bridge.listTools()).resolves.toEqual([]);
    await expect(
      descriptorTool.execute({ query: 'docs' }, { connectorId: 'filesystem', phase: 'live' }),
    ).resolves.toEqual({
      toolName: 'search',
      input: { query: 'docs' },
    });
  });

  it('reports unknown tools and exposes AI-tool access filtering', async () => {
    const registry = await createUnifiedToolRegistry({
      accessResolver(definition) {
        return definition.id === 'demo.blocked'
          ? { enabled: false, reason: 'blocked' }
          : { enabled: true };
      },
      connectors: [
        createDemoConnector({
          connectorId: 'demo',
          config: {
            repositories: [{ id: 'repo-1', label: 'digital-life' }],
            inboxWindows: [],
          },
        }),
        {
          id: 'shadow',
          displayName: 'Shadow',
          kind: 'extension',
          async startupCheck() {
            return { ok: true, messages: [] };
          },
          async listTools() {
            return [
              {
                id: 'demo.blocked',
                description: 'Blocked tool',
                capability: 'read' as const,
                role: 'lookup' as const,
                phases: ['live'] as const,
                inputSchema: z.object({}),
                outputSchema: z.object({ ok: z.boolean() }),
                async execute() {
                  return { ok: true };
                },
              },
            ];
          },
        },
      ],
    });

    expect(registry.getTool('demo.fetchRepository')?.id).toBe('demo.fetchRepository');
    expect(Object.keys(registry.aiToolsForPhase('live'))).toContain('demo.fetchRepository');
    expect(Object.keys(registry.aiToolsForPhase('live'))).not.toContain('demo.blocked');
    await expect(registry.invoke('missing.tool', {}, 'live')).rejects.toThrow('Unknown tool');
  });
});
