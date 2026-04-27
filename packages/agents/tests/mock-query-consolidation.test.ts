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
    expect(prompt.prompt).toContain('(no evidence retrieved)');
    expect(prompt.prompt).toContain('Persona slices: (none yet)');
  });

  it('passes formatted prompt content and signal into generateObject', async () => {
    const controller = new AbortController();
    const generateObjectSpy = vi.fn(async (_params: unknown) => {
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
        signal: controller.signal,
      }),
    ).resolves.toMatchObject({
      mode: 'grounded',
      answer: 'Grounded answer.',
      citedEvidenceIds: ['fact-1'],
    });

    expect(generateObjectSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('id=fact-1 score=0.91 kind=factual: Repository fact.'),
        context: expect.objectContaining({
          promptId: 'query',
          promptVersion: '1.test',
          signal: controller.signal,
        }),
      }),
    );
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
