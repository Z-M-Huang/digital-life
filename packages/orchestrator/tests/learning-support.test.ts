import { describe, expect, it } from 'vitest';

import {
  buildFetchInput,
  deriveScopeSelections,
  resultToLearningMaterials,
} from '../src/services/learning-support';

describe('learning support helpers', () => {
  it('derives scope selections from connector discovery, item envelopes, and arrays', () => {
    const connector = {
      id: 'demo',
      displayName: 'Demo',
      kind: 'builtin' as const,
      scopeDiscovery: {
        toolIds: ['demo.discovery'],
        mapResult: (_toolId: string, result: unknown) => [
          {
            id: (result as { repoId: string }).repoId,
            label: 'Repository',
            metadata: { kind: 'repository' },
          },
        ],
      },
      async startupCheck() {
        return { ok: true, messages: [] };
      },
      async listTools() {
        return [];
      },
    };
    const connectorWithoutDiscovery = {
      id: 'demo',
      displayName: 'Demo',
      kind: 'builtin' as const,
      async startupCheck() {
        return { ok: true, messages: [] };
      },
      async listTools() {
        return [];
      },
    };

    expect(
      deriveScopeSelections({
        connector,
        toolId: 'demo.discovery',
        result: { repoId: 'repo-1' },
      }),
    ).toEqual([{ id: 'repo-1', label: 'Repository', metadata: { kind: 'repository' } }]);

    expect(
      deriveScopeSelections({
        connector: connectorWithoutDiscovery,
        toolId: 'demo.list',
        result: {
          items: [{ id: 'repo-1', label: 'Repo One' }, { nope: true }],
        },
      }),
    ).toEqual([{ id: 'repo-1', label: 'Repo One', metadata: { kind: 'enumerated' } }]);

    expect(
      deriveScopeSelections({
        connector: connectorWithoutDiscovery,
        toolId: 'demo.array',
        result: [{ id: 'repo-2', label: 'Repo Two' }],
      }),
    ).toEqual([{ id: 'repo-2', label: 'Repo Two', metadata: { kind: 'enumerated' } }]);

    expect(
      deriveScopeSelections({
        connector: connectorWithoutDiscovery,
        toolId: 'demo.empty',
        result: 'not mappable',
      }),
    ).toEqual([]);
  });

  it('builds fetch inputs for different scope kinds and run modes', () => {
    expect(
      buildFetchInput({
        mode: 'baseline',
        selection: { id: 'repo-1', label: 'Repo', metadata: { kind: 'repository' } },
      }),
    ).toEqual({ repositoryId: 'repo-1' });

    expect(
      buildFetchInput({
        mode: 'baseline',
        selection: { id: 'project-1', label: 'Project', metadata: { kind: 'project' } },
      }),
    ).toEqual({ projectId: 'project-1' });

    expect(
      buildFetchInput({
        mode: 'baseline',
        selection: { id: 'space-1', label: 'Space', metadata: { kind: 'space' } },
      }),
    ).toEqual({ spaceId: 'space-1' });

    expect(
      buildFetchInput({
        mode: 'baseline',
        selection: { id: 'channel-1', label: 'Channel', metadata: { kind: 'channel' } },
      }),
    ).toEqual({ channelId: 'channel-1' });

    expect(
      buildFetchInput({
        mode: 'baseline',
        selection: { id: 'window-1', label: 'Window', metadata: { kind: 'inbox-window' } },
      }),
    ).toEqual({ windowId: 'window-1' });

    expect(
      buildFetchInput({
        mode: 'incremental',
        previousWindow: {
          runId: 'run-1',
          connectorId: 'demo',
          cursorKey: 'demo.fetch',
          cursorValue: 'cursor-1',
          windowStart: new Date('2026-01-01T00:00:00Z'),
          windowEnd: new Date('2026-01-02T00:00:00Z'),
          metadata: {},
        },
        selection: { id: 'fallback-1', label: 'Fallback' },
      }),
    ).toEqual({
      id: 'fallback-1',
      cursor: 'cursor-1',
      since: '2026-01-02T00:00:00.000Z',
    });

    expect(
      buildFetchInput({
        mode: 'resync',
        selection: { id: 'fallback-2', label: 'Fallback' },
      }),
    ).toEqual({
      id: 'fallback-2',
      resync: true,
    });
  });

  it('converts varied tool results into learning materials', () => {
    const selection = { id: 'repo-1', label: 'Repo', metadata: { kind: 'repository' } };

    expect(
      resultToLearningMaterials({
        connectorId: 'demo',
        mode: 'baseline',
        result: 'plain text',
        selection,
        toolId: 'demo.fetch',
      }),
    ).toHaveLength(1);

    expect(
      resultToLearningMaterials({
        connectorId: 'demo',
        mode: 'baseline',
        result: ['one', ['two']],
        selection,
        toolId: 'demo.fetch',
      }).map((item) => item.text),
    ).toEqual(['one', 'two']);

    expect(
      resultToLearningMaterials({
        connectorId: 'demo',
        mode: 'baseline',
        result: { facts: ['fact one', 'fact two'] },
        selection,
        toolId: 'demo.fetch',
      }).map((item) => item.text),
    ).toEqual(['fact one', 'fact two']);

    expect(
      resultToLearningMaterials({
        connectorId: 'demo',
        mode: 'baseline',
        result: { content: 'content body' },
        selection,
        toolId: 'demo.fetch',
      })[0]?.text,
    ).toBe('content body');

    expect(
      resultToLearningMaterials({
        connectorId: 'demo',
        mode: 'baseline',
        result: { id: 'repo-1', label: 'Repo', extra: 'meta' },
        selection,
        toolId: 'demo.fetch',
      })[0]?.text,
    ).toContain('Repo (repo-1)');

    expect(
      resultToLearningMaterials({
        connectorId: 'demo',
        mode: 'baseline',
        result: { anything: true },
        selection,
        toolId: 'demo.fetch',
      })[0]?.text,
    ).toContain('"anything":true');

    expect(
      resultToLearningMaterials({
        connectorId: 'demo',
        mode: 'baseline',
        result: null,
        selection,
        toolId: 'demo.fetch',
      }),
    ).toEqual([]);
  });
});
