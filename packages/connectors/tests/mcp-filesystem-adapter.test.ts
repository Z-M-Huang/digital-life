import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { SourceToolConnector, SourceToolDefinition } from '../src/contracts';
import { applyMcpManifests, filesystemAdapter } from '../src/mcp/adapters';

type ListExecutor = SourceToolDefinition['execute'];
type ReadExecutor = SourceToolDefinition['execute'];

const baseConnector = ({
  listExecute,
  readExecute,
}: {
  listExecute?: ListExecutor;
  readExecute?: ReadExecutor;
} = {}): SourceToolConnector => ({
  id: 'fs',
  displayName: 'fs',
  kind: 'mcp',
  async startupCheck() {
    return { ok: true, messages: [] };
  },
  async listTools() {
    return [
      {
        id: 'fs.list_directory',
        description: 'list',
        capability: 'read',
        role: 'list',
        phases: ['learning', 'live'],
        inputSchema: z.object({ path: z.string() }),
        outputSchema: z.object({}),
        learningHints: { pagination: false, sinceWindow: false },
        execute: listExecute ?? (async () => []),
      },
      {
        id: 'fs.read_file',
        description: 'read',
        capability: 'read',
        role: 'fetch',
        phases: ['learning', 'live'],
        inputSchema: z.object({ path: z.string() }),
        outputSchema: z.object({}),
        learningHints: { pagination: false, sinceWindow: false },
        execute: readExecute ?? (async () => 'file body'),
      },
    ];
  },
});

const fsRegistration = (overrides: Record<string, unknown> = {}) => ({
  adapter: 'mcp-filesystem' as const,
  enabled: true,
  kind: 'mcp' as const,
  transport: {
    type: 'process' as const,
    command: 'noop',
    args: ['@modelcontextprotocol/server-filesystem', '/data/learning'],
    env: {},
  },
  headers: {},
  hardDeny: [],
  scopeDiscovery: {
    toolIds: ['list_directory'],
    selectionKind: 'mcp-scope',
  },
  learning: {
    enumerateToolIds: ['list_directory'],
    fetchToolIds: ['read_file'],
    defaultMode: 'baseline' as const,
    supportedModes: ['baseline', 'incremental', 'resync'] as Array<
      'baseline' | 'incremental' | 'resync'
    >,
  },
  ...overrides,
});

describe('filesystem MCP adapter', () => {
  it('maps [FILE] entries to scope items and ignores [DIR] entries', () => {
    const text = '[FILE] notes/a.json\n[FILE] notes/b.json\n[DIR] subfolder';
    const augmented = applyMcpManifests({
      connectorId: 'fs',
      baseConnector: baseConnector(),
      registration: fsRegistration(),
    });

    expect(augmented.learning?.enumerateToolIds).toEqual(['fs.list_directory']);
    expect(augmented.learning?.fetchToolIds).toEqual(['fs.read_file']);
    expect(augmented.scopeDiscovery?.toolIds).toEqual(['fs.list_directory']);

    const scopes = augmented.scopeDiscovery?.mapResult('fs.list_directory', text) ?? [];
    expect(scopes.map((scope) => scope.id)).toEqual(['notes/a.json', 'notes/b.json']);
    expect(scopes[0]?.label).toBe('a.json');
  });

  it('rejects path traversal candidates and absolute paths', () => {
    const augmented = applyMcpManifests({
      connectorId: 'fs',
      baseConnector: baseConnector(),
      registration: fsRegistration(),
    });
    const scopes =
      augmented.scopeDiscovery?.mapResult(
        'fs.list_directory',
        '[FILE] safe.json\n[FILE] ../escape.json\n[FILE] /abs/etc.json',
      ) ?? [];
    expect(scopes.map((scope) => scope.id)).toEqual(['safe.json']);
  });

  it('injects the configured root path when invoking list_directory', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const listExecute: ListExecutor = async (input) => {
      calls.push(input as Record<string, unknown>);
      return 'ok';
    };
    const augmented = applyMcpManifests({
      connectorId: 'fs',
      baseConnector: baseConnector({ listExecute }),
      registration: fsRegistration(),
    });
    const tools = await augmented.listTools();
    const listTool = tools.find((tool) => tool.id === 'fs.list_directory');
    if (!listTool) {
      throw new Error('list_directory tool missing');
    }
    await listTool.execute({}, { connectorId: 'fs', phase: 'learning' });
    expect(calls[0]).toEqual({ path: '/data/learning' });
  });

  it('joins root + scope id when invoking read_file and rejects escapes', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const readExecute: ReadExecutor = async (input) => {
      calls.push(input as Record<string, unknown>);
      return 'body';
    };
    const augmented = applyMcpManifests({
      connectorId: 'fs',
      baseConnector: baseConnector({ readExecute }),
      registration: fsRegistration(),
    });
    const tools = await augmented.listTools();
    const readTool = tools.find((tool) => tool.id === 'fs.read_file');
    if (!readTool) {
      throw new Error('read_file tool missing');
    }
    await readTool.execute({ id: 'notes/a.json' }, { connectorId: 'fs', phase: 'learning' });
    expect(calls[0]).toEqual({ path: '/data/learning/notes/a.json' });

    await expect(
      readTool.execute({ id: '../etc/passwd' }, { connectorId: 'fs', phase: 'learning' }),
    ).rejects.toThrow('rejected path outside root');
  });

  it('skips augmentation when scopeDiscovery is missing', () => {
    const augmented = filesystemAdapter.augment({
      baseConnector: baseConnector(),
      connectorId: 'fs',
      registration: fsRegistration({ scopeDiscovery: undefined }),
    });
    expect(augmented.scopeDiscovery).toBeUndefined();
  });
});
