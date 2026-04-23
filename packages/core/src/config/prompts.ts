import { readFile } from 'node:fs/promises';

import type { DigitalLifeConfig } from './schema';

export const loadPromptOverrideContents = async (
  config: DigitalLifeConfig,
): Promise<Record<string, string>> => {
  const promptEntries = await Promise.all(
    Object.entries(config.ai.promptOverrides).map(async ([promptId, promptPath]) => [
      promptId,
      await readFile(promptPath, 'utf8'),
    ]),
  );

  return Object.fromEntries(promptEntries);
};
