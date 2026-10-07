import { Worker, Job, ConnectionOptions } from 'bullmq';
import { QUEUE_NAMES, getRetryPolicy } from '../queues';
import { DeadLetterQueueHandler } from '../dlq';
import { getPool } from '../database';

const QUEUE = QUEUE_NAMES.INACTIVITY;
const retryPolicy = getRetryPolicy(QUEUE);

/** Number of days of inactivity before sending a reminder */
const INACTIVITY_THRESHOLD_DAYS = 5;

/**
 * Inactivity worker handles:
 * - player.inactivity_check — daily check for inactive players (>5 days), sends reminder notification
 *
 * Requirements: 24.1, 24.2, 24.3, 24.4, 24.5
 */
export function createInactivityWorker(
  connection: ConnectionOptions,
  concurrency: number,
  dlqHandler: DeadLetterQueueHandler,
): Worker {
  const worker = new Worker(
    QUEUE,
    async (job: Job) => {
      console.log(`[${QUEUE}] Processing job ${job.name} (id: ${job.id})`);

      switch (job.name) {
        case 'player.inactivity_check':
          await processInactivityCheck();
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
 * Process daily inactivity check for all players in the active season.
 *
 * - Finds players with last_active_at older than 5 days ago
 * - Skips players that already have inactivity_reminder_sent = true
 * - For newly inactive players: sets the flag and inserts a notification record
 * - Actual email sending is a placeholder (logged) — integration can be added later
 */
async function processInactivityCheck(): Promise<void> {
  const pool = getPool();

  // Get active season
  const seasonResult = await pool.query<{ id: string }>(
    `SELECT id FROM seasons WHERE status = 'ACTIVE' ORDER BY starts_at DESC LIMIT 1`,
  );

  if (seasonResult.rows.length === 0) {
    console.log(`[${QUEUE}] No active season found, skipping inactivity check`);
    return;
  }

  const seasonId = seasonResult.rows[0].id;

  // Find all players inactive for more than 5 days who haven't been reminded yet
  const inactivePlayers = await pool.query<{
    player_id: string;
    player_season_id: string;
    display_name: string;
    email: string;
    last_active_at: string;
  }>(
    `SELECT
       ps.player_id,
       ps.id AS player_season_id,
       p.display_name,
       p.email,
       p.last_active_at
     FROM player_seasons ps
     JOIN players p ON p.id = ps.player_id
     WHERE ps.season_id = $1
       AND ps.inactivity_reminder_sent = false
       AND p.last_active_at < NOW() - INTERVAL '${INACTIVITY_THRESHOLD_DAYS} days'`,
    [seasonId],
  );

  if (inactivePlayers.rows.length === 0) {
    console.log(`[${QUEUE}] No newly inactive players found`);
    return;
  }

  console.log(
    `[${QUEUE}] Found ${inactivePlayers.rows.length} inactive players to remind`,
  );

  let remindedCount = 0;

  for (const player of inactivePlayers.rows) {
    try {
      // Set inactivity_reminder_sent = true
      await pool.query(
        `UPDATE player_seasons
         SET inactivity_reminder_sent = true
         WHERE id = $1`,
        [player.player_season_id],
      );

      // Insert notification record
      await pool.query(
        `INSERT INTO notifications (id, player_id, season_id, type, title, body, priority, read, delivered)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, false, false)`,
        [
          player.player_id,
          seasonId,
          'INACTIVITY_REMINDER',
          'We miss you!',
          `You haven't been active for over ${INACTIVITY_THRESHOLD_DAYS} days. Your factories and workers are waiting! Come back and check on your empire.`,
          'MEDIUM',
        ],
      );

      // Placeholder for email sending — log for now
      console.log(
        `[${QUEUE}] Inactivity reminder sent: player=${player.display_name} (${player.email}), last_active=${player.last_active_at}`,
      );

      remindedCount++;
    } catch (err) {
      console.error(
        `[${QUEUE}] Error sending inactivity reminder for player=${player.player_id}:`,
        err,
      );
    }
  }

  console.log(
    `[${QUEUE}] Inactivity check complete: ${remindedCount}/${inactivePlayers.rows.length} reminders sent`,
  );
}
