import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { DigitalLifeConfig } from '@digital-life/core';

export const PROMPT_IDS = [
  'factual',
  'style',
  'behavior',
  'reasoning',
  'query',
  'reflection',
  'consolidation',
] as const;

export type PromptId = (typeof PROMPT_IDS)[number];

export type PromptBundle = Record<PromptId, string> & {
  promptVersion: string;
};

const builtinPath = (id: PromptId): string => fileURLToPath(new URL(`./${id}.md`, import.meta.url));

const fnv1a = (input: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

export const loadBuiltinPrompts = async (): Promise<Record<PromptId, string>> => {
  const entries = await Promise.all(
    PROMPT_IDS.map(async (id) => {
      const text = await readFile(builtinPath(id), 'utf8');
      return [id, text] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<PromptId, string>;
};

export const loadPromptOverrides = async (
  promptOverrides: DigitalLifeConfig['ai']['promptOverrides'],
): Promise<Partial<Record<PromptId, string>>> => {
  const entries = await Promise.all(
    Object.entries(promptOverrides)
      .filter((entry): entry is [PromptId, string] =>
        (PROMPT_IDS as readonly string[]).includes(entry[0]),
      )
      .map(async ([id, path]) => [id, await readFile(path, 'utf8')] as const),
  );
  return Object.fromEntries(entries) as Partial<Record<PromptId, string>>;
};

const computePromptVersion = (prompts: Record<PromptId, string>, baseVersion: string): string => {
  const composite = PROMPT_IDS.map((id) => `${id}:${prompts[id]}`).join('\n---\n');
  return `${baseVersion}.${fnv1a(composite)}`;
};

export const loadPrompts = async (
  config: DigitalLifeConfig,
  options: { baseVersion?: string } = {},
): Promise<PromptBundle> => {
  const baseVersion = options.baseVersion ?? '1';
  const builtin = await loadBuiltinPrompts();
  const overrides = await loadPromptOverrides(config.ai.promptOverrides);
  const merged = { ...builtin, ...overrides } as Record<PromptId, string>;
  const promptVersion = computePromptVersion(merged, baseVersion);
  return { ...merged, promptVersion };
};
