import { Worker, Job, Queue, ConnectionOptions } from 'bullmq';
import { QUEUE_NAMES, getRetryPolicy } from '../queues';
import { DeadLetterQueueHandler } from '../dlq';
import { getPool, getClient } from '../database';

const QUEUE = QUEUE_NAMES.FERTILIZER;
const retryPolicy = getRetryPolicy(QUEUE);

/** BullMQ Queue for scheduling follow-up fertilizer jobs */
let fertilizerQueue: Queue | null = null;

function getFertilizerQueue(connection: ConnectionOptions): Queue {
  if (!fertilizerQueue) {
    fertilizerQueue = new Queue(QUEUE, { connection });
  }
  return fertilizerQueue;
}

/** Boost duration in days (from recipe-config.json) */
const BOOST_DURATION_DAYS = 5;

/**
 * Fertilizer quotas per factory category.
 * AGRICULTURE: 4 units for 15% yield bonus
 * FORESTRY: 6 units for 12% yield bonus
 */
const FERTILIZER_QUOTAS: Record<string, { unitsRequired: number; yieldBonusPercent: number }> = {
  AGRICULTURE: { unitsRequired: 4, yieldBonusPercent: 15 },
  FORESTRY: { unitsRequired: 6, yieldBonusPercent: 12 },
};

// ============================================================
// Data types
// ============================================================

interface FactoryRow {
  id: string;
  player_id: string;
  season_id: string;
  category: string;
  fertilizer_boost_active: boolean;
  fertilizer_boost_expires_at: Date | null;
}

interface InventoryRow {
  id: string;
  quantity: number;
}

// ============================================================
// fertilizer.expire — Expire a fertilizer boost
// ============================================================

/**
 * Expires a fertilizer boost on a factory.
 * Then immediately attempts auto-reapply if the player has sufficient inventory.
 *
 * Job data: { factoryId: string }
 */
async function processFertilizerExpire(
  job: Job,
  connection: ConnectionOptions,
): Promise<void> {
  const pool = getPool();
  const { factoryId } = job.data as { factoryId: string };

  if (!factoryId) {
    console.warn(`[${QUEUE}] fertilizer.expire — missing factoryId in job data`);
    return;
  }

  // Fetch factory
  const factoryResult = await pool.query<FactoryRow>(
    `SELECT id, player_id, season_id, category, fertilizer_boost_active, fertilizer_boost_expires_at
     FROM factories
     WHERE id = $1`,
    [factoryId],
  );

  if (factoryResult.rows.length === 0) {
    console.warn(`[${QUEUE}] fertilizer.expire — factory ${factoryId} not found`);
    return;
  }

  const factory = factoryResult.rows[0];

  if (!factory.fertilizer_boost_active) {
    console.log(`[${QUEUE}] fertilizer.expire — factory ${factoryId} boost already inactive. Skipping.`);
    return;
  }

  // Attempt auto-reapply
  const reapplied = await attemptAutoReapply(factory, connection);

  if (!reapplied) {
    // Deactivate boost
    await pool.query(
      `UPDATE factories
       SET fertilizer_boost_active = false, fertilizer_boost_expires_at = NULL
       WHERE id = $1`,
      [factoryId],
    );

    console.log(
      `[${QUEUE}] fertilizer.expire — factory ${factoryId} boost expired (insufficient fertilizer for reapply)`,
    );

    // Notify player
    await insertNotification(
      pool,
      factory.player_id,
      factory.season_id,
      'FERTILIZER_EXPIRED',
      'Fertilizer boost expired',
      `Your ${factory.category} factory's fertilizer boost has expired. Insufficient fertilizer in inventory for automatic reapplication.`,
    );
  }
}

// ============================================================
// fertilizer.auto_reapply — Attempt auto-reapplication
// ============================================================

/**
 * Attempts to auto-reapply fertilizer to a factory on boost expiry.
 * This is called either directly from fertilizer.expire or as a standalone job.
 *
 * Job data: { factoryId: string }
 */
async function processFertilizerAutoReapply(
  job: Job,
  connection: ConnectionOptions,
): Promise<void> {
  const pool = getPool();
  const { factoryId } = job.data as { factoryId: string };

  if (!factoryId) {
    console.warn(`[${QUEUE}] fertilizer.auto_reapply — missing factoryId in job data`);
    return;
  }

  // Fetch factory
  const factoryResult = await pool.query<FactoryRow>(
    `SELECT id, player_id, season_id, category, fertilizer_boost_active, fertilizer_boost_expires_at
     FROM factories
     WHERE id = $1`,
    [factoryId],
  );

  if (factoryResult.rows.length === 0) {
    console.warn(`[${QUEUE}] fertilizer.auto_reapply — factory ${factoryId} not found`);
    return;
  }

  const factory = factoryResult.rows[0];

  const reapplied = await attemptAutoReapply(factory, connection);

  if (!reapplied) {
    // Deactivate boost if still active
    if (factory.fertilizer_boost_active) {
      await pool.query(
        `UPDATE factories
         SET fertilizer_boost_active = false, fertilizer_boost_expires_at = NULL
         WHERE id = $1`,
        [factoryId],
      );
    }

    console.log(
      `[${QUEUE}] fertilizer.auto_reapply — factory ${factoryId} reapply failed (insufficient inventory)`,
    );
  }
}

// ============================================================
// Core logic: attempt auto-reapply
// ============================================================

/**
 * Attempts to consume fertilizer from player inventory and extend the boost.
 * Returns true if successful, false if insufficient inventory.
 *
 * Uses a transaction to atomically check + consume inventory and update factory.
 */
async function attemptAutoReapply(
  factory: FactoryRow,
  connection: ConnectionOptions,
): Promise<boolean> {
  const quota = FERTILIZER_QUOTAS[factory.category];
  if (!quota) {
    console.log(
      `[${QUEUE}] attemptAutoReapply — category ${factory.category} not eligible for fertilizer`,
    );
    return false;
  }

  const client = await getClient();

  try {
    await client.query('BEGIN');

    // Find the fertilizer commodity
    const fertilizerResult = await client.query<{ id: string }>(
      `SELECT id FROM commodities WHERE slug = 'fertilizer' LIMIT 1`,
    );

    if (fertilizerResult.rows.length === 0) {
      await client.query('ROLLBACK');
      console.warn(`[${QUEUE}] attemptAutoReapply — fertilizer commodity not found in database`);
      return false;
    }

    const fertilizerId = fertilizerResult.rows[0].id;

    // Check player inventory for fertilizer (with row-level lock)
    const inventoryResult = await client.query<InventoryRow>(
      `SELECT id, quantity FROM inventory
       WHERE player_id = $1 AND season_id = $2 AND commodity_id = $3
       FOR UPDATE`,
      [factory.player_id, factory.season_id, fertilizerId],
    );

    if (inventoryResult.rows.length === 0 || inventoryResult.rows[0].quantity < quota.unitsRequired) {
      await client.query('ROLLBACK');
      return false;
    }

    const currentQuantity = inventoryResult.rows[0].quantity;
    const newQuantity = currentQuantity - quota.unitsRequired;

    // Consume fertilizer from inventory
    if (newQuantity === 0) {
      await client.query(
        `DELETE FROM inventory WHERE id = $1`,
        [inventoryResult.rows[0].id],
      );
    } else {
      await client.query(
        `UPDATE inventory SET quantity = $1 WHERE id = $2`,
        [newQuantity, inventoryResult.rows[0].id],
      );
    }

    // Extend boost: set new expiry 5 days from now
    const newExpiresAt = new Date(Date.now() + BOOST_DURATION_DAYS * 24 * 60 * 60 * 1000);

    await client.query(
      `UPDATE factories
       SET fertilizer_boost_active = true, fertilizer_boost_expires_at = $1
       WHERE id = $2`,
      [newExpiresAt.toISOString(), factory.id],
    );

    await client.query('COMMIT');

    // Schedule next expire job
    const queue = getFertilizerQueue(connection);
    const delayMs = BOOST_DURATION_DAYS * 24 * 60 * 60 * 1000;

    await queue.add(
      'fertilizer.expire',
      { factoryId: factory.id },
      {
        delay: delayMs,
        jobId: `fertilizer-expire-${factory.id}-${Date.now()}`,
        removeOnComplete: true,
        removeOnFail: false,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );

    console.log(
      `[${QUEUE}] attemptAutoReapply — factory ${factory.id} boost reapplied ` +
        `(consumed ${quota.unitsRequired} fertilizer, new expiry: ${newExpiresAt.toISOString()})`,
    );

    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ============================================================
// Helper functions
// ============================================================

/**
 * Insert a notification record for a player.
 */
async function insertNotification(
  pool: ReturnType<typeof getPool>,
  playerId: string,
  seasonId: string,
  type: string,
  title: string,
  body: string,
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO notifications (id, player_id, season_id, type, title, body, priority, read, delivered)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'NORMAL', false, false)`,
      [playerId, seasonId, type, title, body],
    );
  } catch (err) {
    console.warn(`[${QUEUE}] Failed to insert notification for player ${playerId}:`, err);
  }
}

// ============================================================
// Worker factory
// ============================================================

/**
 * Fertilizer worker handles:
 * - fertilizer.expire — expires fertilizer boost after 5 days
 * - fertilizer.auto_reapply — attempts automatic reapplication if inventory permits
 *
 * Requirements: 6.7, 6.8
 */
export function createFertilizerWorker(
  connection: ConnectionOptions,
  concurrency: number,
  dlqHandler: DeadLetterQueueHandler,
): Worker {
  const worker = new Worker(
    QUEUE,
    async (job: Job) => {
      console.log(`[${QUEUE}] Processing job ${job.name} (id: ${job.id})`);

      switch (job.name) {
        case 'fertilizer.expire':
          await processFertilizerExpire(job, connection);
          break;
        case 'fertilizer.auto_reapply':
          await processFertilizerAutoReapply(job, connection);
          break;
        default:
          console.warn(`[${QUEUE}] Unknown job name: ${job.name}`);
      }
    },
    {
      connection,
      concurrency,
      autorun: false,
    },
  );

  worker.on('failed', async (job, error) => {
    if (job && job.attemptsMade >= retryPolicy.attempts) {
      await dlqHandler.moveToDeadLetter(job, error);
    }
  });

  return worker;
}
