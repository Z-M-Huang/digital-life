import { type FormEvent, useState } from 'react';

import { postSse } from '../lib/sse';

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

type ReflectionSignal = {
  category: string;
  detail: string;
};

type DonePayload = {
  answer: string;
  clarificationRequest: string | null;
  conversationId: string;
  evidenceCount: number;
  mode: 'grounded' | 'qualified' | 'clarification' | 'abstention';
};

const buildLocalMessage = (
  role: ConversationMessage['role'],
  content: string,
): ConversationMessage => ({
  id: `local-${role}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  role,
  content,
  evidenceFactIds: [],
});

export const ChatPanel = () => {
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [evidence, setEvidence] = useState<Record<string, ChatEvidence>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [streamingAnswer, setStreamingAnswer] = useState('');
  const [reflectionSignals, setReflectionSignals] = useState<ReflectionSignal[]>([]);
  const [mode, setMode] = useState<DonePayload['mode'] | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setStreamingAnswer('');
    setReflectionSignals([]);
    setMode(null);

    const submittedQuery = query;
    const userMessage = buildLocalMessage('user', submittedQuery);
    const conversationBefore = conversation;
    const evidenceFactIds: string[] = [];

    setConversation((current) =>
      current
        ? { ...current, messages: [...current.messages, userMessage] }
        : { id: 'pending', messages: [userMessage] },
    );

    try {
      const stream = await postSse('/api/chat/query', {
        query: submittedQuery,
        ...(conversationBefore ? { conversationId: conversationBefore.id } : {}),
      });

      let aggregatedAnswer = '';
      let donePayload: DonePayload | null = null;

      for await (const sseEvent of stream) {
        const data = sseEvent.data ? JSON.parse(sseEvent.data) : null;
        switch (sseEvent.event) {
          case 'text_delta': {
            const delta = (data as { delta: string }).delta;
            aggregatedAnswer = aggregatedAnswer ? `${aggregatedAnswer} ${delta}` : delta;
            setStreamingAnswer(aggregatedAnswer);
            break;
          }
          case 'evidence': {
            const item = data as ChatEvidence;
            evidenceFactIds.push(item.id);
            setEvidence((current) => ({ ...current, [item.id]: item }));
            break;
          }
          case 'reflection_signal':
            setReflectionSignals((current) => [...current, data as ReflectionSignal]);
            break;
          case 'clarification_request':
            aggregatedAnswer = (data as { message: string }).message;
            setStreamingAnswer(aggregatedAnswer);
            break;
          case 'done':
            donePayload = data as DonePayload;
            break;
          case 'error':
            throw new Error((data as { message: string }).message);
        }
      }

      if (!donePayload) {
        throw new Error('Chat stream ended without a done event.');
      }

      const assistantMessage: ConversationMessage = {
        id: `local-assistant-${donePayload.conversationId}-${Date.now()}`,
        role: 'assistant',
        content: aggregatedAnswer,
        evidenceFactIds,
      };
      setConversation((current) => ({
        id: donePayload.conversationId,
        messages: current
          ? [
              ...current.messages.filter((message) => message.id !== userMessage.id),
              userMessage,
              assistantMessage,
            ]
          : [userMessage, assistantMessage],
      }));
      setMode(donePayload.mode);
      setError(null);
      setQuery('');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Chat request failed');
    } finally {
      setLoading(false);
      setStreamingAnswer('');
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
        <button disabled={loading || query.trim().length === 0} type="submit">
          {loading ? 'Querying…' : 'Send'}
        </button>
      </form>

      {error ? <p className="muted">{error}</p> : null}
      {mode ? <p className="muted">Last response mode: {mode}</p> : null}

      {streamingAnswer ? (
        <article className="chat-message chat-streaming">
          <p className="eyebrow">streaming</p>
          <strong>{streamingAnswer}</strong>
        </article>
      ) : null}

      {reflectionSignals.length > 0 ? (
        <details>
          <summary>Reflection signals ({reflectionSignals.length})</summary>
          <ul className="summary-list">
            {reflectionSignals.map((signal, index) => (
              <li key={`${signal.category}-${index}`}>
                <strong>{signal.category}</strong>
                <span>{signal.detail}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

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
