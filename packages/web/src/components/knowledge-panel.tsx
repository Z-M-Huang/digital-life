import { type FormEvent, useEffect, useState } from 'react';

type KnowledgeResult = {
  content: string;
  id: string;
  kind: string;
  score: number;
  sourceCount: number;
};

export const KnowledgePanel = () => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<KnowledgeResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const search = async (value: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (value.trim().length > 0) {
        params.set('q', value.trim());
      }

      const response = await fetch(`/api/knowledge/search?${params.toString()}`);
      const payload = (await response.json()) as KnowledgeResult[];
      setResults(payload);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Knowledge search failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void search('');
  }, []);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void search(query);
  };

  return (
    <div className="stack">
      <form className="inline-form" onSubmit={handleSubmit}>
        <input
          aria-label="Knowledge query"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search learned evidence"
          value={query}
        />
        <button type="submit">Search</button>
      </form>

      {error ? <p className="muted">{error}</p> : null}
      {loading ? <p className="muted">Loading knowledge…</p> : null}

      <div className="result-list">
        {results.map((result) => (
          <article className="result-card" key={result.id}>
            <p className="eyebrow">{result.kind}</p>
            <strong>{result.content}</strong>
            <span className="muted">
              Score {result.score} · Sources {result.sourceCount}
            </span>
          </article>
        ))}
        {!loading && results.length === 0 ? (
          <p className="muted">No learned evidence matched the current query.</p>
        ) : null}
      </div>
    </div>
  );
};
