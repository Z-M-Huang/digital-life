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
  onSavePersona: (persona: Record<string, unknown>) => Promise<unknown>;
  onStartBaseline: () => Promise<unknown>;
}) => {
  const [displayName, setDisplayName] = useState('');
  const [manualContext, setManualContext] = useState('');
  const [systemPromptAppendix, setSystemPromptAppendix] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  useEffect(() => {
    const personaDisplayName =
      typeof bootstrap.persona.displayName === 'string'
        ? bootstrap.persona.displayName
        : typeof bootstrap.persona.name === 'string'
          ? bootstrap.persona.name
          : 'Digital Life';
    const personaSystemPromptAppendix =
      typeof bootstrap.persona.systemPromptAppendix === 'string'
        ? bootstrap.persona.systemPromptAppendix
        : '';
    setDisplayName(personaDisplayName);
    setSystemPromptAppendix(personaSystemPromptAppendix);
  }, [bootstrap.persona]);

  const handlePersonaSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPendingAction('persona');

    try {
      const trimmedDisplayName = displayName.trim() || 'Digital Life';
      const persona = { ...bootstrap.persona };
      delete persona.language;
      delete persona.name;
      delete persona.systemPromptAppendix;
      await onSavePersona({
        ...persona,
        displayName: trimmedDisplayName,
        name: trimmedDisplayName,
        systemPromptAppendix: systemPromptAppendix.trim(),
      });
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
      <form className="persona-form" onSubmit={handlePersonaSubmit}>
        <label className="field-label">
          <span>Persona name</span>
          <input
            aria-label="Persona name"
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Persona name"
            value={displayName}
          />
        </label>
        <label className="field-label field-label-wide">
          <span>System prompt additions</span>
          <textarea
            aria-label="System prompt additions"
            onChange={(event) => setSystemPromptAppendix(event.target.value)}
            placeholder="Add instructions to append to the chat system prompt"
            rows={4}
            value={systemPromptAppendix}
          />
        </label>
        <button disabled={pendingAction === 'persona'} type="submit">
          Save persona
        </button>
      </form>
      <form className="stack" onSubmit={handleContextSubmit}>
        <textarea
          aria-label="Manual context"
          onChange={(event) => setManualContext(event.target.value)}
          placeholder="Add learning seed context"
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
