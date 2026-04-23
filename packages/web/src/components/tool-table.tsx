import { useState } from 'react';

import type { GovernedPhase, ToolSummary } from '../app/use-dashboard';

const phases: GovernedPhase[] = ['learning', 'live', 'maintenance'];

const isEnabledForPhase = (tool: ToolSummary, phase: GovernedPhase) => {
  if (phase === 'learning') {
    return tool.learningEnabled;
  }

  if (phase === 'live') {
    return tool.liveEnabled;
  }

  return tool.maintenanceEnabled;
};

export const ToolTable = ({
  onPatchPolicy,
  tools,
}: {
  onPatchPolicy: (
    toolId: string,
    phase: GovernedPhase,
    enabled: boolean,
    reason?: string,
  ) => Promise<unknown>;
  tools: ToolSummary[];
}) => {
  const [error, setError] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const updatePolicy = async (tool: ToolSummary, phase: GovernedPhase) => {
    const enabled = isEnabledForPhase(tool, phase);
    const reason =
      phase === 'live' && tool.capability !== 'read' ? reasons[tool.toolId] : undefined;
    const operationKey = `${tool.toolId}:${phase}`;
    setPendingKey(operationKey);

    try {
      await onPatchPolicy(tool.toolId, phase, !enabled, reason);
      setError(null);
      if (reason) {
        setReasons((current) => ({
          ...current,
          [tool.toolId]: '',
        }));
      }
    } catch (policyError) {
      setError(policyError instanceof Error ? policyError.message : 'Tool policy update failed');
    } finally {
      setPendingKey(null);
    }
  };

  return (
    <div className="stack">
      <table className="tool-table">
        <thead>
          <tr>
            <th>Tool</th>
            <th>Capability</th>
            <th>Role</th>
            <th>Learning</th>
            <th>Live</th>
            <th>Maintenance</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          {tools.map((tool) => (
            <tr key={tool.toolId}>
              <td>{tool.toolId}</td>
              <td>{tool.capability}</td>
              <td>{tool.role}</td>
              {phases.map((phase) => (
                <td key={`${tool.toolId}:${phase}`}>
                  {tool.phases.includes(phase) ? (
                    <button
                      disabled={pendingKey === `${tool.toolId}:${phase}`}
                      onClick={() => void updatePolicy(tool, phase)}
                      type="button"
                    >
                      {isEnabledForPhase(tool, phase) ? 'Disable' : 'Enable'}
                    </button>
                  ) : (
                    <span className="muted">n/a</span>
                  )}
                </td>
              ))}
              <td>
                {tool.capability !== 'read' && tool.phases.includes('live') ? (
                  <input
                    aria-label={`${tool.toolId} reason`}
                    onChange={(event) =>
                      setReasons((current) => ({
                        ...current,
                        [tool.toolId]: event.target.value,
                      }))
                    }
                    placeholder="Required to enable live write/execute"
                    value={reasons[tool.toolId] ?? ''}
                  />
                ) : (
                  <span className="muted">Not required</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {error ? <p className="muted">{error}</p> : null}
    </div>
  );
};
