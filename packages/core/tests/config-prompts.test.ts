import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadPromptOverrideContents } from '../src/config/prompts';

describe('loadPromptOverrideContents', () => {
  it('loads configured prompt files by prompt id', async () => {
    const root = await mkdtemp(join(tmpdir(), 'digital-life-prompts-'));
    const systemPromptPath = join(root, 'system.md');
    await writeFile(systemPromptPath, 'Use grounded evidence.');

    const prompts = await loadPromptOverrideContents({
      ai: {
        model: 'gpt-test',
        promptOverrides: {
          system: systemPromptPath,
        },
        temperature: 0.2,
        maxConcurrency: 4,
      },
      connectors: {},
      denseMem: {
        apiKey: 'test-api-key',
        baseUrl: 'http://localhost:8081',
        namespace: 'digital-life',
        timeoutMs: 5000,
      },
      persona: {
        displayName: 'Digital Life',
        id: 'primary',
      },
      safety: {
        defaults: {
          execute: 'deny',
          read: 'allow',
          write: 'deny',
        },
        hardDeny: [],
      },
      maintenance: {
        enabled: false,
        timezone: 'UTC',
        intervalMs: 21_600_000,
      },
    });

    expect(prompts).toEqual({
      system: 'Use grounded evidence.',
    });
  });
});
