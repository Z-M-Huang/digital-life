import type {
  KnowledgeFactRecord,
  KnowledgeRepository,
} from '../repositories/knowledge-repository';
import type { ConsolidatedFragment } from './consolidation-service';

export type KnowledgeSearchResult = {
  connectorIds: string[];
  content: string;
  id: string;
  kind: string;
  score: number;
  sourceCount: number;
  sourceIds: string[];
  updatedAt: Date;
};

export type EvidenceCommunity = {
  connectorIds: string[];
  factCount: number;
  id: string;
  kinds: string[];
  label: string;
  sourceIds: string[];
};

const normalize = (value: string): string => value.trim().toLowerCase();

const tokenize = (value: string): string[] =>
  normalize(value)
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length > 1);

const scoreFact = (fact: KnowledgeFactRecord, query: string): number => {
  if (query.length === 0) {
    return 0;
  }

  const normalizedQuery = normalize(query);
  const queryTokens = new Set(tokenize(query));
  const content = normalize(fact.content);
  const contentTokens = new Set(tokenize(fact.content));
  let score = 0;

  if (content.includes(normalizedQuery)) {
    score += 6;
  }

  for (const token of queryTokens) {
    if (contentTokens.has(token)) {
      score += 2;
    }
  }

  if (fact.kind.includes(normalizedQuery)) {
    score += 1;
  }

  return score;
};

const compareSearchResults = (left: KnowledgeSearchResult, right: KnowledgeSearchResult): number =>
  right.score - left.score || right.updatedAt.valueOf() - left.updatedAt.valueOf();

const buildCommunityLabel = (fact: KnowledgeFactRecord): string => {
  const connectorLabel = fact.connectorIds[0] ?? 'unscoped';
  return `${connectorLabel} ${fact.kind}`.trim();
};

export class KnowledgeService {
  constructor(private readonly repository: KnowledgeRepository) {}

  async getFact(id: string): Promise<KnowledgeFactRecord | null> {
    return this.repository.getFact(id);
  }

  async listCommunities(): Promise<EvidenceCommunity[]> {
    const facts = await this.repository.listFacts();
    const grouped = new Map<string, KnowledgeFactRecord[]>();

    for (const fact of facts) {
      const key = `${fact.connectorIds.join(',')}:${fact.kind}`;
      const existing = grouped.get(key) ?? [];
      grouped.set(key, [...existing, fact]);
    }

    return Array.from(grouped.entries())
      .map(([id, groupedFacts]) => {
        const seedFact = groupedFacts.find(Boolean);
        if (!seedFact) {
          return null;
        }

        return {
          connectorIds: Array.from(
            new Set(groupedFacts.flatMap((fact) => fact.connectorIds).filter(Boolean)),
          ),
          factCount: groupedFacts.length,
          id,
          kinds: Array.from(new Set(groupedFacts.map((fact) => fact.kind))),
          label: buildCommunityLabel(seedFact),
          sourceIds: Array.from(new Set(groupedFacts.flatMap((fact) => fact.sourceIds))),
        };
      })
      .filter((community): community is EvidenceCommunity => Boolean(community))
      .sort(
        (left, right) => right.factCount - left.factCount || left.label.localeCompare(right.label),
      );
  }

  async persistFacts(
    runId: string,
    fragments: ConsolidatedFragment[],
  ): Promise<KnowledgeFactRecord[]> {
    if (fragments.length === 0) {
      return [];
    }

    return this.repository.saveFacts(runId, fragments);
  }

  async search(query: string, limit = 10): Promise<KnowledgeSearchResult[]> {
    const facts = await this.repository.listFacts();
    const results = facts.map((fact) => ({
      connectorIds: fact.connectorIds,
      content: fact.content,
      id: fact.id,
      kind: fact.kind,
      score: scoreFact(fact, query),
      sourceCount: fact.sourceCount,
      sourceIds: fact.sourceIds,
      updatedAt: fact.updatedAt,
    }));

    return results
      .filter((result) => query.trim().length === 0 || result.score > 0)
      .sort(compareSearchResults)
      .slice(0, limit);
  }
}
