import { ConnectionOptions } from 'bullmq';

export interface WorkerConfig {
  redis: ConnectionOptions;
  concurrency: number;
}

export function loadConfig(): WorkerConfig {
  return {
    redis: {
      host: process.env['REDIS_HOST'] || 'localhost',
      port: parseInt(process.env['REDIS_PORT'] || '6379', 10),
      password: process.env['REDIS_PASSWORD'] || undefined,
      db: parseInt(process.env['REDIS_DB'] || '0', 10),
      maxRetriesPerRequest: null,
    },
    concurrency: parseInt(process.env['WORKER_CONCURRENCY'] || '5', 10),
  };
}
