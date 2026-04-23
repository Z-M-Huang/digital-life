import { createHash } from 'node:crypto';
import type { LearnedFragment } from '@digital-life/agents';
import type { DenseMemFact } from '@digital-life/core';

export type ConsolidatedFragment = DenseMemFact & {
  sourceCount: number;
};

const fragmentIdentity = (fragment: LearnedFragment): string =>
  `${fragment.kind}:${fragment.content.trim().toLowerCase()}`;

export const consolidateLearnedFragments = (
  fragments: LearnedFragment[],
): ConsolidatedFragment[] => {
  const grouped = new Map<string, LearnedFragment[]>();

  for (const fragment of fragments) {
    const identity = fragmentIdentity(fragment);
    const existing = grouped.get(identity) ?? [];
    grouped.set(identity, [...existing, fragment]);
  }

  return Array.from(grouped.entries()).map(([identity, groupedFragments]) => ({
    id: createHash('sha256').update(identity).digest('hex'),
    content: groupedFragments[0]?.content ?? '',
    provenance: {
      authority: 'learner',
      entries: groupedFragments.map((fragment) => fragment.provenance),
      kind: groupedFragments[0]?.kind ?? 'factual',
      sources: Array.from(new Set(groupedFragments.map((fragment) => fragment.provenance.source))),
    },
    sourceCount: groupedFragments.length,
  }));
};
