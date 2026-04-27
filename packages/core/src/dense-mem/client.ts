export type DenseMemFact = {
  id: string;
  content: string;
  provenance: Record<string, unknown>;
};

export type DenseMemFragmentInput = {
  content: string;
  authority?: string;
  classification?: string;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
};

export type DenseMemClaimInput = {
  fragmentIds?: string[];
  subject: string;
  predicate: string;
  object?: string;
  content: string;
  confidence: number;
  authority?: string;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
};

export type DenseMemClaimRecord = {
  id: string;
  status: 'candidate' | 'validated' | 'promoted' | 'rejected' | 'disputed' | 'superseded';
  subject?: string;
  predicate?: string;
  object?: string;
  content: string;
  confidence?: number;
};

export type DenseMemFactRecord = {
  id: string;
  content: string;
  truthScore?: number;
  validFrom?: string | null;
  validTo?: string | null;
  lastConfirmedAt?: string | null;
};

export type DenseMemRecallTier = '1' | '1.5' | '2';

export type DenseMemRecallResult = {
  id: string;
  tier: DenseMemRecallTier;
  content: string;
  score: number;
  metadata?: Record<string, unknown>;
};

export type DenseMemCommunitySummary = {
  id: string;
  level?: number;
  summary: string;
  topEntities?: string[];
  topPredicates?: string[];
  memberCount?: number;
};

export type DenseMemError = Error & { status?: number; body?: unknown };

export type DenseMemClient = {
  healthCheck: () => Promise<boolean>;
  postFragment: (input: DenseMemFragmentInput) => Promise<{ id: string }>;
  postClaim: (input: DenseMemClaimInput) => Promise<DenseMemClaimRecord>;
  verifyClaim: (claimId: string) => Promise<DenseMemClaimRecord>;
  promoteClaim: (claimId: string) => Promise<DenseMemFactRecord>;
  retractFragment: (fragmentId: string) => Promise<void>;
  recall: (query: string, options?: { limit?: number }) => Promise<DenseMemRecallResult[]>;
  searchSemantic: (query: string, options?: { limit?: number }) => Promise<DenseMemRecallResult[]>;
  getFact: (id: string) => Promise<DenseMemFactRecord | null>;
  listFacts: (options?: { limit?: number }) => Promise<DenseMemFactRecord[]>;
  listCommunities: () => Promise<DenseMemCommunitySummary[]>;
  getCommunitySummary: (id: string) => Promise<DenseMemCommunitySummary | null>;
};

export type DenseMemClientOptions = {
  baseUrl: string;
  apiKey?: string;
  fetcher?: typeof fetch;
  timeoutMs: number;
};

const denseMemError = (
  message: string,
  status: number | undefined,
  body: unknown,
): DenseMemError => {
  const error = new Error(message) as DenseMemError;
  if (typeof status === 'number') {
    error.status = status;
  }
  error.body = body;
  return error;
};

export const createDenseMemClient = ({
  baseUrl,
  apiKey,
  fetcher = fetch,
  timeoutMs,
}: DenseMemClientOptions): DenseMemClient => {
  const baseHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (apiKey) {
      headers.authorization = `Bearer ${apiKey}`;
    }
    return headers;
  };

  const withTimeout = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = { ...baseHeaders(), ...(init.headers as Record<string, string> | undefined) };
      return await fetcher(input, {
        ...init,
        headers,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  };

  const expectJson = async <T>(response: Response, label: string): Promise<T> => {
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        // leave as text
      }
      throw denseMemError(`${label} failed (${response.status})`, response.status, parsed);
    }
    return (await response.json()) as T;
  };

  return {
    async healthCheck() {
      try {
        const response = await withTimeout(`${baseUrl}/health`);
        return response.ok;
      } catch {
        return false;
      }
    },

    async postFragment(input) {
      const headers = input.idempotencyKey
        ? { 'idempotency-key': input.idempotencyKey }
        : undefined;
      const response = await withTimeout(`${baseUrl}/api/v1/fragments`, {
        method: 'POST',
        body: JSON.stringify({
          content: input.content,
          authority: input.authority,
          classification: input.classification,
          metadata: input.metadata ?? {},
        }),
        ...(headers ? { headers } : {}),
      });
      const data = await expectJson<{ id?: string; fragment_id?: string }>(
        response,
        'postFragment',
      );
      const id = data.id ?? data.fragment_id ?? '';
      if (!id) {
        throw denseMemError('postFragment returned no id', response.status, data);
      }
      return { id };
    },

    async postClaim(input) {
      const headers = input.idempotencyKey
        ? { 'idempotency-key': input.idempotencyKey }
        : undefined;
      const response = await withTimeout(`${baseUrl}/api/v1/claims`, {
        method: 'POST',
        body: JSON.stringify({
          subject: input.subject,
          predicate: input.predicate,
          object: input.object,
          content: input.content,
          confidence: input.confidence,
          authority: input.authority,
          supported_by: input.fragmentIds ?? [],
          metadata: input.metadata ?? {},
        }),
        ...(headers ? { headers } : {}),
      });
      return expectJson<DenseMemClaimRecord>(response, 'postClaim');
    },

    async verifyClaim(claimId) {
      const response = await withTimeout(`${baseUrl}/api/v1/claims/${claimId}/verify`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      return expectJson<DenseMemClaimRecord>(response, 'verifyClaim');
    },

    async promoteClaim(claimId) {
      const response = await withTimeout(`${baseUrl}/api/v1/claims/${claimId}/promote`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      return expectJson<DenseMemFactRecord>(response, 'promoteClaim');
    },

    async retractFragment(fragmentId) {
      const response = await withTimeout(`${baseUrl}/api/v1/fragments/${fragmentId}/retract`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        await expectJson(response, 'retractFragment');
      }
    },

    async recall(query, options = {}) {
      const limit = options.limit ?? 10;
      const url = `${baseUrl}/api/v1/recall?q=${encodeURIComponent(query)}&limit=${limit}`;
      const response = await withTimeout(url);
      const data = await expectJson<{ results: DenseMemRecallResult[] }>(response, 'recall');
      return data.results ?? [];
    },

    async searchSemantic(query, options = {}) {
      const response = await withTimeout(`${baseUrl}/api/v1/tools/semantic-search`, {
        method: 'POST',
        body: JSON.stringify({ query, limit: options.limit ?? 10 }),
      });
      const data = await expectJson<{ results: DenseMemRecallResult[] }>(
        response,
        'searchSemantic',
      );
      return data.results ?? [];
    },

    async getFact(id) {
      const response = await withTimeout(`${baseUrl}/api/v1/facts/${id}`);
      if (response.status === 404) {
        return null;
      }
      return expectJson<DenseMemFactRecord>(response, 'getFact');
    },

    async listFacts(options = {}) {
      const limit = options.limit ?? 50;
      const response = await withTimeout(`${baseUrl}/api/v1/facts?limit=${limit}`);
      const data = await expectJson<{ facts: DenseMemFactRecord[] }>(response, 'listFacts');
      return data.facts ?? [];
    },

    async listCommunities() {
      const response = await withTimeout(`${baseUrl}/api/v1/communities`);
      const data = await expectJson<{ communities: DenseMemCommunitySummary[] }>(
        response,
        'listCommunities',
      );
      return data.communities ?? [];
    },

    async getCommunitySummary(id) {
      const response = await withTimeout(`${baseUrl}/api/v1/communities/${id}`);
      if (response.status === 404) {
        return null;
      }
      return expectJson<DenseMemCommunitySummary>(response, 'getCommunitySummary');
    },
  };
};
