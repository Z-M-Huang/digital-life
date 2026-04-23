import { type FormEvent, useState } from 'react';

type ChatEvidence = {
  content: string;
  id: string;
  kind: string;
};

type ConversationMessage = {
  content: string;
  evidenceFactIds: string[];
  id: string;
  role: 'user' | 'assistant';
};

type Conversation = {
  id: string;
  messages: ConversationMessage[];
};

type ChatResponse = {
  answer: string;
  clarificationRequest: string | null;
  conversation: Conversation;
  evidence: ChatEvidence[];
};

export const ChatPanel = () => {
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [evidence, setEvidence] = useState<Record<string, ChatEvidence>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);

    try {
      const response = await fetch('/api/chat/query', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          query,
          ...(conversation ? { conversationId: conversation.id } : {}),
        }),
      });
      const payload = (await response.json()) as ChatResponse | { error: string };
      if ('error' in payload) {
        throw new Error(payload.error);
      }

      setConversation(payload.conversation);
      setEvidence((current) =>
        Object.fromEntries([
          ...Object.entries(current),
          ...payload.evidence.map((entry) => [entry.id, entry] as const),
        ]),
      );
      setError(null);
      setQuery('');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Chat request failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="stack">
      <form className="stack" onSubmit={handleSubmit}>
        <textarea
          aria-label="Chat query"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Ask a grounded question about what the system learned"
          rows={3}
          value={query}
        />
        <button disabled={loading} type="submit">
          {loading ? 'Querying…' : 'Send'}
        </button>
      </form>

      {error ? <p className="muted">{error}</p> : null}

      <div className="result-list">
        {conversation?.messages.map((message) => (
          <article className={`chat-message chat-${message.role}`} key={message.id}>
            <p className="eyebrow">{message.role}</p>
            <strong>{message.content}</strong>
            {message.evidenceFactIds.length > 0 ? (
              <details>
                <summary>Evidence ({message.evidenceFactIds.length})</summary>
                <ul className="summary-list">
                  {message.evidenceFactIds.map((factId) => (
                    <li key={factId}>
                      <strong>{evidence[factId]?.kind ?? 'evidence'}</strong>
                      <span>{evidence[factId]?.content ?? factId}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </article>
        ))}
        {!conversation ? (
          <p className="muted">Grounded chat will persist a conversation once you send a query.</p>
        ) : null}
      </div>
    </div>
  );
};
