import { describe, expect, it } from 'vitest';

import { createConcurrencyLimiter } from '../src/llm/concurrency';

describe('concurrency limiter', () => {
  it('rejects non-positive limits', () => {
    expect(() => createConcurrencyLimiter(0)).toThrow(RangeError);
    expect(() => createConcurrencyLimiter(-1)).toThrow(RangeError);
    expect(() => createConcurrencyLimiter(1.5)).toThrow(RangeError);
  });

  it('limits in-flight tasks to the configured cap', async () => {
    const limiter = createConcurrencyLimiter(2);
    const release: Array<() => void> = [];
    const inFlight: number[] = [];
    let active = 0;

    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

    const start = (id: number) =>
      limiter.run(
        () =>
          new Promise<number>((resolve) => {
            active += 1;
            inFlight.push(active);
            release.push(() => {
              active -= 1;
              resolve(id);
            });
          }),
      );

    const tasks = [start(1), start(2), start(3), start(4)];

    await tick();
    expect(limiter.active).toBe(2);
    expect(limiter.queued).toBe(2);

    release[0]?.();
    await tick();
    release[1]?.();
    await tick();
    release[2]?.();
    await tick();
    release[3]?.();

    const results = await Promise.all(tasks);
    expect(results).toEqual([1, 2, 3, 4]);
    expect(Math.max(...inFlight)).toBe(2);
  });

  it('propagates rejection without breaking the queue', async () => {
    const limiter = createConcurrencyLimiter(1);
    const failure = limiter.run(async () => {
      throw new Error('boom');
    });
    const success = limiter.run(async () => 'ok');

    await expect(failure).rejects.toThrow('boom');
    await expect(success).resolves.toBe('ok');
    expect(limiter.active).toBe(0);
    expect(limiter.queued).toBe(0);
  });
});
