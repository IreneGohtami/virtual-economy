import { Worker, Queue, ConnectionOptions } from 'bullmq';
import { DeadLetterQueueHandler } from '../dlq';
import { QUEUE_NAMES } from '../queues';

import { createProductionWorker } from './production.worker';
import { createEconomyWorker } from './economy.worker';
import { createDepreciationWorker } from './depreciation.worker';
import { createHappinessWorker } from './happiness.worker';
import { createWorkerDisruptionWorker } from './worker-disruption.worker';
import { createBankWorker } from './bank.worker';
import { createShopWorker } from './shop.worker';
import { createSeasonWorker } from './season.worker';
import { createEventWorker } from './event.worker';
import { createFertilizerWorker } from './fertilizer.worker';
import { createInactivityWorker } from './inactivity.worker';

export interface WorkerRegistry {
  workers: Worker[];
  start(): void;
  shutdown(): Promise<void>;
}

/**
 * Creates and registers all BullMQ workers.
 * Workers are created in stopped state (autorun: false) and must
 * be started via the returned registry's start() method.
 */
export function createAllWorkers(
  connection: ConnectionOptions,
  concurrency: number,
  dlqHandler: DeadLetterQueueHandler,
): WorkerRegistry {
  const workers: Worker[] = [
    createProductionWorker(connection, concurrency, dlqHandler),
    createEconomyWorker(connection, concurrency, dlqHandler),
    createDepreciationWorker(connection, concurrency, dlqHandler),
    createHappinessWorker(connection, concurrency, dlqHandler),
    createWorkerDisruptionWorker(connection, concurrency, dlqHandler),
    createBankWorker(connection, concurrency, dlqHandler),
    createShopWorker(connection, concurrency, dlqHandler),
    createSeasonWorker(connection, concurrency, dlqHandler),
    createEventWorker(connection, concurrency, dlqHandler),
    createFertilizerWorker(connection, concurrency, dlqHandler),
    createInactivityWorker(connection, concurrency, dlqHandler),
  ];

  return {
    workers,

    start() {
      for (const worker of workers) {
        worker.run();
      }
      console.log(`[WorkerRegistry] Started ${workers.length} workers`);

      // Schedule repeatable jobs
      scheduleRepeatableJobs(connection);
    },

    async shutdown() {
      console.log(`[WorkerRegistry] Shutting down ${workers.length} workers...`);
      const closePromises = workers.map((w) => w.close());
      await Promise.all(closePromises);
      console.log('[WorkerRegistry] All workers closed');
    },
  };
}

/**
 * Schedule repeatable/cron jobs that fire on intervals.
 * BullMQ deduplicates repeatables by jobId, so this is safe to call on every startup.
 */
async function scheduleRepeatableJobs(connection: ConnectionOptions): Promise<void> {
  try {
    const workerQueue = new Queue(QUEUE_NAMES.WORKER, { connection });

    // Daily salary deduction — every 24 hours
    await workerQueue.add(
      'worker.salary_deduction',
      {},
      {
        repeat: { every: 24 * 60 * 60 * 1000 }, // every 24 hours
        jobId: 'daily-salary-deduction',
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    // Worker disruption check — every 4 hours
    await workerQueue.add(
      'worker.disruption_check',
      {},
      {
        repeat: { every: 4 * 60 * 60 * 1000 }, // every 4 hours
        jobId: 'disruption-check-4h',
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    // Happiness decay — every 24 hours (1% daily reduction)
    const happinessQueue = new Queue(QUEUE_NAMES.HAPPINESS, { connection });
    await happinessQueue.add(
      'happiness.daily_decay',
      {},
      {
        repeat: { every: 24 * 60 * 60 * 1000 }, // every 24 hours
        jobId: 'daily-happiness-decay',
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
    await happinessQueue.close();

    console.log('[WorkerRegistry] Scheduled repeatable jobs: salary_deduction (24h), disruption_check (4h), happiness_decay (24h)');
    await workerQueue.close();
  } catch (err) {
    console.error('[WorkerRegistry] Failed to schedule repeatable jobs:', err);
  }
}
