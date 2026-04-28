import { useEffect, useRef, useState } from 'react';

import type { LearningRunEvent, LearningRunMode, LearningRunSummary } from '../app/use-dashboard';

const formatPayload = (payload: Record<string, unknown>) =>
  Object.entries(payload)
    .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(' · ');

export const LearningRunsPanel = ({
  connectorIds,
  latestRunId,
  onCreateRun,
  onLoadRunLogs,
  runs,
}: {
  connectorIds: string[];
  latestRunId: string | null;
  onCreateRun: (mode: LearningRunMode) => Promise<{ id: string }>;
  onLoadRunLogs: (runId: string) => Promise<LearningRunEvent[]>;
  runs: LearningRunSummary[];
}) => {
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<LearningRunEvent[]>([]);
  const [pendingMode, setPendingMode] = useState<LearningRunMode | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(latestRunId);
  const streamRef = useRef<EventSource | null>(null);

  const loadLogs = async (runId: string) => {
    setSelectedRunId(runId);

    try {
      setLogs(await onLoadRunLogs(runId));
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Learning run log load failed');
    }
  };

  useEffect(() => {
    if (!latestRunId) {
      return;
    }

    if (selectedRunId === latestRunId && logs.length > 0) {
      return;
    }

    void loadLogs(latestRunId);
  }, [latestRunId]);

  useEffect(() => {
    streamRef.current?.close();
    streamRef.current = null;
    if (!selectedRunId || typeof EventSource === 'undefined') {
      return;
    }
    const source = new EventSource(`/api/learning/runs/${selectedRunId}/stream`);
    streamRef.current = source;
    const onEvent = (eventType: LearningRunEvent['type']) => (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data) as Record<string, unknown>;
        setLogs((current) => [
          ...current,
          { runId: selectedRunId, type: eventType, payload, createdAt: new Date().toISOString() },
        ]);
      } catch {
        // ignore malformed SSE payloads
      }
    };
    source.addEventListener('phase', onEvent('phase'));
    source.addEventListener('progress', onEvent('progress'));
    source.addEventListener('log', onEvent('log'));
    source.addEventListener('warning', onEvent('warning'));
    source.addEventListener('done', (event) => {
      onEvent('done')(event as MessageEvent);
      source.close();
    });
    source.addEventListener('error', (event) => {
      onEvent('error')(event as MessageEvent);
      source.close();
    });
    return () => {
      source.close();
      streamRef.current = null;
    };
  }, [selectedRunId]);

  const createRun = async (mode: LearningRunMode) => {
    setPendingMode(mode);

    try {
      const run = await onCreateRun(mode);
      await loadLogs(run.id);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Learning run start failed');
    } finally {
      setPendingMode(null);
    }
  };

  const formatRunConnectors = (run: LearningRunSummary) => {
    const currentConnectorIds = run.connectorIds.filter((connectorId) =>
      connectorIds.includes(connectorId),
    );
    if (currentConnectorIds.length > 0) {
      return currentConnectorIds.join(', ');
    }
    return run.connectorIds.length > 0 ? 'previous connector config' : 'all connectors';
  };

  return (
    <div className="stack">
      <div className="button-row">
        <button
          disabled={pendingMode === 'incremental'}
          onClick={() => void createRun('incremental')}
          type="button"
        >
          Run incremental
        </button>
        <button
          disabled={pendingMode === 'resync'}
          onClick={() => void createRun('resync')}
          type="button"
        >
          Run resync
        </button>
      </div>
      <div className="summary-list">
        {runs.map((run) => (
          <article className="result-card" key={run.id}>
            <strong>
              {run.mode} · {run.status}
            </strong>
            <span className="muted">
              {formatRunConnectors(run)} · {run.id}
            </span>
            <button onClick={() => void loadLogs(run.id)} type="button">
              {selectedRunId === run.id ? 'Reload logs' : 'View logs'}
            </button>
          </article>
        ))}
      </div>
      {selectedRunId ? <p>Selected run: {selectedRunId}</p> : null}
      <div className="log-list">
        {logs.map((event, index) => (
          <article className={`log-entry log-${event.type}`} key={`${event.runId}:${index}`}>
            <strong>{event.type.toUpperCase()}</strong>
            <span>{formatPayload(event.payload)}</span>
          </article>
        ))}
        {logs.length === 0 ? <p className="muted">No learning run logs loaded yet.</p> : null}
      </div>
      {error ? <p className="muted">{error}</p> : null}
    </div>
  );
};
