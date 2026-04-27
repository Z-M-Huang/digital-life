export type SseEvent = {
  event: string;
  data: string;
  id?: string;
};

const SEPARATOR = /\r?\n\r?\n/;

const parseEventChunk = (chunk: string): SseEvent | null => {
  const lines = chunk.split(/\r?\n/);
  let event = 'message';
  let id: string | undefined;
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart());
    } else if (line.startsWith('id:')) {
      id = line.slice('id:'.length).trim();
    }
  }
  if (dataLines.length === 0) {
    return null;
  }
  const evt: SseEvent = { event, data: dataLines.join('\n') };
  if (id !== undefined) {
    evt.id = id;
  }
  return evt;
};

const splitOnFirstSeparator = (buffer: string): { chunk: string; rest: string } | null => {
  const match = buffer.match(SEPARATOR);
  if (!match || typeof match.index !== 'number') {
    return null;
  }
  const chunk = buffer.slice(0, match.index);
  const rest = buffer.slice(match.index + match[0].length);
  return { chunk, rest };
};

export async function* parseSseStream(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  // Per-stream TextDecoder so concurrent SSE consumers don't share UTF-8 state.
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      let split = splitOnFirstSeparator(buffer);
      while (split) {
        buffer = split.rest;
        const event = parseEventChunk(split.chunk);
        if (event) {
          yield event;
        }
        split = splitOnFirstSeparator(buffer);
      }
    }
    // Flush any final partial multi-byte sequence.
    buffer += decoder.decode();
    if (buffer.trim().length > 0) {
      const event = parseEventChunk(buffer);
      if (event) {
        yield event;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export const postSse = async (
  url: string,
  body: unknown,
  init?: { signal?: AbortSignal; headers?: Record<string, string> },
): Promise<AsyncGenerator<SseEvent>> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'text/event-stream',
      'content-type': 'application/json',
      ...init?.headers,
    },
    body: JSON.stringify(body),
    ...(init?.signal ? { signal: init.signal } : {}),
  });
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '');
    throw new Error(`SSE request failed: ${response.status} ${text}`);
  }
  return parseSseStream(response.body);
};
