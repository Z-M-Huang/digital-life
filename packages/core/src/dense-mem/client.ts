export type DenseMemFact = {
  id: string;
  content: string;
  provenance: Record<string, unknown>;
};

export type DenseMemWriteRequest = {
  fragments: DenseMemFact[];
  namespace: string;
};

export type DenseMemClient = {
  healthCheck: () => Promise<boolean>;
  writeFragments: (request: DenseMemWriteRequest) => Promise<void>;
};

export const createDenseMemClient = ({
  baseUrl,
  fetcher = fetch,
  timeoutMs,
}: {
  baseUrl: string;
  fetcher?: typeof fetch;
  timeoutMs: number;
}): DenseMemClient => {
  const withTimeout = async (input: string, init?: RequestInit): Promise<Response> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetcher(input, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  };

  return {
    async healthCheck() {
      const response = await withTimeout(`${baseUrl}/health`);
      return response.ok;
    },
    async writeFragments(request) {
      const response = await withTimeout(`${baseUrl}/v1/fragments`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        throw new Error(`dense-mem write failed: ${response.status}`);
      }
    },
  };
};
