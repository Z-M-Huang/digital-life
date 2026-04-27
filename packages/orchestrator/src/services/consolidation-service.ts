import { createHash } from 'node:crypto';
import type { ClaimPayload, ConsolidationAgent, LearnedFragment } from '@digital-life/agents';
import type { DenseMemFact } from '@digital-life/core';

export type ConsolidatedFragment = DenseMemFact & {
  confidence: number;
  kind: LearnedFragment['kind'];
  authorities: string[];
  status: 'fragment' | 'claim' | 'disputed';
  claim?: ClaimPayload;
  sourceCount: number;
};

const fragmentIdentity = (fragment: LearnedFragment): string =>
  `${fragment.kind}:${fragment.content.trim().toLowerCase()}`;

const computeId = (identity: string): string => createHash('sha256').update(identity).digest('hex');

const uniq = (values: readonly string[]): string[] =>
  Array.from(new Set(values.filter((value) => value.length > 0)));

const fallbackProvenance = (groupedFragments: LearnedFragment[]): Record<string, unknown> => {
  const sample = groupedFragments[0];
  return {
    kind: sample?.kind ?? 'factual',
    sources: uniq(groupedFragments.map((fragment) => fragment.provenance.source)),
    authorities: uniq(groupedFragments.map((fragment) => fragment.authority)),
    materialIds: uniq(groupedFragments.map((fragment) => fragment.provenance.materialId)),
    extraction: sample?.provenance.extraction,
    entries: groupedFragments.map((fragment) => fragment.provenance),
  };
};

const heuristicConsolidate = (fragments: LearnedFragment[]): ConsolidatedFragment[] => {
  const grouped = new Map<string, LearnedFragment[]>();
  for (const fragment of fragments) {
    const identity = fragmentIdentity(fragment);
    const existing = grouped.get(identity) ?? [];
    grouped.set(identity, [...existing, fragment]);
  }

  return Array.from(grouped.entries()).map(([identity, groupedFragments]) => {
    const lead = groupedFragments[0];
    const confidence = groupedFragments.reduce(
      (max, fragment) => Math.max(max, fragment.confidence),
      0,
    );
    return {
      id: computeId(identity),
      content: lead?.content ?? '',
      confidence,
      kind: lead?.kind ?? 'factual',
      authorities: uniq(groupedFragments.map((fragment) => fragment.authority)),
      status: confidence >= 0.6 ? ('claim' as const) : ('fragment' as const),
      provenance: fallbackProvenance(groupedFragments),
      sourceCount: groupedFragments.length,
    };
  });
};

const matchAuthorities = (fragments: LearnedFragment[], content: string): string[] => {
  const matches = fragments.filter((fragment) => fragment.content === content);
  if (matches.length === 0) {
    return uniq(fragments.map((fragment) => fragment.authority));
  }
  return uniq(matches.map((fragment) => fragment.authority));
};

const matchSources = (fragments: LearnedFragment[], kind: LearnedFragment['kind']): string[] =>
  uniq(
    fragments
      .filter((fragment) => fragment.kind === kind)
      .map((fragment) => fragment.provenance.source),
  );

export type ConsolidateOptions = {
  agent?: ConsolidationAgent;
  signal?: AbortSignal;
};

export const consolidateLearnedFragments = async (
  fragments: LearnedFragment[],
  options: ConsolidateOptions = {},
): Promise<ConsolidatedFragment[]> => {
  if (fragments.length === 0) {
    return [];
  }

  if (!options.agent) {
    return heuristicConsolidate(fragments);
  }

  const result = await options.agent.consolidate(
    fragments,
    options.signal ? { signal: options.signal } : undefined,
  );
  const consolidated: ConsolidatedFragment[] = [];

  for (const fragment of result.fragments) {
    const identity = `${fragment.kind}:${fragment.content.trim().toLowerCase()}`;
    consolidated.push({
      id: computeId(identity),
      content: fragment.content,
      confidence: fragment.confidence,
      kind: fragment.kind,
      authorities: fragment.authorities.length
        ? fragment.authorities
        : matchAuthorities(fragments, fragment.content),
      status: fragment.status,
      provenance: {
        kind: fragment.kind,
        sources: matchSources(fragments, fragment.kind),
        authorities: fragment.authorities,
        sourceMaterialIds: fragment.sourceMaterialIds,
        evidenceSpans: fragment.evidenceSpans,
        extraction: fragments[0]?.provenance.extraction,
      },
      sourceCount: fragment.sourceMaterialIds.length || 1,
    });
  }

  for (const claim of result.claims) {
    const identity = `${claim.kind}:claim:${claim.content.trim().toLowerCase()}`;
    consolidated.push({
      id: computeId(identity),
      content: claim.content,
      confidence: claim.confidence,
      kind: claim.kind,
      authorities: matchAuthorities(fragments, claim.content),
      status: claim.status === 'disputed' ? 'disputed' : 'claim',
      claim,
      provenance: {
        kind: claim.kind,
        subject: claim.subject,
        predicate: claim.predicate,
        object: claim.object,
        sources: matchSources(fragments, claim.kind),
        extraction: fragments[0]?.provenance.extraction,
      },
      sourceCount: 1,
    });
  }

  return consolidated.length > 0 ? consolidated : heuristicConsolidate(fragments);
};

export { heuristicConsolidate };
