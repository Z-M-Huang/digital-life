import { useEffect, useRef, useState } from 'react';

import type { ConnectorSummary, ScopeSelection } from '../app/use-dashboard';

export const ConnectorScopePanel = ({
  connectors,
  onSaveScope,
}: {
  connectors: ConnectorSummary[];
  onSaveScope: (connectorId: string, scope: ScopeSelection[]) => Promise<unknown>;
}) => {
  const draftsRef = useRef<Record<string, string[]>>({});
  const [drafts, setDrafts] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [pendingConnectorId, setPendingConnectorId] = useState<string | null>(null);

  useEffect(() => {
    const nextDrafts = Object.fromEntries(
      connectors.map((connector) => [connector.id, connector.scope.map((item) => item.id)]),
    );
    draftsRef.current = nextDrafts;
    setDrafts(nextDrafts);
  }, [connectors]);

  const toggleSelection = (connectorId: string, optionId: string) => {
    setDrafts((current) => {
      const selected = new Set(current[connectorId] ?? []);
      if (selected.has(optionId)) {
        selected.delete(optionId);
      } else {
        selected.add(optionId);
      }

      const nextDrafts = {
        ...current,
        [connectorId]: [...selected],
      };
      draftsRef.current = nextDrafts;
      return nextDrafts;
    });
  };

  const saveScope = async (connector: ConnectorSummary) => {
    setPendingConnectorId(connector.id);

    try {
      const selectedIds = new Set(draftsRef.current[connector.id] ?? []);
      const nextScope = connector.scopeOptions.filter((item) => selectedIds.has(item.id));
      await onSaveScope(connector.id, nextScope);
      setError(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Scope update failed');
    } finally {
      setPendingConnectorId(null);
    }
  };

  return (
    <div className="stack">
      <p className="muted">
        Static connector registration stays read-only. Scope selection is a runtime-only operator
        choice.
      </p>
      {connectors.map((connector) => (
        <article className="result-card" key={connector.id}>
          <strong>{connector.displayName}</strong>
          <span className="muted">
            {connector.kind} connector · {connector.toolCount} tools ·{' '}
            {(drafts[connector.id] ?? []).length} selected
          </span>
          {connector.scopeOptions.length > 0 ? (
            <div className="scope-options">
              {connector.scopeOptions.map((option) => (
                <label className="scope-option" key={`${connector.id}:${option.id}`}>
                  <input
                    checked={(drafts[connector.id] ?? []).includes(option.id)}
                    onChange={() => toggleSelection(connector.id, option.id)}
                    type="checkbox"
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          ) : (
            <p className="muted">No scope discovery options are available for this connector.</p>
          )}
          <button
            disabled={pendingConnectorId === connector.id || connector.scopeOptions.length === 0}
            onClick={() => void saveScope(connector)}
            type="button"
          >
            Save scope
          </button>
        </article>
      ))}
      {error ? <p className="muted">{error}</p> : null}
    </div>
  );
};
