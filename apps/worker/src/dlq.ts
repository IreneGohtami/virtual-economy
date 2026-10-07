import { Job, Queue } from 'bullmq';
import { ConnectionOptions } from 'bullmq';

const DLQ_SUFFIX = ':dlq';

/**
 * Dead Letter Queue handler.
 * Failed jobs that exhaust all retries are moved to a per-queue DLQ
 * for later inspection and manual reprocessing.
 */
export class DeadLetterQueueHandler {
  private dlqQueues: Map<string, Queue> = new Map();
  private connection: ConnectionOptions;

  constructor(connection: ConnectionOptions) {
    this.connection = connection;
  }

  /**
   * Move a failed job to the corresponding dead-letter queue.
   * Preserves original job data and failure metadata.
   */
  async moveToDeadLetter(job: Job, error: Error): Promise<void> {
    const dlqName = job.queueName + DLQ_SUFFIX;
    const dlq = this.getOrCreateDLQ(dlqName);

    await dlq.add(
      `dlq:${job.name}`,
      {
        originalJobId: job.id,
        originalQueue: job.queueName,
        originalName: job.name,
        originalData: job.data,
        failedAt: new Date().toISOString(),
        error: error.message,
        stackTrace: error.stack,
        attemptsMade: job.attemptsMade,
      },
      {
        removeOnComplete: false,
        removeOnFail: false,
      },
    );

    console.error(
      `[DLQ] Job ${job.id} (${job.name}) moved to ${dlqName} after ${job.attemptsMade} attempts: ${error.message}`,
    );
  }

  private getOrCreateDLQ(dlqName: string): Queue {
    let dlq = this.dlqQueues.get(dlqName);
    if (!dlq) {
      dlq = new Queue(dlqName, { connection: this.connection });
      this.dlqQueues.set(dlqName, dlq);
    }
    return dlq;
  }

  /**
   * Close all DLQ queue connections. Call during shutdown.
   */
  async close(): Promise<void> {
    const closeTasks = Array.from(this.dlqQueues.values()).map((q) => q.close());
    await Promise.all(closeTasks);
    this.dlqQueues.clear();
  }
}
