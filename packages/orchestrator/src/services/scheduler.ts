import type { DigitalLifeConfig } from '@digital-life/core';

export type Schedulable = () => Promise<void>;

export type Scheduler = {
  start: () => void;
  stop: () => void;
  triggerNow: () => Promise<void>;
  isQuietPeriod: (now?: Date) => boolean;
};

const parseClock = (clock: string): { hour: number; minute: number } => {
  const [hourPart, minutePart] = clock.split(':');
  return {
    hour: Number.parseInt(hourPart ?? '0', 10),
    minute: Number.parseInt(minutePart ?? '0', 10),
  };
};

const minutesSinceMidnight = (date: Date, timezone: string): number => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: timezone,
  });
  const parts = formatter.formatToParts(date);
  const hour = Number.parseInt(parts.find((part) => part.type === 'hour')?.value ?? '0', 10);
  const minute = Number.parseInt(parts.find((part) => part.type === 'minute')?.value ?? '0', 10);
  return hour * 60 + minute;
};

const inWindow = (
  now: number,
  start: { hour: number; minute: number },
  end: { hour: number; minute: number },
): boolean => {
  const startMin = start.hour * 60 + start.minute;
  const endMin = end.hour * 60 + end.minute;
  if (startMin === endMin) {
    return false;
  }
  if (startMin < endMin) {
    return now >= startMin && now < endMin;
  }
  // wraps midnight
  return now >= startMin || now < endMin;
};

export type SchedulerOptions = {
  config: DigitalLifeConfig['maintenance'];
  task: Schedulable;
  setIntervalImpl?: typeof setInterval;
  clearIntervalImpl?: typeof clearInterval;
  now?: () => Date;
};

export const createScheduler = ({
  config,
  task,
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
  now = () => new Date(),
}: SchedulerOptions): Scheduler => {
  let handle: ReturnType<typeof setInterval> | null = null;
  let inFlight = false;

  const isQuietPeriod = (current = now()): boolean => {
    if (!config.quietHours) {
      return false;
    }
    const minutes = minutesSinceMidnight(current, config.timezone);
    return inWindow(
      minutes,
      parseClock(config.quietHours.start),
      parseClock(config.quietHours.end),
    );
  };

  const tick = async (): Promise<void> => {
    if (inFlight) {
      return;
    }
    if (isQuietPeriod()) {
      return;
    }
    inFlight = true;
    try {
      await task();
    } catch (error) {
      console.error('scheduler task failed:', error);
    } finally {
      inFlight = false;
    }
  };

  return {
    start() {
      if (!config.enabled || handle) {
        return;
      }
      handle = setIntervalImpl(() => {
        void tick();
      }, config.intervalMs);
    },
    stop() {
      if (!handle) {
        return;
      }
      clearIntervalImpl(handle);
      handle = null;
    },
    async triggerNow() {
      await tick();
    },
    isQuietPeriod,
  };
};
