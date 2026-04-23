import type { DigitalLifeRuntime } from '@digital-life/orchestrator';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';

const chatQuerySchema = z.object({
  conversationId: z.string().uuid().optional(),
  query: z.string(),
});

const wantsEventStream = (acceptHeader: string | null): boolean =>
  Boolean(acceptHeader?.includes('text/event-stream'));

export const createChatRoutes = (runtime: DigitalLifeRuntime) => {
  const app = new Hono();

  app.post('/chat/query', async (context) => {
    const payload = chatQuerySchema.parse(await context.req.json());
    const input = {
      query: payload.query,
      ...(payload.conversationId ? { conversationId: payload.conversationId } : {}),
    };
    if (wantsEventStream(context.req.header('accept') ?? null)) {
      const events = await runtime.chatService.streamQuery(input);
      return streamSSE(context, async (stream) => {
        for (const event of events) {
          await stream.writeSSE({
            data: JSON.stringify(event.payload),
            event: event.type,
          });
        }
      });
    }

    try {
      const result = await runtime.chatService.query(input);
      return context.json({
        answer: result.answer,
        clarificationRequest: result.clarificationRequest,
        conversation: result.conversation,
        evidence: result.evidence,
      });
    } catch (error) {
      return context.json(
        {
          error: error instanceof Error ? error.message : 'Unknown chat error',
        },
        404,
      );
    }
  });
  app.get('/chat/conversations/:id', async (context) => {
    const conversation = await runtime.chatService.getConversation(context.req.param('id'));
    return conversation
      ? context.json(conversation)
      : context.json({ error: 'conversation not found' }, 404);
  });

  return app;
};
