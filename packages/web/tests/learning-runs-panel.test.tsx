import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LearningRunEvent } from '../src/app/use-dashboard';
import { LearningRunsPanel } from '../src/components/learning-runs-panel';

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  listeners = new Map<string, Array<(event: MessageEvent) => void>>();
  closed = false;

  constructor(public readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  close() {
    this.closed = true;
  }

  emit(type: string, data: string) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data } as MessageEvent);
    }
  }
}

const runs = [
  {
    connectorIds: ['demo'],
    createdAt: '2026-04-23T00:00:00.000Z',
    details: {},
    id: 'run-1',
    mode: 'baseline' as const,
    status: 'completed',
    updatedAt: '2026-04-23T00:00:00.000Z',
  },
  {
    connectorIds: [],
    createdAt: '2026-04-24T00:00:00.000Z',
    details: {},
    id: 'run-2',
    mode: 'incremental' as const,
    status: 'completed',
    updatedAt: '2026-04-24T00:00:00.000Z',
  },
];

describe('LearningRunsPanel', () => {
  const originalEventSource = globalThis.EventSource;

  beforeEach(() => {
    FakeEventSource.instances = [];
    Object.defineProperty(globalThis, 'EventSource', {
      configurable: true,
      value: FakeEventSource,
      writable: true,
    });
  });

  afterEach(() => {
    cleanup();
    if (originalEventSource) {
      Object.defineProperty(globalThis, 'EventSource', {
        configurable: true,
        value: originalEventSource,
        writable: true,
      });
    } else {
      Reflect.deleteProperty(globalThis, 'EventSource');
    }
    vi.restoreAllMocks();
  });

  it('loads logs, switches runs, and appends SSE updates', async () => {
    const onCreateRun = vi.fn(async () => ({ id: 'run-3' }));
    const onLoadRunLogs = vi.fn(async (runId: string) =>
      runId === 'run-1'
        ? [
            {
              runId,
              type: 'log' as const,
              payload: { status: 'queued' },
              createdAt: '2026-04-23T00:00:00.000Z',
            },
          ]
        : [
            {
              runId,
              type: 'progress' as const,
              payload: { phase: 'sync' },
              createdAt: '2026-04-24T00:00:00.000Z',
            },
          ],
    );

    render(
      <LearningRunsPanel
        latestRunId="run-1"
        onCreateRun={onCreateRun}
        onLoadRunLogs={onLoadRunLogs}
        runs={runs}
      />,
    );

    await waitFor(() => expect(onLoadRunLogs).toHaveBeenCalledWith('run-1'));
    expect(screen.getByText('Selected run: run-1')).toBeInTheDocument();
    expect(screen.getByText('status: queued')).toBeInTheDocument();
    expect(FakeEventSource.instances[0]?.url).toBe('/api/learning/runs/run-1/stream');

    fireEvent.click(screen.getByRole('button', { name: 'View logs' }));

    await waitFor(() => expect(onLoadRunLogs).toHaveBeenCalledWith('run-2'));
    expect(screen.getByText('Selected run: run-2')).toBeInTheDocument();
    expect(screen.getByText('all connectors · run-2')).toBeInTheDocument();

    const currentSource = FakeEventSource.instances.at(-1);
    currentSource?.emit('progress', JSON.stringify({ phase: 'indexing' }));
    currentSource?.emit('done', JSON.stringify({ status: 'completed' }));

    await waitFor(() => {
      expect(screen.getByText('phase: indexing')).toBeInTheDocument();
      expect(screen.getAllByText('DONE')).toHaveLength(1);
    });
    expect(currentSource?.closed).toBe(true);
  });

  it('shows load and create errors and clears pending state', async () => {
    const onCreateRun = vi.fn(async () => {
      throw new Error('start failed');
    });
    const onLoadRunLogs = vi
      .fn(async (): Promise<LearningRunEvent[]> => {
        throw new Error('log load failed');
      })
      .mockResolvedValueOnce([] as LearningRunEvent[])
      .mockRejectedValueOnce(new Error('log load failed'));

    render(
      <LearningRunsPanel
        latestRunId="run-1"
        onCreateRun={onCreateRun}
        onLoadRunLogs={onLoadRunLogs}
        runs={runs}
      />,
    );

    await waitFor(() => expect(onLoadRunLogs).toHaveBeenCalledWith('run-1'));
    expect(screen.getByText('No learning run logs loaded yet.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reload logs' }));
    await waitFor(() => expect(screen.getByText('log load failed')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Run resync' }));
    expect(screen.getByRole('button', { name: 'Run resync' })).toBeDisabled();

    await waitFor(() => expect(screen.getByText('start failed')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Run resync' })).not.toBeDisabled();
  });
});
