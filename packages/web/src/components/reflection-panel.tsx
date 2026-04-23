import { useState } from 'react';

import type { ReflectionItem } from '../app/use-dashboard';

export const ReflectionPanel = ({
  items,
  onRecompute,
}: {
  items: ReflectionItem[];
  onRecompute: () => Promise<unknown>;
}) => {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const recompute = async () => {
    setPending(true);

    try {
      await onRecompute();
      setError(null);
    } catch (recomputeError) {
      setError(
        recomputeError instanceof Error ? recomputeError.message : 'Reflection refresh failed',
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="stack">
      <button disabled={pending} onClick={() => void recompute()} type="button">
        Recompute reflection
      </button>
      <div className="summary-list">
        {items.map((item) => (
          <article className={`log-entry log-${item.severity}`} key={item.id}>
            <strong>
              {item.category} · {item.title}
            </strong>
            <span>{item.detail}</span>
          </article>
        ))}
        {items.length === 0 ? (
          <p className="muted">No reflection items are currently open.</p>
        ) : null}
      </div>
      {error ? <p className="muted">{error}</p> : null}
    </div>
  );
};
