import * as dotenv from 'dotenv';
dotenv.config();

import { loadConfig } from './config';
import { closePool } from './database';
import { DeadLetterQueueHandler } from './dlq';
import { createAllWorkers, WorkerRegistry } from './workers';

let registry: WorkerRegistry | null = null;
let dlqHandler: DeadLetterQueueHandler | null = null;
let shuttingDown = false;

/**
 * Graceful shutdown handler.
 * Waits for in-progress jobs to complete before exiting.
 */
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`\n[Main] Received ${signal}. Starting graceful shutdown...`);

  try {
    if (registry) {
      await registry.shutdown();
    }
    if (dlqHandler) {
      await dlqHandler.close();
    }
    await closePool();
    console.log('[Main] Graceful shutdown complete');
    process.exit(0);
  } catch (err) {
    console.error('[Main] Error during shutdown:', err);
    process.exit(1);
  }
}

/**
 * Bootstrap the worker process.
 * Connects to Redis, registers all queue workers, and starts processing.
 */
async function bootstrap(): Promise<void> {
  console.log('[Main] SEA Commodity Tycoon Worker starting...');

  const config = loadConfig();

  const { host, port } = config.redis as { host: string; port: number };
  console.log(`[Main] Connecting to Redis at ${host}:${port}`);

  // Initialize DLQ handler
  dlqHandler = new DeadLetterQueueHandler(config.redis);

  // Create and start all workers
  registry = createAllWorkers(config.redis, config.concurrency, dlqHandler);
  registry.start();

  console.log(`[Main] Worker process ready (concurrency: ${config.concurrency})`);
}

// Register signal handlers for graceful shutdown
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (err) => {
  console.error('[Main] Uncaught exception:', err);
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  console.error('[Main] Unhandled rejection:', reason);
  shutdown('unhandledRejection');
});

bootstrap().catch((err) => {
  console.error('[Main] Failed to bootstrap worker:', err);
  process.exit(1);
});
