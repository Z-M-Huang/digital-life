type Resolver<T> = {
  task: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

export type ConcurrencyLimiter = {
  readonly limit: number;
  readonly active: number;
  readonly queued: number;
  run: <T>(task: () => Promise<T>) => Promise<T>;
};

export const createConcurrencyLimiter = (limit: number): ConcurrencyLimiter => {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new RangeError('Concurrency limit must be a positive integer.');
  }

  const queue: Resolver<unknown>[] = [];
  let active = 0;

  const next = () => {
    if (active >= limit) {
      return;
    }
    const entry = queue.shift();
    if (!entry) {
      return;
    }
    active += 1;
    entry
      .task()
      .then((value) => entry.resolve(value))
      .catch((reason) => entry.reject(reason))
      .finally(() => {
        active -= 1;
        next();
      });
  };

  return {
    get limit() {
      return limit;
    },
    get active() {
      return active;
    },
    get queued() {
      return queue.length;
    },
    run<T>(task: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        queue.push({
          task: task as () => Promise<unknown>,
          resolve: resolve as (value: unknown) => void,
          reject,
        });
        next();
      });
    },
  };
};
