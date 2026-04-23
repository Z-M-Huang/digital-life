import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  ConnectorSummary,
  LearningRunSummary,
  ReflectionItem,
  ScopeSelection,
  ToolSummary,
} from '../src/app/use-dashboard';
import { useDashboardData } from '../src/app/use-dashboard';

type HookState = ReturnType<typeof createHookState>;

const createHookState = () => ({
  bootstrap: {
    baselineRunId: 'run-1',
    manualContext: [] as Array<Record<string, unknown>>,
    persona: { name: 'Digital Life' } as Record<string, unknown>,
    recommendedConnectors: ['demo'],
    status: 'complete',
  },
  connectors: [
    {
      displayName: 'Demo Connector',
      id: 'demo',
      kind: 'builtin',
      scope: [{ id: 'repo-1', label: 'digital-life', metadata: { kind: 'repository' } }],
      scopeCount: 1,
      scopeOptions: [
        { id: 'repo-1', label: 'digital-life', metadata: { kind: 'repository' } },
        { id: 'repo-2', label: 'infra', metadata: { kind: 'repository' } },
      ],
      toolCount: 2,
    },
  ] as ConnectorSummary[],
  dashboard: {
    connectors: 1,
    latestRunId: 'run-1',
    readiness: {
      blockers: [],
      score: 90,
      status: 'ready',
      warnings: [],
    },
    scopedConnectors: 1,
    tools: 2,
  },
  learningLogs: {
    'run-1': [
      {
        createdAt: '2026-04-23T00:00:00.000Z',
        payload: { status: 'done' },
        runId: 'run-1',
        type: 'done',
      },
    ],
  } as Record<string, Array<Record<string, unknown>>>,
  learningRuns: [
    {
      connectorIds: ['demo'],
      createdAt: '2026-04-23T00:00:00.000Z',
      details: { totals: { fragmentsWritten: 2 } },
      id: 'run-1',
      mode: 'baseline',
      status: 'completed',
      updatedAt: '2026-04-23T00:00:00.000Z',
    },
  ] as LearningRunSummary[],
  nextRunId: 2,
  reflection: [] as ReflectionItem[],
  startupLogs: [{ connectorId: 'demo', level: 'info', message: 'Connector ready' }],
  tools: [
    {
      capability: 'read',
      learningEnabled: true,
      liveEnabled: true,
      maintenanceEnabled: false,
      phases: ['bootstrap', 'learning', 'live'],
      role: 'list',
      toolId: 'demo.listRepositories',
    },
    {
      capability: 'write',
      learningEnabled: false,
      liveEnabled: false,
      maintenanceEnabled: false,
      phases: ['live', 'maintenance'],
      role: 'action',
      toolId: 'writer.send',
    },
  ] as ToolSummary[],
});

const createHookFetchMock = (state: HookState) =>
  vi.fn(async (input: string, init?: RequestInit) => {
    const url = input;
    const method = init?.method ?? 'GET';
    const connector = state.connectors[0];
    if (!connector) {
      throw new Error('Missing demo connector');
    }

    if (url.endsWith('/api/dashboard')) {
      return new Response(JSON.stringify(state.dashboard));
    }
    if (url.endsWith('/api/connectors')) {
      return new Response(
        JSON.stringify(
          state.connectors.map(({ displayName, id, kind, scopeCount, toolCount }) => ({
            displayName,
            id,
            kind,
            scopeCount,
            toolCount,
          })),
        ),
      );
    }
    if (url.endsWith('/api/connectors/demo/scope')) {
      if (method === 'PUT') {
        const scope = JSON.parse(String(init?.body)) as ScopeSelection[];
        connector.scope = scope;
        connector.scopeCount = scope.length;
        return new Response(JSON.stringify({ ok: true }));
      }

      return new Response(JSON.stringify(connector.scope));
    }
    if (url.endsWith('/api/connectors/demo/scope-options')) {
      return new Response(JSON.stringify(connector.scopeOptions));
    }
    if (url.endsWith('/api/tools')) {
      return new Response(JSON.stringify(state.tools));
    }
    if (url.includes('/api/tools/writer.send/policy')) {
      const payload = JSON.parse(String(init?.body)) as {
        enabled: boolean;
        phase: 'learning' | 'live' | 'maintenance';
        reason?: string;
      };
      if (payload.phase === 'live' && payload.enabled && !payload.reason) {
        return new Response(JSON.stringify({ error: 'operator reason required' }), {
          status: 400,
          statusText: 'Bad Request',
        });
      }

      state.tools = state.tools.map((tool) =>
        tool.toolId === 'writer.send'
          ? {
              ...tool,
              liveEnabled: payload.phase === 'live' ? payload.enabled : tool.liveEnabled,
              maintenanceEnabled:
                payload.phase === 'maintenance' ? payload.enabled : tool.maintenanceEnabled,
            }
          : tool,
      );

      return new Response(JSON.stringify({ enabled: payload.enabled }));
    }
    if (url.endsWith('/api/bootstrap')) {
      return new Response(JSON.stringify(state.bootstrap));
    }
    if (url.endsWith('/api/bootstrap/persona')) {
      const payload = JSON.parse(String(init?.body)) as { name: string };
      state.bootstrap.persona = { name: payload.name };
      return new Response(JSON.stringify(state.bootstrap));
    }
    if (url.endsWith('/api/bootstrap/manual-context')) {
      const payload = JSON.parse(String(init?.body)) as Array<Record<string, unknown>>;
      state.bootstrap.manualContext = [...state.bootstrap.manualContext, ...payload];
      return new Response(JSON.stringify(state.bootstrap));
    }
    if (url.endsWith('/api/bootstrap/start')) {
      const runId = `run-${state.nextRunId++}`;
      state.bootstrap.baselineRunId = runId;
      state.dashboard.latestRunId = runId;
      return new Response(JSON.stringify({ bootstrap: state.bootstrap, runId }));
    }
    if (url.endsWith('/api/startup/logs')) {
      return new Response(JSON.stringify(state.startupLogs));
    }
    if (url.endsWith('/api/startup/validate')) {
      return new Response(JSON.stringify({ ok: true }));
    }
    if (url.endsWith('/api/reflection')) {
      return new Response(JSON.stringify(state.reflection));
    }
    if (url.endsWith('/api/reflection/recompute')) {
      state.reflection = [
        {
          category: 'maintenance',
          connectorId: null,
          detail: 'Maintenance gap',
          id: 'reflection-1',
          metadata: {},
          runId: null,
          severity: 'info',
          status: 'open',
          title: 'Maintenance run recommended',
        },
      ];
      return new Response(JSON.stringify(state.reflection));
    }
    if (url.endsWith('/api/learning/runs')) {
      if (method === 'POST') {
        const payload = JSON.parse(String(init?.body)) as {
          mode: 'baseline' | 'incremental' | 'resync';
        };
        const runId = `run-${state.nextRunId++}`;
        state.dashboard.latestRunId = runId;
        state.learningRuns.unshift({
          connectorIds: ['demo'],
          createdAt: '2026-04-23T00:00:00.000Z',
          details: {},
          id: runId,
          mode: payload.mode,
          status: 'completed',
          updatedAt: '2026-04-23T00:00:00.000Z',
        });
        state.learningLogs[runId] = [
          {
            createdAt: '2026-04-23T00:00:00.000Z',
            payload: { phase: payload.mode },
            runId,
            type: 'log',
          },
        ];
        return new Response(JSON.stringify(state.learningRuns[0]));
      }

      return new Response(JSON.stringify(state.learningRuns));
    }
    if (url.includes('/api/learning/runs/') && url.endsWith('/logs')) {
      const runId = url.split('/api/learning/runs/')[1]?.replace('/logs', '') ?? '';
      return new Response(JSON.stringify(state.learningLogs[runId] ?? []));
    }

    throw new Error(`Unhandled fetch: ${method} ${url}`);
  });

describe('useDashboardData', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('loads dashboard data and executes runtime mutations', async () => {
    const state = createHookState();
    globalThis.fetch = createHookFetchMock(state) as unknown as typeof fetch;

    const { result } = renderHook(() => useDashboardData());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data.connectors[0]?.scopeCount).toBe(1);

    act(() => {
      result.current.reload();
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.savePersona('Updated Persona');
    });
    await waitFor(() => expect(state.bootstrap.persona.name).toBe('Updated Persona'));

    await act(async () => {
      await result.current.addManualContext('New context');
    });
    await waitFor(() => expect(state.bootstrap.manualContext).toHaveLength(1));

    await act(async () => {
      await result.current.saveScope('demo', []);
    });
    await waitFor(() => expect(state.connectors[0]?.scopeCount).toBe(0));

    await act(async () => {
      await result.current.patchToolPolicy('writer.send', 'live', true, 'Approved');
    });
    await waitFor(() => expect(state.tools[1]?.liveEnabled).toBe(true));

    await act(async () => {
      await result.current.recomputeReflection();
    });
    await waitFor(() => expect(state.reflection[0]?.title).toBe('Maintenance run recommended'));

    let createdRunId = '';
    await act(async () => {
      const run = await result.current.createLearningRun('incremental');
      createdRunId = run.id;
    });
    await waitFor(() => expect(createdRunId).toBe('run-2'));

    const runLogs = await result.current.loadRunLogs('run-2');
    expect(runLogs).toHaveLength(1);

    await act(async () => {
      await result.current.startBaseline();
    });
    await waitFor(() => expect(state.bootstrap.baselineRunId).toBe('run-3'));

    await act(async () => {
      await result.current.validateStartup();
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it('surfaces initial load failures', async () => {
    globalThis.fetch = vi.fn(async (input: string) => {
      if (input.endsWith('/api/dashboard')) {
        throw new Error('Dashboard unavailable');
      }

      return new Response(JSON.stringify([]));
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useDashboardData());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Dashboard unavailable');
  });

  it('propagates mutation errors returned by the API', async () => {
    const state = createHookState();
    globalThis.fetch = createHookFetchMock(state) as unknown as typeof fetch;

    const { result } = renderHook(() => useDashboardData());

    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(result.current.patchToolPolicy('writer.send', 'live', true)).rejects.toThrow(
      'operator reason required',
    );
  });
});
