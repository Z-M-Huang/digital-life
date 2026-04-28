import { type ReactNode, useState } from 'react';

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

const workspaceTabs = [
  {
    id: 'command',
    label: 'Command Center',
    summary: 'Readiness, learning cadence, and current operating signals.',
  },
  {
    id: 'policies',
    label: 'Policies',
    summary: 'Tool policy approvals across learning, live, and maintenance phases.',
  },
  {
    id: 'scope',
    label: 'Sources',
    summary: 'Selected connector sources, bootstrap state, and startup validation.',
  },
  {
    id: 'intelligence',
    label: 'Intelligence',
    summary: 'Reflection gaps and learned evidence search.',
  },
  {
    id: 'conversation',
    label: 'Conversation',
    summary: 'Grounded chat with evidence-backed responses.',
  },
] as const;

type TabId = (typeof workspaceTabs)[number]['id'];
type Tone = 'danger' | 'good' | 'neutral' | 'warn';

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
  const [activeTab, setActiveTab] = useState<TabId>('command');

  const readiness = data.dashboard.readiness;
  const readinessStatus = loading ? 'Loading' : readinessLabel(readiness.status, readiness.score);
  const openReflection = data.reflection.filter((item) => item.status === 'open');
  const enabledPolicyCount = data.tools.filter(
    (tool) => tool.learningEnabled || tool.liveEnabled || tool.maintenanceEnabled,
  ).length;
  const healthTone: Tone =
    readiness.blockers.length > 0 ? 'danger' : readiness.warnings.length > 0 ? 'warn' : 'good';
  const metrics: Array<{
    detail: string;
    label: string;
    tone: Tone;
    value: string;
  }> = [
    {
      detail: `${readiness.blockers.length} blockers · ${readiness.warnings.length} warnings`,
      label: 'Readiness Score',
      tone: healthTone,
      value: loading ? '...' : `${readiness.score}%`,
    },
    {
      detail: `${enabledPolicyCount} enabled policies`,
      label: 'Runtime Tools',
      tone: data.dashboard.tools > 0 ? 'good' : 'warn',
      value: String(data.dashboard.tools),
    },
    {
      detail: `${data.dashboard.scopedConnectors} with sources`,
      label: 'Connectors',
      tone: data.dashboard.scopedConnectors > 0 ? 'good' : 'warn',
      value: `${data.dashboard.scopedConnectors}/${data.dashboard.connectors}`,
    },
    {
      detail: data.dashboard.latestRunId ?? 'No run selected',
      label: 'Learning Runs',
      tone: data.dashboard.latestRunId ? 'good' : 'neutral',
      value: String(data.learningRuns.length),
    },
    {
      detail: `${openReflection.filter((item) => item.severity !== 'info').length} need review`,
      label: 'Reflection Gaps',
      tone: openReflection.length > 0 ? 'warn' : 'good',
      value: String(openReflection.length),
    },
    {
      detail: data.startupLogs.length > 0 ? 'Validation events' : 'No validation yet',
      label: 'Startup',
      tone: data.startupLogs.length > 0 ? 'good' : 'neutral',
      value: String(data.startupLogs.length),
    },
  ];

  let tabContent: ReactNode;
  switch (activeTab) {
    case 'policies':
      tabContent = (
        <div className="tab-grid tab-grid-single">
          <SectionCard
            className="panel-primary panel-dense"
            eyebrow="Policies"
            title="Runtime Policy"
          >
            <ToolTable onPatchPolicy={patchToolPolicy} tools={data.tools} />
          </SectionCard>
        </div>
      );
      break;
    case 'scope':
      tabContent = (
        <div className="tab-grid tab-grid-split">
          <SectionCard eyebrow="Connectors" id="scope" title="Source Selection">
            <ConnectorScopePanel connectors={data.connectors} onSaveScope={saveScope} />
          </SectionCard>
          <div className="panel-stack">
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
                <button
                  className="button-secondary"
                  onClick={() => void validateStartup()}
                  type="button"
                >
                  Run validation
                </button>
              }
              eyebrow="Validation"
              title="Startup Checks"
            >
              <StartupPanel logs={data.startupLogs} />
            </SectionCard>
          </div>
        </div>
      );
      break;
    case 'intelligence':
      tabContent = (
        <div className="tab-grid tab-grid-split">
          <SectionCard eyebrow="Reflection" id="reflection" title="Open Gaps">
            <ReflectionPanel items={data.reflection} onRecompute={recomputeReflection} />
          </SectionCard>
          <SectionCard eyebrow="Knowledge" id="knowledge" title="Evidence Search">
            <KnowledgePanel />
          </SectionCard>
        </div>
      );
      break;
    case 'conversation':
      tabContent = (
        <div className="tab-grid tab-grid-chat">
          <SectionCard eyebrow="Chat" id="chat" title="Grounded Conversation">
            <p className="muted">
              Answers stay grounded to persisted evidence with supporting facts one click away.
            </p>
            <ChatPanel />
          </SectionCard>
          <SectionCard eyebrow="Knowledge" title="Evidence Context">
            <KnowledgePanel />
          </SectionCard>
        </div>
      );
      break;
    default:
      tabContent = (
        <div className="tab-grid tab-grid-command">
          <div className="primary-column command-main">
            <SectionCard
              className="panel-primary"
              eyebrow="Learning"
              id="learning"
              title="Maintenance Runs"
            >
              <div className="run-summary">
                <span>Configured connectors: {data.dashboard.connectors}</span>
                <span>Connectors with sources: {data.dashboard.scopedConnectors}</span>
                <span>Total tools: {data.dashboard.tools}</span>
              </div>
              <LearningRunsPanel
                connectorIds={data.connectors.map((connector) => connector.id)}
                latestRunId={data.dashboard.latestRunId}
                onCreateRun={createLearningRun}
                onLoadRunLogs={loadRunLogs}
                runs={data.learningRuns}
              />
            </SectionCard>
          </div>
        </div>
      );
      break;
  }

  return (
    <div className="portal-shell">
      <div className="workspace">
        <header className="topbar">
          <div className="brand-lockup">
            <span className="brand-mark">DL</span>
            <span>
              <strong>Digital Life Console</strong>
            </span>
          </div>
          <div className="topbar-actions">
            <button className="button-secondary" onClick={reload} type="button">
              Refresh
            </button>
          </div>
        </header>

        <main className="content-shell" id="overview">
          <section className="workspace-intro" aria-label="Workspace summary">
            <div>
              <p className="eyebrow">Overview</p>
              <h1>Readiness, sources, learning, policy, and grounded chat.</h1>
            </div>
          </section>

          <section className="workspace-tabs" aria-label="Workspace tabs">
            <div className="tab-list" role="tablist">
              {workspaceTabs.map((tab) => (
                <button
                  aria-controls={`workspace-panel-${tab.id}`}
                  aria-selected={activeTab === tab.id}
                  className="tab-button"
                  id={`workspace-tab-${tab.id}`}
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  role="tab"
                  type="button"
                >
                  <span className={`tab-glyph tab-glyph-${tab.id}`} aria-hidden="true" />
                  {tab.label}
                </button>
              ))}
            </div>
          </section>

          <section className="readiness-overview" aria-label="Readiness overview">
            <header className="overview-header">
              <div>
                <p className="eyebrow">Readiness Overview</p>
                <h2>{readinessStatus}</h2>
              </div>
              <span className={`state-pill state-${healthTone}`}>
                {healthTone === 'good'
                  ? 'All systems nominal'
                  : healthTone === 'danger'
                    ? `${readiness.blockers.length} blockers`
                    : `${readiness.warnings.length} warnings`}
              </span>
            </header>
            <div className="metric-grid">
              {metrics.map((metric) => (
                <article
                  className={[
                    'metric-card',
                    `metric-${metric.tone}`,
                    metric.label === 'Readiness Score' ? 'metric-score' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  key={metric.label}
                >
                  {metric.label === 'Readiness Score' ? (
                    <span
                      aria-hidden="true"
                      className="score-ring"
                      style={{
                        background: `conic-gradient(var(--success) ${
                          Math.max(0, Math.min(readiness.score, 100)) * 3.6
                        }deg, var(--line) 0deg)`,
                      }}
                    >
                      <strong>{loading ? '...' : `${readiness.score}%`}</strong>
                    </span>
                  ) : (
                    <span className="metric-icon" aria-hidden="true" />
                  )}
                  <div>
                    <strong>
                      {metric.label === 'Readiness Score' ? metric.label : metric.value}
                    </strong>
                    <span>{metric.label === 'Readiness Score' ? metric.detail : metric.label}</span>
                    {metric.label === 'Readiness Score' ? null : <small>{metric.detail}</small>}
                  </div>
                </article>
              ))}
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

          <section
            aria-labelledby={`workspace-tab-${activeTab}`}
            className="tab-panel"
            id={`workspace-panel-${activeTab}`}
            role="tabpanel"
          >
            {tabContent}
          </section>
        </main>
      </div>
    </div>
  );
};
