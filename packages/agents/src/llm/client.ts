import { createOpenAI } from '@ai-sdk/openai';
import type { DigitalLifeConfig } from '@digital-life/core';
import { compactMessages } from 'agentool/context-compaction';
import {
  generateObject as aiGenerateObject,
  generateText as aiGenerateText,
  streamText as aiStreamText,
  type GenerateObjectResult,
  type LanguageModel,
  type ModelMessage,
} from 'ai';
import type { z } from 'zod';

type GenerateTextOutput = Awaited<ReturnType<typeof aiGenerateText>>;
type StreamTextOutput = ReturnType<typeof aiStreamText>;
const DEFAULT_MAX_CONTEXT_TOKENS = 128_000;
const RECENT_MESSAGES_TO_KEEP = 8;

export type LLMClientOptions = {
  apiKey: string;
  baseUrl?: string;
  modelId: string;
  temperature: number;
  maxOutputTokens?: number;
  maxContextTokens?: number;
  extractionVersion?: string;
  modelFactory?: (options: LLMClientOptions) => LanguageModel;
};

export type LLMCallContext = {
  promptId: string;
  promptVersion: string;
  signal?: AbortSignal;
};

export type LLMClient = {
  modelId: string;
  extractionVersion: string;
  generateText: (params: {
    system: string;
    prompt: string;
    context: LLMCallContext;
  }) => Promise<GenerateTextOutput>;
  streamText: (params: {
    system: string;
    prompt: string;
    context: LLMCallContext;
  }) => StreamTextOutput;
  generateObject: <TSchema extends z.ZodTypeAny>(params: {
    system: string;
    prompt: string;
    schema: TSchema;
    context: LLMCallContext;
  }) => Promise<GenerateObjectResult<z.infer<TSchema>>>;
  generateObjectFromMessages: <TSchema extends z.ZodTypeAny>(params: {
    messages: ModelMessage[];
    schema: TSchema;
    context: LLMCallContext;
  }) => Promise<GenerateObjectResult<z.infer<TSchema>>>;
};

export class LLMConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LLMConfigurationError';
  }
}

const buildModel = (options: LLMClientOptions): LanguageModel => {
  const provider = createOpenAI({
    apiKey: options.apiKey,
    ...(options.baseUrl ? { baseURL: options.baseUrl } : {}),
  });
  return provider.chat(options.modelId);
};

export const createLLMClient = (options: LLMClientOptions): LLMClient => {
  if (!options.apiKey) {
    throw new LLMConfigurationError('LLM apiKey is required.');
  }
  if (!options.modelId) {
    throw new LLMConfigurationError('LLM modelId is required.');
  }

  const model = options.modelFactory ? options.modelFactory(options) : buildModel(options);
  const extractionVersion = options.extractionVersion ?? '1';
  const maxContextTokens = options.maxContextTokens ?? DEFAULT_MAX_CONTEXT_TOKENS;

  const compactForContext = (messages: ModelMessage[], context: LLMCallContext) =>
    compactMessages({
      messages,
      maxContextTokens,
      keepRecentMessages: RECENT_MESSAGES_TO_KEEP,
      onCompactionFailure: 'passthrough',
      summarize: async (olderHistory, targetTokens) => {
        const result = await aiGenerateText({
          model,
          system: [
            'Summarize the older chat history for continuation.',
            'Preserve user intent, decisions, commitments, unresolved questions, and facts needed later.',
            'Do not invent details. Keep the summary concise.',
          ].join(' '),
          messages: olderHistory,
          temperature: 0,
          maxOutputTokens: targetTokens,
          ...(context.signal ? { abortSignal: context.signal } : {}),
        });
        return result.text;
      },
    });

  return {
    modelId: options.modelId,
    extractionVersion,
    async generateText({ system, prompt, context }) {
      return aiGenerateText({
        model,
        system,
        prompt,
        temperature: options.temperature,
        ...(options.maxOutputTokens ? { maxOutputTokens: options.maxOutputTokens } : {}),
        ...(context.signal ? { abortSignal: context.signal } : {}),
      });
    },
    streamText({ system, prompt, context }) {
      return aiStreamText({
        model,
        system,
        prompt,
        temperature: options.temperature,
        ...(options.maxOutputTokens ? { maxOutputTokens: options.maxOutputTokens } : {}),
        ...(context.signal ? { abortSignal: context.signal } : {}),
      });
    },
    async generateObject({ system, prompt, schema, context }) {
      return aiGenerateObject({
        model,
        system,
        prompt,
        schema,
        temperature: options.temperature,
        ...(options.maxOutputTokens ? { maxOutputTokens: options.maxOutputTokens } : {}),
        ...(context.signal ? { abortSignal: context.signal } : {}),
      });
    },
    async generateObjectFromMessages({ messages, schema, context }) {
      const compactedMessages = await compactForContext(messages, context);
      return aiGenerateObject({
        model,
        messages: compactedMessages,
        schema,
        temperature: options.temperature,
        ...(options.maxOutputTokens ? { maxOutputTokens: options.maxOutputTokens } : {}),
        ...(context.signal ? { abortSignal: context.signal } : {}),
      });
    },
  };
};

const resolveApiKey = (
  config: DigitalLifeConfig['ai'],
  env: NodeJS.ProcessEnv,
): string | undefined => config.apiKey ?? env.DIGITAL_LIFE_AI_API_KEY;

const resolveBaseUrl = (
  config: DigitalLifeConfig['ai'],
  env: NodeJS.ProcessEnv,
): string | undefined => config.baseUrl ?? env.DIGITAL_LIFE_AI_BASE_URL;

export const createLLMClientFromConfig = (
  config: DigitalLifeConfig,
  env: NodeJS.ProcessEnv = process.env,
): LLMClient => {
  const apiKey = resolveApiKey(config.ai, env);
  if (!apiKey) {
    throw new LLMConfigurationError(
      'LLM apiKey is required (config.ai.apiKey or DIGITAL_LIFE_AI_API_KEY).',
    );
  }

  const baseUrl = resolveBaseUrl(config.ai, env);
  return createLLMClient({
    apiKey,
    ...(baseUrl ? { baseUrl } : {}),
    modelId: config.ai.model,
    temperature: config.ai.temperature,
    ...(config.ai.maxOutputTokens ? { maxOutputTokens: config.ai.maxOutputTokens } : {}),
    extractionVersion: env.DIGITAL_LIFE_EXTRACTION_VERSION ?? '1',
  });
};
