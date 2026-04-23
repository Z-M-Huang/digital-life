export type ReflectionItemRecord = {
  category: 'startup' | 'scope' | 'knowledge' | 'policy' | 'maintenance';
  connectorId: string | null;
  createdAt: Date;
  detail: string;
  id: string;
  metadata: Record<string, unknown>;
  runId: string | null;
  severity: 'info' | 'warning' | 'error';
  status: 'open' | 'resolved';
  title: string;
  updatedAt: Date;
};

export type ReflectionRepository = {
  listReflectionItems: () => Promise<ReflectionItemRecord[]>;
  replaceReflectionItems: (
    items: Omit<ReflectionItemRecord, 'createdAt' | 'id' | 'updatedAt'>[],
  ) => Promise<ReflectionItemRecord[]>;
};

export const createInMemoryReflectionRepository = (): ReflectionRepository => {
  let items: ReflectionItemRecord[] = [];

  return {
    async listReflectionItems() {
      return [...items].sort((left, right) => right.updatedAt.valueOf() - left.updatedAt.valueOf());
    },
    async replaceReflectionItems(nextItems) {
      items = nextItems.map((item, index) => {
        const now = new Date(Date.now() + index);
        return {
          ...item,
          id: crypto.randomUUID(),
          createdAt: now,
          updatedAt: now,
        };
      });

      return items;
    },
  };
};
