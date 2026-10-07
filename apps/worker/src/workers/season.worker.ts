import { Worker, Job, ConnectionOptions } from 'bullmq';
import { QUEUE_NAMES, getRetryPolicy } from '../queues';
import { DeadLetterQueueHandler } from '../dlq';
import { getPool } from '../database';

const QUEUE = QUEUE_NAMES.SEASON;
const retryPolicy = getRetryPolicy(QUEUE);

// ============================================================
// Data types
// ============================================================

interface SeasonRow {
  id: string;
  starts_at: Date;
  ends_at: Date;
  status: string;
}

interface PlayerNetWorthRow {
  player_id: string;
  display_name: string;
  coins: string;
  net_worth: string;
}

interface TopCommodityRow {
  commodity_id: string;
  slug: string;
  name: string;
  total_produced: string;
}

interface MonopolyRow {
  player_id: string;
  display_name: string;
  commodity_slug: string;
  commodity_name: string;
  quantity: string;
  supply_percent: string;
}

// ============================================================
// season.end — End the current active season
// ============================================================

/**
 * Ends the currently active season:
 * 1. Set season status from ACTIVE to ENDED
 * 2. Halt all production jobs
 * 3. Cancel marketplace listings
 * 4. End all active events
 *
 * Job data may include: { seasonId?: string }
 * If no seasonId provided, ends the current ACTIVE season.
 */
async function processSeasonEnd(job: Job): Promise<void> {
  const pool = getPool();
  const { seasonId: requestedSeasonId } = job.data as { seasonId?: string };

  let season: SeasonRow | undefined;

  if (requestedSeasonId) {
    const result = await pool.query<SeasonRow>(
      `SELECT id, starts_at, ends_at, status FROM seasons WHERE id = $1`,
      [requestedSeasonId],
    );
    season = result.rows[0];
  } else {
    const result = await pool.query<SeasonRow>(
      `SELECT id, starts_at, ends_at, status FROM seasons WHERE status = 'ACTIVE' ORDER BY starts_at DESC LIMIT 1`,
    );
    season = result.rows[0];
  }

  if (!season) {
    console.log(`[${QUEUE}] season.end — no active season found`);
    return;
  }

  if (season.status !== 'ACTIVE') {
    console.log(`[${QUEUE}] season.end — season ${season.id} is ${season.status}, not ACTIVE. Skipping.`);
    return;
  }

  const seasonId = season.id;

  // 1. Set season status to ENDED
  await pool.query(
    `UPDATE seasons SET status = 'ENDED', ends_at = NOW() WHERE id = $1`,
    [seasonId],
  );

  // 2. Halt all active/paused production jobs in this season
  await pool.query(
    `UPDATE production_jobs
     SET status = 'CANCELLED', completed_at = NOW()
     WHERE season_id = $1 AND status IN ('ACTIVE', 'PAUSED')`,
    [seasonId],
  );

  // Set all producing/paused factories to IDLE
  await pool.query(
    `UPDATE factories
     SET status = 'IDLE'
     WHERE season_id = $1 AND status IN ('PRODUCING', 'PAUSED')`,
    [seasonId],
  );

  // 3. Cancel all active marketplace listings
  await pool.query(
    `UPDATE market_listings
     SET status = 'CANCELLED', cancelled_at = NOW()
     WHERE season_id = $1 AND status = 'ACTIVE'`,
    [seasonId],
  );

  // 4. End all active game events
  await pool.query(
    `UPDATE game_events
     SET status = 'ENDED', ends_at = NOW()
     WHERE season_id = $1 AND status = 'ACTIVE'`,
    [seasonId],
  );

  // Notify all players
  await notifyAllPlayers(
    pool,
    seasonId,
    'SEASON_ENDED',
    'Season has ended',
    'The current season has concluded. Final standings are being calculated.',
  );

  console.log(`[${QUEUE}] season.end — season ${seasonId} ended successfully`);
}

// ============================================================
// season.summary — Generate end-of-season summary
// ============================================================

/**
 * Generates the Season_Summary JSONB record:
 * - Wealthiest player (highest net worth)
 * - Highest-produced commodity (by total volume)
 * - Market monopoly (highest % of single commodity supply by one player)
 * - Final leaderboard (top 10 by net worth)
 *
 * Job data: { seasonId: string }
 */
async function processSeasonSummary(job: Job): Promise<void> {
  const pool = getPool();
  const { seasonId } = job.data as { seasonId: string };

  if (!seasonId) {
    console.warn(`[${QUEUE}] season.summary — missing seasonId in job data`);
    return;
  }

  // Verify season exists and is ENDED
  const seasonResult = await pool.query<SeasonRow>(
    `SELECT id, starts_at, ends_at, status FROM seasons WHERE id = $1`,
    [seasonId],
  );

  if (seasonResult.rows.length === 0) {
    console.warn(`[${QUEUE}] season.summary — season ${seasonId} not found`);
    return;
  }

  const season = seasonResult.rows[0];

  if (season.status !== 'ENDED') {
    console.warn(`[${QUEUE}] season.summary — season ${seasonId} is ${season.status}, expected ENDED`);
    return;
  }

  // 1. Calculate wealthiest player (highest net worth)
  // Net worth = coins + land value + factory value + inventory market value - outstanding debt
  const wealthiestResult = await pool.query<PlayerNetWorthRow>(
    `SELECT
       ps.player_id,
       p.display_name,
       ps.coins,
       (
         COALESCE(ps.coins, 0)
         + COALESCE((SELECT SUM(mt.purchase_price) FROM map_tiles mt WHERE mt.owner_player_id = ps.player_id AND mt.season_id = $1), 0)
         + COALESCE((SELECT SUM(f.setup_cost) FROM factories f WHERE f.player_id = ps.player_id AND f.season_id = $1), 0)
         + COALESCE((
           SELECT SUM(inv.quantity * COALESCE(cp.price, c.base_price))
           FROM inventory inv
           JOIN commodities c ON inv.commodity_id = c.id
           LEFT JOIN current_prices cp ON cp.commodity_id = c.id AND cp.season_id = $1
           WHERE inv.player_id = ps.player_id AND inv.season_id = $1
         ), 0)
         - COALESCE((SELECT SUM(l.outstanding_balance) FROM loans l WHERE l.player_id = ps.player_id AND l.season_id = $1 AND l.status = 'ACTIVE'), 0)
       ) as net_worth
     FROM player_seasons ps
     JOIN players p ON ps.player_id = p.id
     WHERE ps.season_id = $1
     ORDER BY net_worth DESC
     LIMIT 10`,
    [seasonId],
  );

  // 2. Highest-produced commodity (total volume from completed production jobs)
  const topCommodityResult = await pool.query<TopCommodityRow>(
    `SELECT
       pj.commodity_id,
       c.slug,
       c.name,
       SUM(pj.units_produced) as total_produced
     FROM production_jobs pj
     JOIN commodities c ON pj.commodity_id = c.id
     WHERE pj.season_id = $1 AND pj.status = 'COMPLETED'
     GROUP BY pj.commodity_id, c.slug, c.name
     ORDER BY total_produced DESC
     LIMIT 1`,
    [seasonId],
  );

  // 3. Market monopoly (highest % of a single commodity supply held by one player)
  const monopolyResult = await pool.query<MonopolyRow>(
    `WITH commodity_totals AS (
       SELECT commodity_id, SUM(quantity) as total_supply
       FROM inventory
       WHERE season_id = $1
       GROUP BY commodity_id
       HAVING SUM(quantity) > 0
     )
     SELECT
       inv.player_id,
       p.display_name,
       c.slug as commodity_slug,
       c.name as commodity_name,
       inv.quantity,
       CASE WHEN ct.total_supply > 0
         THEN (inv.quantity::decimal / ct.total_supply * 100)
         ELSE 0
       END as supply_percent
     FROM inventory inv
     JOIN commodities c ON inv.commodity_id = c.id
     JOIN commodity_totals ct ON ct.commodity_id = inv.commodity_id
     JOIN players p ON inv.player_id = p.id
     WHERE inv.season_id = $1
     ORDER BY supply_percent DESC
     LIMIT 1`,
    [seasonId],
  );

  // Build summary JSON
  const leaderboard = wealthiestResult.rows.map((row, index) => ({
    rank: index + 1,
    playerId: row.player_id,
    displayName: row.display_name,
    netWorth: parseFloat(row.net_worth),
    coins: parseFloat(row.coins),
  }));

  const topCommodity = topCommodityResult.rows[0]
    ? {
        commodityId: topCommodityResult.rows[0].commodity_id,
        slug: topCommodityResult.rows[0].slug,
        name: topCommodityResult.rows[0].name,
        totalProduced: parseInt(topCommodityResult.rows[0].total_produced, 10),
      }
    : null;

  const monopoly = monopolyResult.rows[0]
    ? {
        playerId: monopolyResult.rows[0].player_id,
        displayName: monopolyResult.rows[0].display_name,
        commoditySlug: monopolyResult.rows[0].commodity_slug,
        commodityName: monopolyResult.rows[0].commodity_name,
        quantity: parseInt(monopolyResult.rows[0].quantity, 10),
        supplyPercent: parseFloat(monopolyResult.rows[0].supply_percent),
      }
    : null;

  const wealthiest = leaderboard[0] || null;

  const summary = {
    generatedAt: new Date().toISOString(),
    seasonId,
    startsAt: season.starts_at,
    endsAt: season.ends_at,
    wealthiestPlayer: wealthiest,
    highestProducedCommodity: topCommodity,
    marketMonopoly: monopoly,
    leaderboard,
  };

  // Store summary in season record
  await pool.query(
    `UPDATE seasons SET summary = $1 WHERE id = $2`,
    [JSON.stringify(summary), seasonId],
  );

  console.log(
    `[${QUEUE}] season.summary — generated summary for season ${seasonId}: ` +
      `wealthiest=${wealthiest?.displayName || 'N/A'}, ` +
      `top commodity=${topCommodity?.name || 'N/A'}, ` +
      `monopoly=${monopoly?.displayName || 'N/A'} (${monopoly?.supplyPercent?.toFixed(1) || 0}% of ${monopoly?.commodityName || 'N/A'})`,
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
    console.warn(`[${QUEUE}] Failed to insert notifications for season ${seasonId}:`, err);
  }
}

// ============================================================
// Worker factory
// ============================================================

/**
 * Season worker handles:
 * - season.end — triggers end-of-season flow
 * - season.summary — generates season summary record
 *
 * Requirements: 13.5, 23.1, 23.2, 23.3, 23.4, 23.5
 */
export function createSeasonWorker(
  connection: ConnectionOptions,
  concurrency: number,
  dlqHandler: DeadLetterQueueHandler,
): Worker {
  const worker = new Worker(
    QUEUE,
    async (job: Job) => {
      console.log(`[${QUEUE}] Processing job ${job.name} (id: ${job.id})`);

      switch (job.name) {
        case 'season.end':
          await processSeasonEnd(job);
          break;
        case 'season.summary':
          await processSeasonSummary(job);
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
