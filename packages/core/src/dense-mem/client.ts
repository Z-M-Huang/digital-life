export type DenseMemFact = {
  id: string;
  content: string;
  provenance: Record<string, unknown>;
};

export type DenseMemClient = {
  healthCheck: () => Promise<boolean>;
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
  };
};
