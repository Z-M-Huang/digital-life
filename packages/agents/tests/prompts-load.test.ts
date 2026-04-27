import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  loadBuiltinPrompts,
  loadPromptOverrides,
  loadPrompts,
  PROMPT_IDS,
} from '../src/prompts/load';

const minimalConfig = (overrides: Record<string, string> = {}) => ({
  persona: { id: 'primary', displayName: 'Primary' },
  ai: {
    model: 'm',
    temperature: 0.2,
    promptOverrides: overrides,
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
});

describe('builtin prompts', () => {
  it('loads all 7 prompts with non-empty content', async () => {
    const prompts = await loadBuiltinPrompts();
    for (const id of PROMPT_IDS) {
      expect(prompts[id]).toBeDefined();
      expect(prompts[id].length).toBeGreaterThan(50);
    }
  });

  it('loads overrides from disk and ignores unknown ids', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dl-prompts-'));
    const overridePath = join(dir, 'factual.md');
    writeFileSync(overridePath, 'CUSTOM FACTUAL PROMPT');

    const overrides = await loadPromptOverrides({
      factual: overridePath,
      mystery: '/nonexistent.md',
    });

    expect(overrides.factual).toBe('CUSTOM FACTUAL PROMPT');
    expect((overrides as Record<string, string>).mystery).toBeUndefined();
  });
});

describe('loadPrompts', () => {
  it('overrides win over builtin', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dl-prompts-'));
    const overridePath = join(dir, 'factual.md');
    writeFileSync(overridePath, 'CUSTOM FACTUAL PROMPT');

    const bundle = await loadPrompts(minimalConfig({ factual: overridePath }));
    expect(bundle.factual).toBe('CUSTOM FACTUAL PROMPT');
    expect(bundle.style.length).toBeGreaterThan(0);
  });

  it('promptVersion changes when prompt content changes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dl-prompts-'));
    const a = join(dir, 'factual.md');
    const b = join(dir, 'factual-b.md');
    writeFileSync(a, 'AAA');
    writeFileSync(b, 'BBB');

    const bundleA = await loadPrompts(minimalConfig({ factual: a }));
    const bundleB = await loadPrompts(minimalConfig({ factual: b }));

    expect(bundleA.promptVersion).not.toBe(bundleB.promptVersion);
  });

  it('promptVersion threads the base version through', async () => {
    const bundle = await loadPrompts(minimalConfig(), { baseVersion: '7' });
    expect(bundle.promptVersion.startsWith('7.')).toBe(true);
  });
});
