import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseSseStream, postSse } from '../src/lib/sse';

const encode = (text: string) => new TextEncoder().encode(text);

const streamFromChunks = (chunks: string[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encode(chunk));
      }
      controller.close();
    },
  });

const collectEvents = async (
  events: AsyncIterable<{ event: string; data: string; id?: string }>,
) => {
  const collected: Array<{ event: string; data: string; id?: string }> = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
};

describe('parseSseStream', () => {
  it('parses event names, ids, multi-line data, and chunk boundaries', async () => {
    const events = await collectEvents(
      parseSseStream(
        streamFromChunks([
          'event: progress\nid: 7\ndata: {"step":1}\n',
          'data: {"detail":"loading"}\n\n',
          'data: plain message\n\n',
        ]),
      ),
    );

    expect(events).toEqual([
      { event: 'progress', id: '7', data: '{"step":1}\n{"detail":"loading"}' },
      { event: 'message', data: 'plain message' },
    ]);
  });

  it('ignores events without data and flushes a trailing event without a separator', async () => {
    const events = await collectEvents(
      parseSseStream(streamFromChunks(['event: ping\n\n', 'event: done\ndata: {"ok":true}'])),
    );

    expect(events).toEqual([{ event: 'done', data: '{"ok":true}' }]);
  });
});

describe('postSse', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('posts JSON and returns a parsed SSE stream', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(streamFromChunks(['event: done\ndata: {"ok":true}\n\n']), {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
    ) as unknown as typeof fetch;

    const controller = new AbortController();
    const events = await postSse(
      '/api/chat/query',
      { query: 'What changed?' },
      { signal: controller.signal, headers: { authorization: 'Bearer token' } },
    );

    await expect(collectEvents(events)).resolves.toEqual([{ event: 'done', data: '{"ok":true}' }]);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/chat/query',
      expect.objectContaining({
        method: 'POST',
        signal: controller.signal,
        headers: {
          accept: 'text/event-stream',
          'content-type': 'application/json',
          authorization: 'Bearer token',
        },
        body: JSON.stringify({ query: 'What changed?' }),
      }),
    );
  });

  it('throws when the SSE request fails or has no body', async () => {
    globalThis.fetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('bad request', { status: 400 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    await expect(postSse('/api/chat/query', { query: 'bad' })).rejects.toThrow(
      'SSE request failed: 400 bad request',
    );
    await expect(postSse('/api/chat/query', { query: 'missing body' })).rejects.toThrow(
      'SSE request failed: 200 ',
    );
  });
});
