import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/app/App';
import type {
  ConnectorSummary,
  LearningRunSummary,
  ReflectionItem,
  ToolSummary,
} from '../src/app/use-dashboard';

type MockState = ReturnType<typeof createMockState>;

const getTableRow = (label: string) => {
  const row = screen.getByText(label).closest('tr');
  if (!row) {
    throw new Error(`${label} row not found`);
  }

  return row;
};

const createMockState = () => ({
  bootstrap: {
    baselineRunId: 'run-1',
    manualContext: [{ source: 'operator', text: 'Track repositories.' }] as Array<
      Record<string, unknown>
    >,
    persona: { name: 'Digital Life' } as Record<string, unknown>,
    recommendedConnectors: ['demo'],
    status: 'complete',
  },
  chatResponse: {
    answer:
      'Grounded answer for "What is the baseline source?": Fact: digital-life can be used as a baseline learning source',
    clarificationRequest: null,
    conversation: {
      id: 'conversation-1',
      messages: [
        {
          content: 'What is the baseline source?',
          evidenceFactIds: [],
          id: 'message-1',
          role: 'user',
        },
        {
          content:
            'Grounded answer for "What is the baseline source?": Fact: digital-life can be used as a baseline learning source',
          evidenceFactIds: ['fact-1'],
          id: 'message-2',
          role: 'assistant',
        },
      ],
    },
    evidence: [
      {
        content: 'Fact: digital-life can be used as a baseline learning source',
        id: 'fact-1',
        kind: 'factual',
      },
    ],
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
      score: 80,
      status: 'partial',
      warnings: ['Maintenance run recommended'],
    },
    scopedConnectors: 1,
    tools: 2,
  },
  knowledge: [
    {
      content: 'Fact: digital-life can be used as a baseline learning source',
      id: 'fact-1',
      kind: 'factual',
      score: 8,
      sourceCount: 1,
    },
  ],
  learningLogs: {
    'run-1': [
      {
        createdAt: '2026-04-23T00:00:00.000Z',
        payload: { status: 'completed' },
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
  reflection: [
    {
      category: 'scope',
      connectorId: 'demo',
      detail: 'Connector Demo has no selected scope.',
      id: 'reflection-1',
      metadata: {},
      runId: null,
      severity: 'warning',
      status: 'open',
      title: 'Missing connector scope',
    },
  ] as ReflectionItem[],
  startupLogs: [{ connectorId: 'demo', level: 'info', message: 'Connector loaded' }],
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

const createFetchMock = (state: MockState) =>
  vi.fn(async (input: string, init?: RequestInit) => {
    const url = input;
    const method = init?.method ?? 'GET';
    const demoConnector = state.connectors[0];
    if (!demoConnector) {
      throw new Error('Demo connector not found');
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

    if (url.endsWith('/api/connectors/demo/scope-options')) {
      return new Response(JSON.stringify(demoConnector.scopeOptions));
    }

    if (url.endsWith('/api/connectors/demo/scope')) {
      if (method === 'PUT') {
        const nextScope = JSON.parse(String(init?.body)) as ConnectorSummary['scope'];
        demoConnector.scope = nextScope;
        demoConnector.scopeCount = nextScope.length;
        state.dashboard.scopedConnectors = nextScope.length > 0 ? 1 : 0;
        return new Response(JSON.stringify({ ok: true }));
      }

      return new Response(JSON.stringify(demoConnector.scope));
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
        return new Response(
          JSON.stringify({ error: 'Live write or execute tools require an operator reason.' }),
          { status: 400 },
        );
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
      state.learningRuns.unshift({
        connectorIds: ['demo'],
        createdAt: '2026-04-23T00:00:00.000Z',
        details: { totals: { fragmentsWritten: 2 } },
        id: runId,
        mode: 'baseline',
        status: 'completed',
        updatedAt: '2026-04-23T00:00:00.000Z',
      });
      state.learningLogs[runId] = [
        {
          createdAt: '2026-04-23T00:00:00.000Z',
          payload: { status: 'completed' },
          runId,
          type: 'done',
        },
      ];
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
      if (!state.reflection.find((item) => item.id === 'reflection-2')) {
        state.reflection.push({
          category: 'maintenance',
          connectorId: null,
          detail: 'No incremental or resync maintenance run has been executed yet.',
          id: 'reflection-2',
          metadata: {},
          runId: null,
          severity: 'info',
          status: 'open',
          title: 'Maintenance run recommended',
        });
      }

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
          details: { totals: { fragmentsWritten: 1 } },
          id: runId,
          mode: payload.mode,
          status: 'completed',
          updatedAt: '2026-04-23T00:00:00.000Z',
        });
        state.learningLogs[runId] = [
          {
            createdAt: '2026-04-23T00:00:00.000Z',
            payload: { phase: 'running' },
            runId,
            type: 'phase',
          },
          {
            createdAt: '2026-04-23T00:00:00.000Z',
            payload: { status: 'completed' },
            runId,
            type: 'done',
          },
        ];
        const latestRun = state.learningRuns[0];
        if (!latestRun) {
          throw new Error('Latest learning run not found');
        }

        return new Response(JSON.stringify(latestRun));
      }

      return new Response(JSON.stringify(state.learningRuns));
    }

    if (url.includes('/api/learning/runs/') && url.endsWith('/logs')) {
      const runId = url.split('/api/learning/runs/')[1]?.replace('/logs', '') ?? '';
      return new Response(JSON.stringify(state.learningLogs[runId] ?? []));
    }

    if (url.includes('/api/knowledge/search')) {
      return new Response(JSON.stringify(state.knowledge));
    }

    if (url.endsWith('/api/chat/query')) {
      const accept = String((init?.headers as Record<string, string> | undefined)?.accept ?? '');
      if (accept.includes('text/event-stream')) {
        const evidenceLines = state.chatResponse.evidence
          .map((entry) => `event: evidence\ndata: ${JSON.stringify(entry)}\n\n`)
          .join('');
        const answer = state.chatResponse.answer;
        const deltaLine =
          answer && answer.length > 0
            ? `event: text_delta\ndata: ${JSON.stringify({ delta: answer })}\n\n`
            : '';
        const clarificationLine = state.chatResponse.clarificationRequest
          ? `event: clarification_request\ndata: ${JSON.stringify({ message: state.chatResponse.clarificationRequest })}\n\n`
          : '';
        const doneLine = `event: done\ndata: ${JSON.stringify({
          answer: answer ?? '',
          clarificationRequest: state.chatResponse.clarificationRequest ?? null,
          conversationId: state.chatResponse.conversation.id,
          evidenceCount: state.chatResponse.evidence.length,
          mode: state.chatResponse.clarificationRequest ? 'clarification' : 'grounded',
        })}\n\n`;
        const body = `${evidenceLines}${deltaLine}${clarificationLine}${doneLine}`;
        return new Response(body, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      }
      return new Response(JSON.stringify(state.chatResponse));
    }

    return Promise.reject(new Error(`Unhandled fetch: ${method} ${url}`));
  });

describe('App', () => {
  let fetchMock: ReturnType<typeof createFetchMock>;
  let originalFetch: typeof fetch;
  let state: MockState;

  beforeEach(() => {
    state = createMockState();
    fetchMock = createFetchMock(state);
    originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('renders the operator dashboard surfaces with fetched data', async () => {
    render(<App />);

    await waitFor(() => expect(screen.getByText(/PARTIAL 80%/i)).toBeInTheDocument());

    expect(screen.getByText('Persona and Baseline')).toBeInTheDocument();
    expect(screen.getByText('Startup Checks')).toBeInTheDocument();
    expect(screen.getByText('Scope and Inventory')).toBeInTheDocument();
    expect(screen.getByText('Runtime Policy')).toBeInTheDocument();
    expect(screen.getByText('Maintenance Runs')).toBeInTheDocument();
    expect(screen.getByText('Open Gaps')).toBeInTheDocument();
    expect(screen.getByText('Demo Connector')).toBeInTheDocument();
    expect(screen.getByText('writer.send')).toBeInTheDocument();
    expect(screen.getByText(/Missing connector scope/)).toBeInTheDocument();
    expect(screen.getByText(/baseline learning source/i)).toBeInTheDocument();
  });

  it('updates scope, governed tool policy, maintenance runs, and reflection controls', async () => {
    render(<App />);

    await waitFor(() => expect(screen.getByText('Demo Connector')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('infra'));
    fireEvent.click(screen.getByRole('button', { name: 'Save scope' }));

    await waitFor(() => expect(screen.getByText(/2 selected/)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('writer.send reason'), {
      target: { value: 'Operator approved for live testing' },
    });

    const enableButton = within(getTableRow('writer.send'))
      .getAllByRole('button', { name: 'Enable' })
      .at(0);
    if (!enableButton) {
      throw new Error('writer.send enable button not found');
    }

    fireEvent.click(enableButton);
    await waitFor(() =>
      expect(
        within(getTableRow('writer.send')).getByRole('button', { name: 'Disable' }),
      ).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Run incremental' }));
    await waitFor(() => expect(screen.getByText('Selected run: run-2')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Recompute reflection' }));
    await waitFor(() =>
      expect(screen.getByText(/Maintenance run recommended/)).toBeInTheDocument(),
    );
  });

  it('submits a grounded chat query and renders evidence inline', async () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText('Chat query'), {
      target: { value: 'What is the baseline source?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() =>
      expect(
        screen.getByText(/Grounded answer for "What is the baseline source\?"/),
      ).toBeInTheDocument(),
    );

    expect(screen.getByText('Evidence (1)')).toBeInTheDocument();
  });

  it('shows an explicit error banner when the dashboard fetch fails', async () => {
    fetchMock.mockImplementation((input: string) => {
      if (input.endsWith('/api/dashboard')) {
        return Promise.reject(new Error('Network down'));
      }

      return Promise.resolve(new Response(JSON.stringify([])));
    });

    render(<App />);

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Dashboard load failed'),
    );
  });
});
