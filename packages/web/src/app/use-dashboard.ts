import { useEffect, useState } from 'react';

export type GovernedPhase = 'learning' | 'live' | 'maintenance';
export type LearningRunMode = 'baseline' | 'incremental' | 'resync';

export type ScopeSelection = {
  id: string;
  label: string;
  metadata?: Record<string, unknown>;
};

export type BootstrapData = {
  baselineRunId: string | null;
  manualContext: Array<Record<string, unknown>>;
  persona: Record<string, unknown>;
  recommendedConnectors: string[];
  status: string;
};

export type ConnectorSummary = {
  displayName: string;
  id: string;
  kind: string;
  scope: ScopeSelection[];
  scopeCount: number;
  scopeOptions: ScopeSelection[];
  toolCount: number;
};

export type LearningRunSummary = {
  connectorIds: string[];
  createdAt: string;
  details: Record<string, unknown>;
  id: string;
  mode: LearningRunMode;
  status: string;
  updatedAt: string;
};

export type LearningRunEvent = {
  createdAt: string;
  payload: Record<string, unknown>;
  runId: string;
  type: 'phase' | 'progress' | 'log' | 'warning' | 'done' | 'error';
};

export type ReflectionItem = {
  category: 'startup' | 'scope' | 'knowledge' | 'policy' | 'maintenance';
  connectorId: string | null;
  detail: string;
  id: string;
  metadata: Record<string, unknown>;
  runId: string | null;
  severity: 'info' | 'warning' | 'error';
  status: 'open' | 'resolved';
  title: string;
};

export type StartupLog = {
  connectorId: string | null;
  level: string;
  message: string;
};

export type ToolSummary = {
  capability: string;
  learningEnabled: boolean;
  liveEnabled: boolean;
  maintenanceEnabled: boolean;
  phases: GovernedPhase[];
  role: string;
  toolId: string;
};

type DashboardSnapshot = {
  connectors: number;
  latestRunId: string | null;
  readiness: {
    blockers: string[];
    score: number;
    status: string;
    warnings: string[];
  };
  scopedConnectors: number;
  tools: number;
};

export type DashboardData = {
  bootstrap: BootstrapData;
  connectors: ConnectorSummary[];
  dashboard: DashboardSnapshot;
  learningRuns: LearningRunSummary[];
  reflection: ReflectionItem[];
  startupLogs: StartupLog[];
  tools: ToolSummary[];
};

const defaultDashboardData: DashboardData = {
  bootstrap: {
    baselineRunId: null,
    manualContext: [],
    persona: {},
    recommendedConnectors: [],
    status: 'not_started',
  },
  connectors: [],
  dashboard: {
    connectors: 0,
    latestRunId: null,
    readiness: {
      blockers: [],
      score: 0,
      status: 'partial',
      warnings: [],
    },
    scopedConnectors: 0,
    tools: 0,
  },
  learningRuns: [],
  reflection: [],
  startupLogs: [],
  tools: [],
};

const readError = async (response: Response): Promise<string> => {
  try {
    const payload = (await response.json()) as { error?: string };
    if (payload.error) {
      return payload.error;
    }
  } catch {
    return response.statusText || `Request failed with status ${response.status}`;
  }

  return response.statusText || `Request failed with status ${response.status}`;
};

const fetchJson = async <T>(input: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(input, init);
  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return (await response.json()) as T;
};

export const useDashboardData = () => {
  const [data, setData] = useState<DashboardData>(defaultDashboardData);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoading(true);
      try {
        const [dashboard, connectors, tools, bootstrap, startupLogs, reflection, learningRuns] =
          await Promise.all([
            fetchJson<DashboardSnapshot>('/api/dashboard'),
            fetchJson<
              Array<{
                displayName: string;
                id: string;
                kind: string;
                scopeCount: number;
                toolCount: number;
              }>
            >('/api/connectors'),
            fetchJson<ToolSummary[]>('/api/tools'),
            fetchJson<BootstrapData>('/api/bootstrap'),
            fetchJson<StartupLog[]>('/api/startup/logs'),
            fetchJson<ReflectionItem[]>('/api/reflection'),
            fetchJson<LearningRunSummary[]>('/api/learning/runs'),
          ]);
        const enrichedConnectors = await Promise.all(
          connectors.map(async (connector) => ({
            ...connector,
            scope: await fetchJson<ScopeSelection[]>(`/api/connectors/${connector.id}/scope`),
            scopeOptions: await fetchJson<ScopeSelection[]>(
              `/api/connectors/${connector.id}/scope-options`,
            ),
          })),
        );

        if (!active) {
          return;
        }

        setData({
          bootstrap,
          connectors: enrichedConnectors,
          dashboard,
          learningRuns,
          reflection,
          startupLogs,
          tools,
        });
        setError(null);
      } catch (loadError) {
        if (!active) {
          return;
        }

        setError(loadError instanceof Error ? loadError.message : 'Unknown dashboard error');
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, [refreshKey]);

  const performMutation = async <T>(operation: () => Promise<T>): Promise<T> => {
    const result = await operation();
    setRefreshKey((current) => current + 1);
    return result;
  };

  return {
    data,
    error,
    loading,
    reload() {
      setRefreshKey((current) => current + 1);
    },
    addManualContext(text: string) {
      return performMutation(() =>
        fetchJson<BootstrapData>('/api/bootstrap/manual-context', {
          body: JSON.stringify([{ source: 'operator', text }]),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        }),
      );
    },
    createLearningRun(mode: LearningRunMode) {
      return performMutation(() =>
        fetchJson<LearningRunSummary>('/api/learning/runs', {
          body: JSON.stringify({ mode }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        }),
      );
    },
    loadRunLogs(runId: string) {
      return fetchJson<LearningRunEvent[]>(`/api/learning/runs/${runId}/logs`);
    },
    patchToolPolicy(toolId: string, phase: GovernedPhase, enabled: boolean, reason?: string) {
      return performMutation(() =>
        fetchJson(`/api/tools/${toolId}/policy`, {
          body: JSON.stringify({
            enabled,
            phase,
            ...(reason ? { reason } : {}),
          }),
          headers: { 'content-type': 'application/json' },
          method: 'PATCH',
        }),
      );
    },
    recomputeReflection() {
      return performMutation(() =>
        fetchJson<ReflectionItem[]>('/api/reflection/recompute', {
          method: 'POST',
        }),
      );
    },
    savePersona(persona: Record<string, unknown>) {
      return performMutation(() =>
        fetchJson<BootstrapData>('/api/bootstrap/persona', {
          body: JSON.stringify(persona),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        }),
      );
    },
    saveScope(connectorId: string, scope: ScopeSelection[]) {
      return performMutation(() =>
        fetchJson(`/api/connectors/${connectorId}/scope`, {
          body: JSON.stringify(scope),
          headers: { 'content-type': 'application/json' },
          method: 'PUT',
        }),
      );
    },
    startBaseline() {
      return performMutation(() =>
        fetchJson<{ bootstrap: BootstrapData; runId: string }>('/api/bootstrap/start', {
          method: 'POST',
        }),
      );
    },
    validateStartup() {
      return performMutation(() =>
        fetchJson('/api/startup/validate', {
          method: 'POST',
        }),
      );
    },
  };
};
