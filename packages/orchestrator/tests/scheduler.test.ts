import { describe, expect, it, vi } from 'vitest';

import { createScheduler } from '../src/services/scheduler';

describe('scheduler', () => {
  it('skips tick when in quiet hours', async () => {
    const taskCalls: number[] = [];
    const task = vi.fn(async () => {
      taskCalls.push(Date.now());
    });
    const scheduler = createScheduler({
      config: {
        enabled: true,
        timezone: 'UTC',
        intervalMs: 1000,
        quietHours: { start: '00:00', end: '23:59' },
      },
      task,
      now: () => new Date('2026-01-01T12:00:00Z'),
    });

    await scheduler.triggerNow();
    expect(task).not.toHaveBeenCalled();
  });

  it('runs tick outside quiet hours', async () => {
    const task = vi.fn(async () => undefined);
    const scheduler = createScheduler({
      config: {
        enabled: true,
        timezone: 'UTC',
        intervalMs: 1000,
        quietHours: { start: '02:00', end: '04:00' },
      },
      task,
      now: () => new Date('2026-01-01T12:00:00Z'),
    });
    await scheduler.triggerNow();
    expect(task).toHaveBeenCalledOnce();
  });

  it('start respects enabled=false', () => {
    const setIntervalImpl = vi.fn();
    const scheduler = createScheduler({
      config: { enabled: false, timezone: 'UTC', intervalMs: 1000 },
      task: async () => undefined,
      setIntervalImpl: setIntervalImpl as unknown as typeof setInterval,
    });
    scheduler.start();
    expect(setIntervalImpl).not.toHaveBeenCalled();
  });

  it('start/stop manages an interval handle', () => {
    const handle = { ref: 'fake' };
    const setIntervalImpl = vi.fn(() => handle as unknown as ReturnType<typeof setInterval>);
    const clearIntervalImpl = vi.fn();
    const scheduler = createScheduler({
      config: { enabled: true, timezone: 'UTC', intervalMs: 1000 },
      task: async () => undefined,
      setIntervalImpl: setIntervalImpl as unknown as typeof setInterval,
      clearIntervalImpl: clearIntervalImpl as unknown as typeof clearInterval,
    });
    scheduler.start();
    scheduler.start();
    scheduler.stop();
    scheduler.stop();
    expect(setIntervalImpl).toHaveBeenCalledOnce();
    expect(clearIntervalImpl).toHaveBeenCalledOnce();
  });
});
