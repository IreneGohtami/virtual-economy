import { WorkerOptions } from 'bullmq';

/**
 * Queue names mirroring the API's QUEUE_NAMES constant.
 * Must stay in sync with apps/api/src/queue/queue.module.ts
 */
export const QUEUE_NAMES = {
  PRODUCTION: 'production',
  ECONOMY: 'economy',
  DEPRECIATION: 'depreciation',
  HAPPINESS: 'happiness',
  WORKER: 'worker',
  BANK: 'bank',
  SHOP: 'shop',
  SEASON: 'season',
  EVENTS: 'events',
  FERTILIZER: 'fertilizer',
  INACTIVITY: 'inactivity',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/**
 * Retry policies per queue.
 * - production: 3 retries, exponential backoff starting at 1s
 * - economy: 5 retries, fixed 30s delay
 * - bank: 3 retries, fixed 60s delay
 * - depreciation: 3 retries, exponential backoff starting at 2s
 * - All others: 3 retries, exponential backoff starting at 1s (default)
 */
export function getRetryPolicy(queueName: QueueName): Pick<WorkerOptions, 'limiter'> & {
  attempts: number;
  backoff: { type: 'exponential' | 'fixed'; delay: number };
} {
  switch (queueName) {
    case QUEUE_NAMES.PRODUCTION:
      return {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
      };
    case QUEUE_NAMES.ECONOMY:
      return {
        attempts: 5,
        backoff: { type: 'fixed', delay: 30_000 },
      };
    case QUEUE_NAMES.BANK:
      return {
        attempts: 3,
        backoff: { type: 'fixed', delay: 60_000 },
      };
    case QUEUE_NAMES.DEPRECIATION:
      return {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      };
    default:
      return {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
      };
  }
}
