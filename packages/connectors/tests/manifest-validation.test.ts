import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { validateConnectorManifest } from '../src/registry/tool-registry';

describe('validateConnectorManifest', () => {
  it('accepts manifests that reference declared tools', async () => {
    const connector = {
      id: 'demo',
      displayName: 'Demo',
      kind: 'builtin' as const,
      scopeDiscovery: {
        toolIds: ['demo.scope'],
        mapResult: () => [],
      },
      learning: {
        enumerateToolIds: ['demo.scope'],
        fetchToolIds: ['demo.fetch'],
        defaultMode: 'baseline' as const,
        supportedModes: ['baseline', 'incremental', 'resync'] as const,
      },
      async startupCheck() {
        return { ok: true, messages: [] };
      },
      async listTools() {
        return [
          {
            id: 'demo.scope',
            description: 'scope',
            capability: 'read' as const,
            role: 'discover' as const,
            phases: ['bootstrap'] as const,
            inputSchema: z.object({}),
            outputSchema: z.object({}),
            async execute() {
              return {};
            },
          },
          {
            id: 'demo.fetch',
            description: 'fetch',
            capability: 'read' as const,
            role: 'fetch' as const,
            phases: ['learning'] as const,
            inputSchema: z.object({}),
            outputSchema: z.object({}),
            async execute() {
              return {};
            },
          },
        ];
      },
    };

    await expect(validateConnectorManifest(connector)).resolves.toEqual({
      ok: true,
      errors: [],
    });
  });

  it('reports missing manifest tools', async () => {
    const connector = {
      id: 'demo',
      displayName: 'Demo',
      kind: 'builtin' as const,
      scopeDiscovery: {
        toolIds: ['demo.missing'],
        mapResult: () => [],
      },
      async startupCheck() {
        return { ok: true, messages: [] };
      },
      async listTools() {
        return [
          {
            id: 'demo.scope',
            description: 'scope',
            capability: 'read' as const,
            role: 'discover' as const,
            phases: ['bootstrap'] as const,
            inputSchema: z.object({}),
            outputSchema: z.object({}),
            async execute() {
              return {};
            },
          },
        ];
      },
    };

    const result = await validateConnectorManifest(connector);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('demo.missing');
  });
});
