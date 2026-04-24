import { BootstrapPanel } from '../components/bootstrap-panel';
import { ChatPanel } from '../components/chat-panel';
import { ConnectorScopePanel } from '../components/connector-scope-panel';
import { KnowledgePanel } from '../components/knowledge-panel';
import { LearningRunsPanel } from '../components/learning-runs-panel';
import { ReflectionPanel } from '../components/reflection-panel';
import { SectionCard } from '../components/section-card';
import { StartupPanel } from '../components/startup-panel';
import { ToolTable } from '../components/tool-table';
import { useDashboardData } from './use-dashboard';

const readinessLabel = (status: string, score: number) => `${status.toUpperCase()} ${score}%`;

export const App = () => {
  const {
    addManualContext,
    createLearningRun,
    data,
    error,
    loadRunLogs,
    loading,
    patchToolPolicy,
    recomputeReflection,
    reload,
    savePersona,
    saveScope,
    startBaseline,
    validateStartup,
  } = useDashboardData();

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Digital Life Console</p>
          <h1>Operate runtime scope, learning cadence, and governed tools in one place.</h1>
          <p className="hero-copy">
            Static connector config and credentials remain read-only. Runtime scope, tool policy,
            bootstrap state, maintenance runs, readiness, and reflection remain operator-visible and
            editable here.
          </p>
        </div>
        <div className="readiness-pill">
          <span>Readiness</span>
          <strong>
            {loading
              ? 'Loading'
              : readinessLabel(data.dashboard.readiness.status, data.dashboard.readiness.score)}
          </strong>
          <span className="muted">
            {data.dashboard.readiness.blockers.length} blockers ·{' '}
            {data.dashboard.readiness.warnings.length} warnings
          </span>
        </div>
      </section>

      {error ? (
        <section className="error-banner" role="alert">
          <strong>Dashboard load failed.</strong>
          <span>{error}</span>
          <button onClick={reload} type="button">
            Retry
          </button>
        </section>
      ) : null}

      <div className="grid">
        <SectionCard eyebrow="Bootstrap" title="Persona and Baseline">
          <BootstrapPanel
            bootstrap={data.bootstrap}
            onAddManualContext={addManualContext}
            onSavePersona={savePersona}
            onStartBaseline={startBaseline}
          />
        </SectionCard>

        <SectionCard
          actions={
            <button onClick={() => void validateStartup()} type="button">
              Run validation
            </button>
          }
          eyebrow="Validation"
          title="Startup Checks"
        >
          <StartupPanel logs={data.startupLogs} />
        </SectionCard>

        <SectionCard eyebrow="Connectors" title="Scope and Inventory">
          <ConnectorScopePanel connectors={data.connectors} onSaveScope={saveScope} />
        </SectionCard>

        <SectionCard className="panel-wide" eyebrow="Tools" title="Runtime Policy">
          <ToolTable onPatchPolicy={patchToolPolicy} tools={data.tools} />
        </SectionCard>

        <SectionCard className="panel-wide" eyebrow="Learning" title="Maintenance Runs">
          <p>Configured connectors: {data.dashboard.connectors}</p>
          <p>Scoped connectors: {data.dashboard.scopedConnectors}</p>
          <p>Total tools: {data.dashboard.tools}</p>
          <LearningRunsPanel
            latestRunId={data.dashboard.latestRunId}
            onCreateRun={createLearningRun}
            onLoadRunLogs={loadRunLogs}
            runs={data.learningRuns}
          />
        </SectionCard>

        <SectionCard eyebrow="Reflection" title="Open Gaps">
          <ReflectionPanel items={data.reflection} onRecompute={recomputeReflection} />
        </SectionCard>

        <SectionCard eyebrow="Knowledge" title="Evidence Search">
          <KnowledgePanel />
        </SectionCard>

        <SectionCard eyebrow="Chat" title="Grounded Conversation">
          <p className="muted">
            Assistant replies stay grounded to persisted evidence, and each assistant message keeps
            its supporting facts one click away.
          </p>
          <ChatPanel />
        </SectionCard>
      </div>
    </main>
  );
};
