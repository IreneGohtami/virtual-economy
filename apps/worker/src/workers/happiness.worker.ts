import { Worker, Job, ConnectionOptions } from 'bullmq';
import { QUEUE_NAMES, getRetryPolicy } from '../queues';
import { DeadLetterQueueHandler } from '../dlq';
import { getPool } from '../database';

const QUEUE = QUEUE_NAMES.HAPPINESS;
const retryPolicy = getRetryPolicy(QUEUE);

/** Warning threshold — send notification at 50% */
const WARNING_THRESHOLD = 50;

/** Critical threshold — trigger ON_VACATION at 30% */
const CRITICAL_THRESHOLD = 30;

/** Daily decay percent */
const DAILY_DECAY_PERCENT = 1;

/**
 * Happiness worker handles:
 * - happiness.daily_decay — reduces all players' happiness by 1% daily
 *
 * Requirements: 15.1, 25.2
 */
export function createHappinessWorker(
  connection: ConnectionOptions,
  concurrency: number,
  dlqHandler: DeadLetterQueueHandler,
): Worker {
  const worker = new Worker(
    QUEUE,
    async (job: Job) => {
      console.log(`[${QUEUE}] Processing job ${job.name} (id: ${job.id})`);

      switch (job.name) {
        case 'happiness.daily_decay':
          await processHappinessDecay();
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
 * Process daily happiness decay for all players in the active season.
 * - Reduces each player's happiness by 1%, capped at 0
 * - Sends a warning notification when crossing the 50% threshold
 * - Triggers ON_VACATION for all workers when happiness drops to ≤30%
 */
async function processHappinessDecay(): Promise<void> {
  const pool = getPool();

  // Get active season
  const seasonResult = await pool.query<{ id: string }>(
    `SELECT id FROM seasons WHERE status = 'ACTIVE' ORDER BY starts_at DESC LIMIT 1`,
  );

  if (seasonResult.rows.length === 0) {
    console.log(`[${QUEUE}] No active season found, skipping happiness decay`);
    return;
  }

  const seasonId = seasonResult.rows[0].id;

  // Get all player seasons in the active season
  const playerSeasons = await pool.query<{
    id: string;
    player_id: string;
    workforce_happiness: string;
  }>(
    `SELECT id, player_id, workforce_happiness FROM player_seasons WHERE season_id = $1`,
    [seasonId],
  );

  console.log(
    `[${QUEUE}] Processing happiness decay for ${playerSeasons.rows.length} players`,
  );

  let warningCount = 0;
  let vacationCount = 0;

  for (const ps of playerSeasons.rows) {
    const currentHappiness = parseFloat(ps.workforce_happiness);
    const newHappiness = Math.max(0, currentHappiness - DAILY_DECAY_PERCENT);

    // Update happiness and last decay timestamp
    await pool.query(
      `UPDATE player_seasons
       SET workforce_happiness = $1, last_happiness_decay_at = NOW()
       WHERE id = $2`,
      [newHappiness.toFixed(2), ps.id],
    );

    // Check if we just crossed the warning threshold (50%)
    if (newHappiness <= WARNING_THRESHOLD && currentHappiness > WARNING_THRESHOLD) {
      await createNotification(
        pool,
        ps.player_id,
        seasonId,
        'HAPPINESS_WARNING',
        'Workforce Happiness Warning',
        `Your workforce happiness has dropped to ${newHappiness.toFixed(1)}%. Consider purchasing a boost to prevent worker disruptions.`,
        'HIGH',
      );
      warningCount++;
    }

    // Check critical threshold (≤30%) — trigger ON_VACATION
    if (newHappiness <= CRITICAL_THRESHOLD) {
      const affectedWorkers = await triggerVacation(pool, ps.player_id, seasonId);
      if (affectedWorkers > 0) {
        vacationCount++;
      }
    }
  }

  console.log(
    `[${QUEUE}] Happiness decay complete: ${playerSeasons.rows.length} players processed, ${warningCount} warnings sent, ${vacationCount} vacation triggers`,
  );
}

/**
 * Trigger ON_VACATION for all WORKING workers of a player.
 * Halts production at affected factories.
 */
async function triggerVacation(
  pool: ReturnType<typeof getPool>,
  playerId: string,
  seasonId: string,
): Promise<number> {
  // Find all working workers for this player in this season
  const workingResult = await pool.query<{ id: string; factory_id: string | null }>(
    `SELECT id, factory_id FROM worker_assignments
     WHERE player_id = $1 AND season_id = $2 AND status = 'WORKING'`,
    [playerId, seasonId],
  );

  if (workingResult.rows.length === 0) {
    return 0;
  }

  const workerIds = workingResult.rows.map((r: { id: string }) => r.id);

  // Set all working workers to ON_VACATION
  await pool.query(
    `UPDATE worker_assignments
     SET status = 'ON_VACATION', status_changed_at = NOW()
     WHERE id = ANY($1)`,
    [workerIds],
  );

  // Pause active production jobs at affected factories
  const factoryIds = [
    ...new Set(
      workingResult.rows
        .map((r: { factory_id: string | null }) => r.factory_id)
        .filter(Boolean),
    ),
  ] as string[];

  if (factoryIds.length > 0) {
    // Pause active production jobs
    await pool.query(
      `UPDATE production_jobs
       SET status = 'PAUSED', paused_at = NOW(), pause_reason = 'WORKER_ON_VACATION'
       WHERE factory_id = ANY($1) AND status = 'ACTIVE'`,
      [factoryIds],
    );

    // Set factories to PAUSED
    await pool.query(
      `UPDATE factories
       SET status = 'PAUSED'
       WHERE id = ANY($1) AND status = 'PRODUCING'`,
      [factoryIds],
    );
  }

  // Send critical notification
  await createNotification(
    pool,
    playerId,
    seasonId,
    'HAPPINESS_WARNING',
    'Workers On Vacation - Critical Happiness',
    `Your workforce happiness has dropped below ${CRITICAL_THRESHOLD}%. All ${workingResult.rows.length} workers have gone on vacation and production has been halted. Purchase happiness boosts to recover.`,
    'CRITICAL',
  );

  console.log(
    `[${QUEUE}] ON_VACATION triggered: player=${playerId}, workers=${workingResult.rows.length}, factories paused=${factoryIds.length}`,
  );

  return workingResult.rows.length;
}

/**
 * Insert a notification record.
 */
async function createNotification(
  pool: ReturnType<typeof getPool>,
  playerId: string,
  seasonId: string,
  type: string,
  title: string,
  body: string,
  priority: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO notifications (id, player_id, season_id, type, title, body, priority, read, delivered)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, false, false)`,
    [playerId, seasonId, type, title, body, priority],
  );
}
