import { MockLanguageModelV3 } from 'ai/test';
import { describe, expect, it } from 'vitest';

import {
  createLLMClient,
  createLLMClientFromConfig,
  LLMConfigurationError,
} from '../src/llm/client';

// biome-ignore lint/suspicious/noExplicitAny: ai/test's MockLanguageModelV3 narrows doGenerate's tagged-union return to a brand we don't have access to.
type MockGenerate = (...args: unknown[]) => Promise<any>;

const buildMockModel = (text = 'mock answer') =>
  new MockLanguageModelV3({
    doGenerate: (async () => ({
      content: [{ type: 'text', text }],
      finishReason: 'stop',
      usage: { inputTokens: 5, outputTokens: 4, totalTokens: 9 },
      warnings: [],
    })) as MockGenerate,
  });

describe('createLLMClient', () => {
  it('throws if apiKey missing', () => {
    expect(() =>
      createLLMClient({
        apiKey: '',
        modelId: 'mock',
        temperature: 0.2,
        modelFactory: () => buildMockModel(),
      }),
    ).toThrow(LLMConfigurationError);
  });

  it('throws if modelId missing', () => {
    expect(() =>
      createLLMClient({
        apiKey: 'k',
        modelId: '',
        temperature: 0.2,
        modelFactory: () => buildMockModel(),
      }),
    ).toThrow(LLMConfigurationError);
  });

  it('runs generateText against an injected model', async () => {
    const client = createLLMClient({
      apiKey: 'k',
      modelId: 'mock',
      temperature: 0.2,
      modelFactory: () => buildMockModel('hello world'),
    });

    const result = await client.generateText({
      system: 'sys',
      prompt: 'hi',
      context: { promptId: 'query', promptVersion: '1' },
    });

    expect(result.text).toBe('hello world');
    expect(client.modelId).toBe('mock');
    expect(client.extractionVersion).toBe('1');
  });
});

describe('createLLMClientFromConfig', () => {
  const baseConfig = {
    persona: { id: 'primary', displayName: 'Primary' },
    ai: {
      model: 'gpt-test',
      temperature: 0.2,
      promptOverrides: {},
      maxConcurrency: 4,
    },
    safety: {
      defaults: { read: 'allow' as const, write: 'deny' as const, execute: 'deny' as const },
      hardDeny: [],
    },
    denseMem: {
      baseUrl: 'http://localhost:8080',
      apiKey: 'dm',
      namespace: 'test',
      timeoutMs: 8000,
    },
    maintenance: {
      enabled: false,
      timezone: 'UTC',
      intervalMs: 21_600_000,
    },
    connectors: {},
  };

  it('throws when neither config.ai.apiKey nor env DIGITAL_LIFE_AI_API_KEY is set', () => {
    expect(() => createLLMClientFromConfig(baseConfig, {})).toThrow(LLMConfigurationError);
  });

  it('uses env DIGITAL_LIFE_AI_API_KEY when config has no apiKey', () => {
    expect(() =>
      createLLMClientFromConfig(baseConfig, {
        DIGITAL_LIFE_AI_API_KEY: 'env-key',
      } as NodeJS.ProcessEnv),
    ).not.toThrow();
  });

  it('threads extraction version from env', () => {
    const client = createLLMClientFromConfig(baseConfig, {
      DIGITAL_LIFE_AI_API_KEY: 'env-key',
      DIGITAL_LIFE_EXTRACTION_VERSION: '7',
    } as NodeJS.ProcessEnv);
    expect(client.extractionVersion).toBe('7');
  });
});
