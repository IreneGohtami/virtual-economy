import { Worker, Job, Queue, ConnectionOptions } from 'bullmq';
import { QUEUE_NAMES, getRetryPolicy } from '../queues';
import { DeadLetterQueueHandler } from '../dlq';
import { getPool } from '../database';

const QUEUE = QUEUE_NAMES.EVENTS;
const retryPolicy = getRetryPolicy(QUEUE);

/** BullMQ Queue for scheduling event.end follow-up jobs */
let eventsQueue: Queue | null = null;

function getEventsQueue(connection: ConnectionOptions): Queue {
  if (!eventsQueue) {
    eventsQueue = new Queue(QUEUE, { connection });
  }
  return eventsQueue;
}

// ============================================================
// Data types
// ============================================================

interface GameEventRow {
  id: string;
  season_id: string;
  event_type: string;
  name: string;
  starts_at: Date;
  ends_at: Date;
  affected_categories: string[];
  production_modifier: string | null;
  demand_modifier: string | null;
  price_modifier: string | null;
  status: string;
}

// ============================================================
// event.trigger — Activate a scheduled event
// ============================================================

/**
 * Activates an event by setting its status from SCHEDULED to ACTIVE.
 *
 * Job data may include:
 * - eventId: UUID of a specific event to activate
 * - If no eventId, scans for SCHEDULED events whose starts_at <= NOW
 *
 * After activation, schedules an `event.end` job delayed until the event's ends_at.
 */
async function processEventTrigger(
  job: Job,
  connection: ConnectionOptions,
): Promise<void> {
  const pool = getPool();
  const { eventId } = job.data as { eventId?: string };

  let events: GameEventRow[];

  if (eventId) {
    // Activate a specific event
    const result = await pool.query<GameEventRow>(
      `SELECT id, season_id, event_type, name, starts_at, ends_at,
              affected_categories, production_modifier, demand_modifier, price_modifier, status
       FROM game_events
       WHERE id = $1 AND status = 'SCHEDULED'`,
      [eventId],
    );
    events = result.rows;
  } else {
    // Find all SCHEDULED events whose start time has arrived
    const result = await pool.query<GameEventRow>(
      `SELECT ge.id, ge.season_id, ge.event_type, ge.name, ge.starts_at, ge.ends_at,
              ge.affected_categories, ge.production_modifier, ge.demand_modifier, ge.price_modifier, ge.status
       FROM game_events ge
       JOIN seasons s ON ge.season_id = s.id
       WHERE s.status = 'ACTIVE'
         AND ge.status = 'SCHEDULED'
         AND ge.starts_at <= NOW()`,
    );
    events = result.rows;
  }

  if (events.length === 0) {
    console.log(`[${QUEUE}] event.trigger — no scheduled events to activate`);
    return;
  }

  const queue = getEventsQueue(connection);

  for (const event of events) {
    // Set status to ACTIVE
    await pool.query(
      `UPDATE game_events SET status = 'ACTIVE' WHERE id = $1`,
      [event.id],
    );

    console.log(
      `[${QUEUE}] event.trigger — activated event "${event.name}" (${event.event_type}), ` +
        `categories: [${event.affected_categories.join(', ')}], ` +
        `modifiers: prod=${event.production_modifier}, demand=${event.demand_modifier}, price=${event.price_modifier}`,
    );

    // Schedule event.end job delayed until ends_at
    const delayMs = Math.max(0, new Date(event.ends_at).getTime() - Date.now());

    await queue.add(
      'event.end',
      { eventId: event.id },
      {
        delay: delayMs,
        jobId: `event-end-${event.id}`,
        removeOnComplete: true,
        removeOnFail: false,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );

    // Insert notification for all players in the season
    await notifyAllPlayers(
      pool,
      event.season_id,
      'EVENT_STARTED',
      `Event: ${event.name}`,
      `A ${event.event_type} event has begun affecting ${event.affected_categories.join(', ')} categories.`,
    );
  }

  console.log(`[${QUEUE}] event.trigger — activated ${events.length} event(s)`);
}

// ============================================================
// event.end — Deactivate an active event
// ============================================================

/**
 * Ends an active event by setting status to ENDED and updating ends_at to NOW.
 *
 * Job data: { eventId: string }
 */
async function processEventEnd(job: Job): Promise<void> {
  const pool = getPool();
  const { eventId } = job.data as { eventId: string };

  if (!eventId) {
    console.warn(`[${QUEUE}] event.end — missing eventId in job data`);
    return;
  }

  // Fetch the event to verify it's ACTIVE
  const result = await pool.query<GameEventRow>(
    `SELECT id, season_id, event_type, name, starts_at, ends_at,
            affected_categories, production_modifier, demand_modifier, price_modifier, status
     FROM game_events
     WHERE id = $1`,
    [eventId],
  );

  if (result.rows.length === 0) {
    console.warn(`[${QUEUE}] event.end — event ${eventId} not found`);
    return;
  }

  const event = result.rows[0];

  if (event.status !== 'ACTIVE') {
    console.log(`[${QUEUE}] event.end — event ${eventId} is ${event.status}, not ACTIVE. Skipping.`);
    return;
  }

  // Set status to ENDED, update ends_at to now
  await pool.query(
    `UPDATE game_events SET status = 'ENDED', ends_at = NOW() WHERE id = $1`,
    [eventId],
  );

  console.log(
    `[${QUEUE}] event.end — deactivated event "${event.name}" (${event.event_type}), ` +
      `categories: [${event.affected_categories.join(', ')}]`,
  );

  // Notify all players that the event has ended
  await notifyAllPlayers(
    pool,
    event.season_id,
    'EVENT_ENDED',
    `Event ended: ${event.name}`,
    `The ${event.event_type} event affecting ${event.affected_categories.join(', ')} has ended. Normal conditions restored.`,
  );
}

// ============================================================
// Helper functions
// ============================================================

/**
 * Send a notification to all players in a given season.
 */
async function notifyAllPlayers(
  pool: ReturnType<typeof getPool>,
  seasonId: string,
  type: string,
  title: string,
  body: string,
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO notifications (id, player_id, season_id, type, title, body, priority, read, delivered)
       SELECT gen_random_uuid(), ps.player_id, ps.season_id, $1, $2, $3, 'HIGH', false, false
       FROM player_seasons ps
       WHERE ps.season_id = $4`,
      [type, title, body, seasonId],
    );
  } catch (err) {
    // Non-critical — log and continue
    console.warn(`[${QUEUE}] Failed to insert notifications for season ${seasonId}:`, err);
  }
}

// ============================================================
// Worker factory
// ============================================================

/**
 * Event worker handles:
 * - event.trigger — activates random economic/natural events
 * - event.end — deactivates event modifiers
 *
 * Requirements: 14.1, 14.5
 */
export function createEventWorker(
  connection: ConnectionOptions,
  concurrency: number,
  dlqHandler: DeadLetterQueueHandler,
): Worker {
  const worker = new Worker(
    QUEUE,
    async (job: Job) => {
      console.log(`[${QUEUE}] Processing job ${job.name} (id: ${job.id})`);

      switch (job.name) {
        case 'event.trigger':
          await processEventTrigger(job, connection);
          break;
        case 'event.end':
          await processEventEnd(job);
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
