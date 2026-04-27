import type { GenerateObjectResult } from 'ai';
import type { z } from 'zod';

import type { LLMCallContext, LLMClient } from './client';

type MockObjectHandler = (params: {
  system: string;
  prompt: string;
  schema: z.ZodTypeAny;
  context: LLMCallContext;
}) => Promise<GenerateObjectResult<unknown>>;

export type MockLLMClientOptions = {
  modelId?: string;
  extractionVersion?: string;
  generateText?: LLMClient['generateText'];
  streamText?: LLMClient['streamText'];
  generateObject?: MockObjectHandler;
};

const defaultGenerateText: LLMClient['generateText'] = async () =>
  ({
    text: 'mock answer',
  }) as unknown as Awaited<ReturnType<LLMClient['generateText']>>;

const defaultStreamText: LLMClient['streamText'] = () =>
  ({
    textStream: (async function* () {
      yield 'mock answer';
    })(),
  }) as unknown as ReturnType<LLMClient['streamText']>;

const FALLBACK_OBJECTS: ReadonlyArray<Record<string, unknown>> = [
  {},
  { fragments: [] },
  { mode: 'abstention', answer: '', citedEvidenceIds: [], reflectionSignals: [] },
  { mode: 'clarification', answer: '', clarificationQuestion: 'Could you provide more detail?' },
  { items: [] },
];

const fallbackForSchema = <TSchema extends z.ZodTypeAny>(schema: TSchema): unknown => {
  for (const candidate of FALLBACK_OBJECTS) {
    const parsed = schema.safeParse(candidate);
    if (parsed.success) {
      return parsed.data;
    }
  }
  return undefined;
};

const defaultGenerateObject: MockObjectHandler = async ({ schema }) => {
  return { object: fallbackForSchema(schema) } as GenerateObjectResult<unknown>;
};

export const createMockLLMClient = (options: MockLLMClientOptions = {}): LLMClient => {
  return {
    modelId: options.modelId ?? 'mock-model',
    extractionVersion: options.extractionVersion ?? 'mock-1',
    generateText: options.generateText ?? defaultGenerateText,
    streamText: options.streamText ?? defaultStreamText,
    generateObject: (options.generateObject ??
      defaultGenerateObject) as LLMClient['generateObject'],
  };
};

export type CannedFragment = {
  content: string;
  confidence: number;
  evidenceSpan?: string;
  [key: string]: unknown;
};

export const createCannedLearnerClient = (
  fragmentsByKind: Partial<Record<string, CannedFragment[]>> = {},
): LLMClient =>
  createMockLLMClient({
    async generateObject({ context, schema }) {
      const kind = context.promptId;
      const fragments = fragmentsByKind[kind] ?? [];
      const parsed = schema.safeParse({ fragments });
      const object = parsed.success ? parsed.data : fallbackForSchema(schema);
      return { object } as GenerateObjectResult<unknown>;
    },
  });

const FACTUAL_KINDS: ReadonlySet<string> = new Set(['factual', 'style', 'behavior', 'reasoning']);

const extractMaterialText = (prompt: string): string => {
  const marker = 'Material text:';
  const index = prompt.indexOf(marker);
  if (index === -1) {
    return prompt;
  }
  const tail = prompt.slice(index + marker.length).trim();
  const stop = tail.indexOf('\n\nReturn a single JSON');
  return stop === -1 ? tail : tail.slice(0, stop).trim();
};

const sentenceFragments = (text: string): string[] =>
  text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);

/**
 * Mock LLM client that emits a confident "factual" fragment for each sentence in
 * the material text, and one lower-confidence fragment per other learner kind.
 * Useful for end-to-end orchestrator tests that expect non-empty learning output
 * without hitting a real model.
 */
const queryAnswerFromPrompt = (prompt: string): string => {
  const marker = 'Latest user message: ';
  const start = prompt.indexOf(marker);
  if (start === -1) {
    return 'Grounded answer.';
  }
  const tail = prompt.slice(start + marker.length);
  const stop = tail.indexOf('\n');
  const userText = (stop === -1 ? tail : tail.slice(0, stop)).trim();
  return userText.length > 0 ? `Grounded answer for "${userText}".` : 'Grounded answer.';
};

const evidenceIsEmpty = (prompt: string): boolean => prompt.includes('(no evidence retrieved)');

const extractEvidenceIds = (prompt: string): string[] => {
  const matches = prompt.matchAll(/(^|\n)-\s+id=([^\s]+)\s+score=/g);
  return Array.from(matches, (match) => match[2] ?? '').filter((id) => id.length > 0);
};

export const createPassthroughLearnerClient = (): LLMClient =>
  createMockLLMClient({
    streamText: ({ prompt }) =>
      ({
        textStream: (async function* () {
          yield queryAnswerFromPrompt(prompt);
        })(),
      }) as unknown as ReturnType<LLMClient['streamText']>,
    async generateObject({ context, prompt, schema }) {
      const kind = context.promptId;
      if (kind === 'query') {
        if (evidenceIsEmpty(prompt)) {
          const parsed = schema.safeParse({
            mode: 'abstention',
            answer: '',
            citedEvidenceIds: [],
            reflectionSignals: [],
          });
          return {
            object: parsed.success ? parsed.data : fallbackForSchema(schema),
          } as GenerateObjectResult<unknown>;
        }
        const answer = queryAnswerFromPrompt(prompt);
        const parsed = schema.safeParse({
          mode: 'grounded',
          answer,
          citedEvidenceIds: extractEvidenceIds(prompt),
          reflectionSignals: [],
        });
        return {
          object: parsed.success ? parsed.data : fallbackForSchema(schema),
        } as GenerateObjectResult<unknown>;
      }
      if (!FACTUAL_KINDS.has(kind)) {
        return { object: fallbackForSchema(schema) } as GenerateObjectResult<unknown>;
      }
      const sentences = sentenceFragments(extractMaterialText(prompt));
      if (sentences.length === 0) {
        return { object: fallbackForSchema(schema) } as GenerateObjectResult<unknown>;
      }
      const fragments =
        kind === 'factual'
          ? sentences.map((sentence) => ({
              content: sentence,
              confidence: 0.8,
              evidenceSpan: 'whole-material',
            }))
          : [
              {
                content: `${kind}-pattern: ${sentences[0]}`,
                confidence: 0.65,
                evidenceSpan: 'whole-material',
              },
            ];
      const parsed = schema.safeParse({ fragments });
      const object = parsed.success ? parsed.data : fallbackForSchema(schema);
      return { object } as GenerateObjectResult<unknown>;
    },
  });
