import type { GenerateObjectResult, ModelMessage } from 'ai';
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
  {
    mode: 'abstention',
    answer: '',
    clarificationQuestion: null,
    citedEvidenceIds: [],
    reflectionSignals: [],
  },
  {
    mode: 'clarification',
    answer: '',
    clarificationQuestion: 'Could you provide more detail?',
    citedEvidenceIds: [],
    reflectionSignals: [],
  },
  {
    allowed: true,
    reason: 'Mock grounding review allowed the draft.',
    repairedMode: null,
    repairedAnswer: '',
    repairedClarificationQuestion: null,
    repairedCitedEvidenceIds: [],
  },
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

const promptFromMessages = (messages: ModelMessage[]): string =>
  messages
    .map((message) => {
      const content =
        typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
      return `${message.role}: ${content}`;
    })
    .join('\n\n');

export const createMockLLMClient = (options: MockLLMClientOptions = {}): LLMClient => {
  const generateObject = (options.generateObject ??
    defaultGenerateObject) as LLMClient['generateObject'];
  return {
    modelId: options.modelId ?? 'mock-model',
    extractionVersion: options.extractionVersion ?? 'mock-1',
    generateText: options.generateText ?? defaultGenerateText,
    streamText: options.streamText ?? defaultStreamText,
    generateObject,
    generateObjectFromMessages: ((params) =>
      generateObject({
        ...params,
        system: '',
        prompt: promptFromMessages(params.messages),
      })) as LLMClient['generateObjectFromMessages'],
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
      const fragments = (fragmentsByKind[kind] ?? []).map((fragment) =>
        fragmentForKind(kind, fragment.content, fragment.confidence, fragment),
      );
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
  const marker = prompt.includes('They just said: ') ? 'They just said: ' : 'Latest user message: ';
  const start = prompt.indexOf(marker);
  if (start === -1) {
    return 'Grounded answer.';
  }
  const tail = prompt.slice(start + marker.length);
  const stop = tail.indexOf('\n');
  const userText = (stop === -1 ? tail : tail.slice(0, stop)).trim();
  return userText.length > 0 ? `Grounded answer for "${userText}".` : 'Grounded answer.';
};

const evidenceIsEmpty = (prompt: string): boolean =>
  prompt.includes('(no evidence retrieved)') || prompt.includes('(nothing on this topic)');

const extractEvidenceIds = (prompt: string): string[] => {
  const matches = prompt.matchAll(/(?:^|\n)-\s+(?:id=([^\s]+)\s+score=|\[([^\]]+)\])/g);
  return Array.from(matches, (match) => match[1] ?? match[2] ?? '').filter((id) => id.length > 0);
};

const fragmentForKind = (
  kind: string,
  content: string,
  confidence: number,
  overrides: Record<string, unknown> = {},
) => {
  const base = {
    ...overrides,
    content,
    confidence,
    evidenceSpan:
      typeof overrides.evidenceSpan === 'string' || overrides.evidenceSpan === null
        ? overrides.evidenceSpan
        : 'whole-material',
  };

  if (kind === 'factual') {
    return {
      ...base,
      entities: Array.isArray(overrides.entities) ? overrides.entities : [],
      subject: typeof overrides.subject === 'string' ? overrides.subject : null,
      predicate: typeof overrides.predicate === 'string' ? overrides.predicate : null,
      object: typeof overrides.object === 'string' ? overrides.object : null,
    };
  }

  if (kind === 'style') {
    return {
      ...base,
      toneMarkers: Array.isArray(overrides.toneMarkers) ? overrides.toneMarkers : [content],
      exampleQuote:
        typeof overrides.exampleQuote === 'string' || overrides.exampleQuote === null
          ? overrides.exampleQuote
          : content,
    };
  }

  if (kind === 'behavior') {
    return {
      ...base,
      pattern: typeof overrides.pattern === 'string' ? overrides.pattern : content,
      instances: Array.isArray(overrides.instances) ? overrides.instances : ['whole-material'],
    };
  }

  return {
    ...base,
    tradeoff: typeof overrides.tradeoff === 'string' ? overrides.tradeoff : null,
    heuristic: typeof overrides.heuristic === 'string' ? overrides.heuristic : content,
  };
};

const consolidationFragmentsFromPrompt = (prompt: string): Array<Record<string, unknown>> => {
  const marker = 'Raw learner outputs (one JSON object per line):';
  const start = prompt.indexOf(marker);
  if (start === -1) {
    return [];
  }

  const lines = prompt
    .slice(start + marker.length)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('{') && line.endsWith('}'));

  return lines.flatMap((line) => {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const kind = typeof parsed.kind === 'string' ? parsed.kind : 'factual';
      const content = typeof parsed.content === 'string' ? parsed.content : '';
      const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.5;
      if (content.length === 0) {
        return [];
      }

      return [
        {
          kind,
          content,
          confidence,
          authorities: typeof parsed.authority === 'string' ? [parsed.authority] : [],
          sourceMaterialIds: typeof parsed.materialId === 'string' ? [parsed.materialId] : [],
          evidenceSpans: typeof parsed.evidenceSpan === 'string' ? [parsed.evidenceSpan] : [],
          status: confidence >= 0.6 ? 'claim' : 'fragment',
        },
      ];
    } catch {
      return [];
    }
  });
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
      if (kind === 'query-grounding-review') {
        const parsed = schema.safeParse({
          allowed: true,
          reason: 'Mock grounding review allowed the draft.',
          repairedMode: null,
          repairedAnswer: '',
          repairedClarificationQuestion: null,
          repairedCitedEvidenceIds: [],
        });
        return {
          object: parsed.success ? parsed.data : fallbackForSchema(schema),
        } as GenerateObjectResult<unknown>;
      }
      if (kind === 'query') {
        if (evidenceIsEmpty(prompt)) {
          const parsed = schema.safeParse({
            mode: 'abstention',
            answer: '',
            clarificationQuestion: null,
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
          clarificationQuestion: null,
          citedEvidenceIds: extractEvidenceIds(prompt),
          reflectionSignals: [],
        });
        return {
          object: parsed.success ? parsed.data : fallbackForSchema(schema),
        } as GenerateObjectResult<unknown>;
      }
      if (kind === 'consolidation') {
        const parsed = schema.safeParse({
          fragments: consolidationFragmentsFromPrompt(prompt),
          claims: [],
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
          ? sentences.map((sentence) => fragmentForKind(kind, sentence, 0.8))
          : [fragmentForKind(kind, `${kind}-pattern: ${sentences[0]}`, 0.65)];
      const parsed = schema.safeParse({ fragments });
      const object = parsed.success ? parsed.data : fallbackForSchema(schema);
      return { object } as GenerateObjectResult<unknown>;
    },
  });
