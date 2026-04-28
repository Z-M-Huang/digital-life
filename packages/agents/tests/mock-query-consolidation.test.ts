import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createConsolidationAgent } from '../src/consolidation/consolidation-agent';
import { consolidationOutputSchema } from '../src/consolidation/output-schema';
import { learnerOutputSchemas } from '../src/learners/output-schemas';
import type { LearnedFragment } from '../src/learners/types';
import type { LLMClient } from '../src/llm/client';
import {
  createCannedLearnerClient,
  createMockLLMClient,
  createPassthroughLearnerClient,
} from '../src/llm/mock';
import { loadBuiltinPrompts, type PromptBundle } from '../src/prompts/load';
import { createQueryAgent } from '../src/query/query-agent';

const collectStream = async (stream: AsyncIterable<string>) => {
  const chunks: string[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
};

const buildPrompts = async (): Promise<PromptBundle> => ({
  ...(await loadBuiltinPrompts()),
  promptVersion: '1.test',
});

const sampleFragment: LearnedFragment = {
  kind: 'factual',
  content: 'digital-life tracks repository activity.',
  confidence: 0.8,
  evidenceSpan: 'whole-material',
  authority: 'connector:demo',
  provenance: {
    source: 'demo.fetchRepository',
    materialId: 'material-1',
    extraction: {
      promptVersion: '1.test',
      extractionModel: 'mock-model',
      extractionVersion: 'mock-1',
    },
  },
  structured: { entities: ['digital-life'] },
};

const createStubClient = (generateObject: LLMClient['generateObject']): LLMClient => ({
  modelId: 'mock-model',
  extractionVersion: 'mock-1',
  async generateText() {
    return { text: 'mock answer' } as Awaited<ReturnType<LLMClient['generateText']>>;
  },
  streamText() {
    return {
      textStream: (async function* () {
        yield 'mock answer';
      })(),
    } as unknown as ReturnType<LLMClient['streamText']>;
  },
  generateObject,
  generateObjectFromMessages: (async (params) =>
    generateObject({
      ...params,
      system: '',
      prompt: params.messages
        .map((message) => `${message.role}: ${String(message.content)}`)
        .join('\n\n'),
    })) as LLMClient['generateObjectFromMessages'],
});

describe('mock LLM clients', () => {
  it('provides default text, stream, and schema-aware fallback objects', async () => {
    const client = createMockLLMClient({
      modelId: 'custom-model',
      extractionVersion: 'custom-1',
    });

    await expect(
      client.generateText({
        system: 'system',
        prompt: 'prompt',
        context: { promptId: 'test', promptVersion: '1' },
      }),
    ).resolves.toMatchObject({ text: 'mock answer' });
    await expect(
      collectStream(
        client.streamText({
          system: 'system',
          prompt: 'prompt',
          context: { promptId: 'test', promptVersion: '1' },
        }).textStream,
      ),
    ).resolves.toEqual(['mock answer']);
    await expect(
      client.generateObject({
        system: 'system',
        prompt: 'prompt',
        schema: z.object({ items: z.array(z.string()).default([]) }),
        context: { promptId: 'test', promptVersion: '1' },
      }),
    ).resolves.toMatchObject({ object: { items: [] } });

    expect(client.modelId).toBe('custom-model');
    expect(client.extractionVersion).toBe('custom-1');
  });

  it('returns canned learner fragments and falls back for incompatible schemas', async () => {
    const client = createCannedLearnerClient({
      factual: [{ content: 'Repository fact.', confidence: 0.8, entities: ['repo'] }],
    });

    await expect(
      client.generateObject({
        system: 'system',
        prompt: 'prompt',
        schema: learnerOutputSchemas.factual,
        context: { promptId: 'factual', promptVersion: '1' },
      }),
    ).resolves.toMatchObject({
      object: {
        fragments: [{ content: 'Repository fact.', confidence: 0.8, entities: ['repo'] }],
      },
    });
    await expect(
      client.generateObject({
        system: 'system',
        prompt: 'prompt',
        schema: z.object({
          mode: z.enum(['grounded', 'clarification', 'abstention']),
          answer: z.string().default(''),
          citedEvidenceIds: z.array(z.string()).default([]),
          reflectionSignals: z.array(z.object({ detail: z.string() })).default([]),
        }),
        context: { promptId: 'unknown-kind', promptVersion: '1' },
      }),
    ).resolves.toMatchObject({
      object: {
        mode: 'abstention',
        answer: '',
        citedEvidenceIds: [],
        reflectionSignals: [],
      },
    });
  });

  it('implements passthrough query and learner behavior from prompts', async () => {
    const client = createPassthroughLearnerClient();
    const queryPrompt = [
      'Conversation so far:\n(no prior turns)',
      '',
      'Latest user message: What changed?',
      '',
      'Retrieved evidence:\n- id=fact-1 score=0.90 kind=factual: Repository fact.',
    ].join('\n');

    await expect(
      collectStream(
        client.streamText({
          system: 'query-system',
          prompt: queryPrompt,
          context: { promptId: 'query', promptVersion: '1' },
        }).textStream,
      ),
    ).resolves.toEqual(['Grounded answer for "What changed?".']);
    await expect(
      client.generateObject({
        system: 'query-system',
        prompt:
          'Latest user message: What changed?\n\nRetrieved evidence:\n(no evidence retrieved)',
        schema: z.object({
          mode: z.enum(['grounded', 'abstention']),
          answer: z.string().default(''),
          citedEvidenceIds: z.array(z.string()).default([]),
          reflectionSignals: z.array(z.object({ detail: z.string() })).default([]),
        }),
        context: { promptId: 'query', promptVersion: '1' },
      }),
    ).resolves.toMatchObject({
      object: { mode: 'abstention', answer: '', citedEvidenceIds: [], reflectionSignals: [] },
    });
    await expect(
      client.generateObject({
        system: 'query-system',
        prompt: queryPrompt,
        schema: z.object({
          mode: z.enum(['grounded', 'abstention']),
          answer: z.string().default(''),
          citedEvidenceIds: z.array(z.string()).default([]),
          reflectionSignals: z.array(z.object({ detail: z.string() })).default([]),
        }),
        context: { promptId: 'query', promptVersion: '1' },
      }),
    ).resolves.toMatchObject({
      object: {
        mode: 'grounded',
        answer: 'Grounded answer for "What changed?".',
        citedEvidenceIds: ['fact-1'],
      },
    });
    await expect(
      client.generateObject({
        system: 'learner-system',
        prompt:
          'Material text:\nRepository fact. Another fact.\n\nReturn a single JSON object only.',
        schema: learnerOutputSchemas.factual,
        context: { promptId: 'factual', promptVersion: '1' },
      }),
    ).resolves.toMatchObject({
      object: {
        fragments: [
          { content: 'Repository fact.', confidence: 0.8, evidenceSpan: 'whole-material' },
          { content: 'Another fact.', confidence: 0.8, evidenceSpan: 'whole-material' },
        ],
      },
    });
    await expect(
      client.generateObject({
        system: 'learner-system',
        prompt:
          'Material text:\nRepository fact. Another fact.\n\nReturn a single JSON object only.',
        schema: learnerOutputSchemas.style,
        context: { promptId: 'style', promptVersion: '1' },
      }),
    ).resolves.toMatchObject({
      object: {
        fragments: [
          {
            content: 'style-pattern: Repository fact.',
            confidence: 0.65,
            evidenceSpan: 'whole-material',
          },
        ],
      },
    });
    await expect(
      client.generateObject({
        system: 'learner-system',
        prompt: 'Anything else',
        schema: z.object({ fragments: z.array(z.object({ content: z.string() })).default([]) }),
        context: { promptId: 'reflection', promptVersion: '1' },
      }),
    ).resolves.toMatchObject({ object: { fragments: [] } });
  });
});

describe('createQueryAgent', () => {
  it('builds prompts with placeholders when evidence and conversation are empty', async () => {
    const agent = createQueryAgent({
      client: createMockLLMClient(),
      prompts: await buildPrompts(),
    });

    const prompt = agent.buildAnswerPrompt({
      query: 'What changed?',
      evidence: [],
      conversation: [],
    });

    expect(prompt.system.length).toBeGreaterThan(0);
    expect(prompt.prompt).toContain('(no prior turns)');
    expect(prompt.prompt).toContain('(nothing on this topic)');
    expect(prompt.prompt).toContain('(no persona profile yet');
    expect(prompt.messages[0]).toMatchObject({ role: 'system' });
  });

  it('passes system addendum, formatted messages, and signal into generateObject', async () => {
    const controller = new AbortController();
    const generateObjectSpy = vi.fn(async (params: unknown) => {
      const context = (params as { context?: { promptId?: string } }).context;
      if (context?.promptId === 'query-grounding-review') {
        return {
          object: {
            allowed: true,
            reason: 'The cited draft is supported.',
            repairedMode: null,
            repairedAnswer: '',
            repairedClarificationQuestion: null,
            repairedCitedEvidenceIds: [],
          },
        };
      }

      return {
        object: {
          mode: 'grounded',
          answer: 'Grounded answer.',
          citedEvidenceIds: ['fact-1'],
          reflectionSignals: [],
        },
      };
    });
    const generateObject = (async (params) =>
      generateObjectSpy(params)) as LLMClient['generateObject'];
    const agent = createQueryAgent({
      client: createStubClient(generateObject),
      prompts: await buildPrompts(),
    });

    await expect(
      agent.decide({
        query: 'What changed?',
        evidence: [{ id: 'fact-1', content: 'Repository fact.', score: 0.91, kind: 'factual' }],
        conversation: [{ role: 'user', content: 'Hello' }],
        personaSlices: ['Prefers grounded answers'],
        systemPromptAppendix: 'Use Simplified Chinese only.',
        signal: controller.signal,
      }),
    ).resolves.toMatchObject({
      mode: 'grounded',
      answer: 'Grounded answer.',
      citedEvidenceIds: ['fact-1'],
    });

    expect(generateObjectSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('Use Simplified Chinese only.'),
        context: expect.objectContaining({
          promptId: 'query',
          promptVersion: '1.test',
          signal: controller.signal,
        }),
      }),
    );
  });

  it('asks the grounding reviewer to repair unsupported uncited factual answers', async () => {
    const generateObjectSpy = vi.fn(async (_params: unknown) => {
      const callIndex = generateObjectSpy.mock.calls.length;
      if (callIndex === 1) {
        return {
          object: {
            mode: 'grounded',
            answer: 'Last year I played Alpha Arena, Beta Royale, and Gamma Quest.',
            clarificationQuestion: null,
            citedEvidenceIds: ['not-a-real-fact'],
            reflectionSignals: [],
          },
        };
      }

      return {
        object: {
          allowed: false,
          reason: 'The draft named unsupported games.',
          repairedMode: 'abstention',
          repairedAnswer: 'I do not remember.',
          repairedClarificationQuestion: null,
          repairedCitedEvidenceIds: [],
        },
      };
    });
    const generateObject = (async (params) =>
      generateObjectSpy(params)) as LLMClient['generateObject'];
    const agent = createQueryAgent({
      client: createStubClient(generateObject),
      prompts: await buildPrompts(),
    });

    await expect(
      agent.decide({
        query: 'Which games did you play last year?',
        evidence: [
          {
            id: 'fact-1',
            content: 'The only known played game is Dream Journey.',
            score: 0.91,
            kind: 'factual',
          },
        ],
        conversation: [],
        systemPromptAppendix: 'Answer concisely.',
      }),
    ).resolves.toMatchObject({
      mode: 'abstention',
      answer: 'I do not remember.',
      citedEvidenceIds: [],
      reflectionSignals: [
        expect.objectContaining({
          category: 'missing_context',
        }),
      ],
    });
    expect(generateObjectSpy).toHaveBeenCalledTimes(2);
  });

  it('allows uncited identity answers when supported by persona slices', async () => {
    const generateObjectSpy = vi.fn(async (_params: unknown) => {
      const callIndex = generateObjectSpy.mock.calls.length;
      if (callIndex === 1) {
        return {
          object: {
            mode: 'grounded',
            answer: 'I am Meeting.',
            clarificationQuestion: null,
            citedEvidenceIds: [],
            reflectionSignals: [],
          },
        };
      }

      return {
        object: {
          allowed: true,
          reason: 'The persona identity supports the name answer.',
          repairedMode: null,
          repairedAnswer: '',
          repairedClarificationQuestion: null,
          repairedCitedEvidenceIds: [],
        },
      };
    });
    const generateObject = (async (params) =>
      generateObjectSpy(params)) as LLMClient['generateObject'];
    const agent = createQueryAgent({
      client: createStubClient(generateObject),
      prompts: await buildPrompts(),
    });

    await expect(
      agent.decide({
        query: 'Who are you?',
        evidence: [],
        conversation: [],
        personaSlices: ['Your name (persona display name): Meeting.'],
      }),
    ).resolves.toMatchObject({
      mode: 'grounded',
      answer: 'I am Meeting.',
      citedEvidenceIds: [],
    });
    expect(generateObjectSpy).toHaveBeenCalledTimes(2);
  });

  it('passes uncited clarification through without hardcoded language fallbacks', async () => {
    const generateObjectSpy = vi.fn(async (_params: unknown) => {
      const callIndex = generateObjectSpy.mock.calls.length;
      if (callIndex === 1) {
        return {
          object: {
            mode: 'clarification',
            answer: '',
            clarificationQuestion: 'What do you mean?',
            citedEvidenceIds: [],
            reflectionSignals: [],
          },
        };
      }

      return {
        object: {
          allowed: true,
          reason: 'The draft is only a generic clarification.',
          repairedMode: null,
          repairedAnswer: '',
          repairedClarificationQuestion: null,
          repairedCitedEvidenceIds: [],
        },
      };
    });
    const generateObject = (async (params) =>
      generateObjectSpy(params)) as LLMClient['generateObject'];
    const agent = createQueryAgent({
      client: createStubClient(generateObject),
      prompts: await buildPrompts(),
    });

    await expect(
      agent.decide({
        query: 'hey',
        evidence: [],
        conversation: [],
      }),
    ).resolves.toMatchObject({
      mode: 'clarification',
      answer: '',
      clarificationQuestion: 'What do you mean?',
      citedEvidenceIds: [],
    });
    expect(generateObjectSpy).toHaveBeenCalledTimes(2);
  });

  it('repairs uncited current-state filler in clarifications', async () => {
    const generateObjectSpy = vi.fn(async (_params: unknown) => {
      const callIndex = generateObjectSpy.mock.calls.length;
      if (callIndex === 1) {
        return {
          object: {
            mode: 'clarification',
            answer: '',
            clarificationQuestion: 'I am in a meeting. What do you need?',
            citedEvidenceIds: [],
            reflectionSignals: [],
          },
        };
      }

      return {
        object: {
          allowed: false,
          reason: 'The draft claimed an unsupported current state.',
          repairedMode: 'clarification',
          repairedAnswer: '',
          repairedClarificationQuestion: 'What do you need?',
          repairedCitedEvidenceIds: [],
        },
      };
    });
    const generateObject = (async (params) =>
      generateObjectSpy(params)) as LLMClient['generateObject'];
    const agent = createQueryAgent({
      client: createStubClient(generateObject),
      prompts: await buildPrompts(),
    });

    await expect(
      agent.decide({
        query: 'hey',
        evidence: [],
        conversation: [],
        personaSlices: ['Your name (persona display name): Meeting.'],
      }),
    ).resolves.toMatchObject({
      mode: 'clarification',
      answer: '',
      clarificationQuestion: 'What do you need?',
      citedEvidenceIds: [],
    });
    expect(generateObjectSpy).toHaveBeenCalledTimes(2);
  });
});

describe('createConsolidationAgent', () => {
  it('returns an empty result without calling the model when no fragments are supplied', async () => {
    const generateObjectSpy = vi.fn(async (_params: unknown) => {
      throw new Error('generateObject should not be called');
    });
    const generateObject = (async (params) =>
      generateObjectSpy(params)) as LLMClient['generateObject'];
    const agent = createConsolidationAgent({
      client: createStubClient(generateObject),
      prompts: await buildPrompts(),
    });

    await expect(agent.consolidate([])).resolves.toEqual({ fragments: [], claims: [] });
    expect(generateObjectSpy).not.toHaveBeenCalled();
  });

  it('sends serialized fragments and signal to the consolidation model', async () => {
    const controller = new AbortController();
    const generateObjectSpy = vi.fn(async (_params: unknown) => {
      return {
        object: {
          fragments: [{ kind: 'factual', content: 'Merged fact', confidence: 0.8 }],
          claims: [{ kind: 'factual', content: 'Merged fact', confidence: 0.8 }],
        },
      };
    });
    const generateObject = (async (params) =>
      generateObjectSpy(params)) as LLMClient['generateObject'];
    const agent = createConsolidationAgent({
      client: createStubClient(generateObject),
      prompts: await buildPrompts(),
    });

    await expect(
      agent.consolidate([sampleFragment], { signal: controller.signal }),
    ).resolves.toEqual({
      fragments: [{ kind: 'factual', content: 'Merged fact', confidence: 0.8 }],
      claims: [{ kind: 'factual', content: 'Merged fact', confidence: 0.8 }],
    });
    expect(generateObjectSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: consolidationOutputSchema,
        prompt: expect.stringContaining('"materialId":"material-1"'),
        context: expect.objectContaining({
          promptId: 'consolidation',
          promptVersion: '1.test',
          signal: controller.signal,
        }),
      }),
    );
  });
});
