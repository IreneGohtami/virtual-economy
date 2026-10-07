import { Worker, Job, ConnectionOptions } from 'bullmq';
import { calculateDepreciation } from '@sea-commodity-tycoon/game-rules';
import { QUEUE_NAMES, getRetryPolicy } from '../queues';
import { DeadLetterQueueHandler } from '../dlq';
import { getPool } from '../database';

const QUEUE = QUEUE_NAMES.DEPRECIATION;
const retryPolicy = getRetryPolicy(QUEUE);

/**
 * Depreciation interval in days.
 * Every 5 game days, factory efficiency drops by 10pp (floor 50%).
 */
const DEPRECIATION_INTERVAL_DAYS = 5;

interface DepreciableFactory {
  id: string;
  playerId: string;
  efficiency: number;
}

/**
 * Finds all factories in the active season that are due for a depreciation tick.
 * A factory is due when:
 *   - last_depreciation_at + 5 days <= now, OR
 *   - last_depreciation_at is NULL and constructed_at + 5 days <= now
 */
async function getFactoriesDueForDepreciation(): Promise<DepreciableFactory[]> {
  const pool = getPool();
  const intervalExpression = `${DEPRECIATION_INTERVAL_DAYS} days`;

  const result = await pool.query<{ id: string; player_id: string; efficiency: string }>(
    `SELECT f.id, f.player_id, f.efficiency
     FROM factories f
     JOIN seasons s ON f.season_id = s.id
     WHERE s.status = 'ACTIVE'
       AND (
         (f.last_depreciation_at IS NOT NULL AND f.last_depreciation_at + $1::interval <= NOW())
         OR
         (f.last_depreciation_at IS NULL AND f.constructed_at + $1::interval <= NOW())
       )`,
    [intervalExpression],
  );

  return result.rows.map((row) => ({
    id: row.id,
    playerId: row.player_id,
    efficiency: parseFloat(row.efficiency),
  }));
}

/**
 * Applies depreciation to a single factory and returns the new efficiency.
 */
async function applyDepreciation(factory: DepreciableFactory): Promise<number> {
  const pool = getPool();
  const newEfficiency = calculateDepreciation(factory.efficiency);

  await pool.query(
    `UPDATE factories
     SET efficiency = $1,
         last_depreciation_at = NOW()
     WHERE id = $2`,
    [newEfficiency, factory.id],
  );

  return newEfficiency;
}

/**
 * Depreciation worker handles:
 * - factory.depreciation_tick — reduces factory efficiency by 10pp every 5 game days (floor 50%)
 *
 * Requirements: 22.1, 22.2, 22.7, 22.8, 22.9
 */
export function createDepreciationWorker(
  connection: ConnectionOptions,
  concurrency: number,
  dlqHandler: DeadLetterQueueHandler,
): Worker {
  const worker = new Worker(
    QUEUE,
    async (job: Job) => {
      console.log(`[${QUEUE}] Processing job ${job.name} (id: ${job.id})`);

      switch (job.name) {
        case 'factory.depreciation_tick':
          await processDepreciationTick(job);
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

/**
 * Processes the depreciation tick:
 * 1. Find all factories due for depreciation in the active season
 * 2. Apply calculateDepreciation (efficiency - 10, floor 50%)
 * 3. Log notification if factory hits minimum efficiency (50%)
 */
async function processDepreciationTick(job: Job): Promise<void> {
  const factories = await getFactoriesDueForDepreciation();

  if (factories.length === 0) {
    console.log(`[${QUEUE}] No factories due for depreciation`);
    return;
  }

  console.log(`[${QUEUE}] Processing depreciation for ${factories.length} factories`);

  let depreciated = 0;
  let hitMinimum = 0;

  for (const factory of factories) {
    const newEfficiency = await applyDepreciation(factory);
    depreciated++;

    if (newEfficiency <= 50) {
      hitMinimum++;
      // Log maintenance recommendation — in production this would send a notification
      // via the notification module. For MVP we log it for the API notification service to pick up.
      console.log(
        `[${QUEUE}] Factory ${factory.id} (player: ${factory.playerId}) hit minimum efficiency (50%). ` +
          `Maintenance recommended.`,
      );

      // Insert a notification record for the player
      await insertMaintenanceNotification(factory.playerId, factory.id);
    }
  }

  console.log(
    `[${QUEUE}] Depreciation complete: ${depreciated} factories processed, ${hitMinimum} at minimum efficiency`,
  );

  job.updateProgress(100);
}

/**
 * Inserts a maintenance recommendation notification for the player.
 * Uses the notifications table if it exists; logs on failure without breaking the job.
 */
async function insertMaintenanceNotification(playerId: string, factoryId: string): Promise<void> {
  const pool = getPool();
  try {
    await pool.query(
      `INSERT INTO notifications (id, player_id, type, title, body, priority, read, created_at)
       VALUES (gen_random_uuid(), $1, 'MAINTENANCE', 'Factory maintenance needed',
               $2, 'HIGH', false, NOW())`,
      [playerId, `Your factory ${factoryId} has reached minimum efficiency (50%). Perform maintenance to restore productivity.`],
    );
  } catch (err) {
    // Non-critical — log and continue. The notification table might not exist in all environments.
    console.warn(`[${QUEUE}] Failed to insert maintenance notification for player ${playerId}:`, err);
  }
}
