import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createUnifiedToolRegistry } from '../src/registry/tool-registry';

describe('createUnifiedToolRegistry', () => {
  it('builds AI tools and invokes governed tools', async () => {
    const registry = await createUnifiedToolRegistry({
      accessResolver(definition, phase) {
        if (definition.id === 'demo.blocked' && phase === 'live') {
          return { enabled: false, reason: 'blocked' };
        }

        return { enabled: true };
      },
      connectors: [
        {
          id: 'demo',
          displayName: 'Demo',
          kind: 'builtin',
          async startupCheck() {
            return { ok: true, messages: [] };
          },
          async listTools() {
            return [
              {
                id: 'demo.lookup',
                description: 'Lookup item',
                capability: 'read',
                role: 'lookup',
                phases: ['bootstrap', 'live'],
                inputSchema: z.object({ id: z.string() }),
                outputSchema: z.object({ id: z.string() }),
                async execute(input) {
                  return input;
                },
              },
              {
                id: 'demo.blocked',
                description: 'Blocked item',
                capability: 'read',
                role: 'lookup',
                phases: ['live'],
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

    const aiTools = registry.aiToolsForPhase('live');
    expect(Object.keys(aiTools)).toEqual(['demo.lookup']);
    await expect(registry.invoke('demo.lookup', { id: 'repo-1' }, 'live')).resolves.toEqual({
      id: 'repo-1',
    });
    await expect(registry.invoke('demo.blocked', {}, 'live')).rejects.toThrow('blocked');
  });
});
