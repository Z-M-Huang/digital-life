import { type FormEvent, useEffect, useState } from 'react';

import type { BootstrapData } from '../app/use-dashboard';

export const BootstrapPanel = ({
  bootstrap,
  onAddManualContext,
  onSavePersona,
  onStartBaseline,
}: {
  bootstrap: BootstrapData;
  onAddManualContext: (text: string) => Promise<unknown>;
  onSavePersona: (name: string) => Promise<unknown>;
  onStartBaseline: () => Promise<unknown>;
}) => {
  const [personaName, setPersonaName] = useState('');
  const [manualContext, setManualContext] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  useEffect(() => {
    setPersonaName(
      typeof bootstrap.persona.name === 'string' ? bootstrap.persona.name : 'Digital Life',
    );
  }, [bootstrap.persona]);

  const handlePersonaSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPendingAction('persona');

    try {
      await onSavePersona(personaName.trim() || 'Digital Life');
      setError(null);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Persona update failed');
    } finally {
      setPendingAction(null);
    }
  };

  const handleContextSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!manualContext.trim()) {
      return;
    }

    setPendingAction('context');
    try {
      await onAddManualContext(manualContext.trim());
      setManualContext('');
      setError(null);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Manual context update failed');
    } finally {
      setPendingAction(null);
    }
  };

  const handleBaselineStart = async () => {
    setPendingAction('baseline');

    try {
      await onStartBaseline();
      setError(null);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Baseline start failed');
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <div className="stack">
      <p>Bootstrap status: {bootstrap.status}</p>
      <p>Recommended connectors: {bootstrap.recommendedConnectors.join(', ') || 'None'}</p>
      <p>Baseline run: {bootstrap.baselineRunId ?? 'Not started'}</p>
      <form className="inline-form" onSubmit={handlePersonaSubmit}>
        <input
          aria-label="Persona name"
          onChange={(event) => setPersonaName(event.target.value)}
          placeholder="Persona name"
          value={personaName}
        />
        <button disabled={pendingAction === 'persona'} type="submit">
          Save persona
        </button>
      </form>
      <form className="stack" onSubmit={handleContextSubmit}>
        <textarea
          aria-label="Manual context"
          onChange={(event) => setManualContext(event.target.value)}
          placeholder="Add manual seed context"
          rows={3}
          value={manualContext}
        />
        <button disabled={pendingAction === 'context'} type="submit">
          Add context
        </button>
      </form>
      <button disabled={pendingAction === 'baseline'} onClick={handleBaselineStart} type="button">
        Start baseline learning
      </button>
      <div className="summary-list">
        {bootstrap.manualContext.slice(-3).map((entry, index) => (
          <article className="result-card" key={`context-${index}`}>
            <strong>{String(entry.source ?? 'operator')}</strong>
            <span>{String(entry.text ?? '')}</span>
          </article>
        ))}
      </div>
      {error ? <p className="muted">{error}</p> : null}
    </div>
  );
};
