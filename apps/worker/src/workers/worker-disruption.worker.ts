import { Worker, Job, ConnectionOptions } from 'bullmq';
import { calculateEffectiveCommitment } from '@sea-commodity-tycoon/game-rules';
import { QUEUE_NAMES, getRetryPolicy } from '../queues';
import { DeadLetterQueueHandler } from '../dlq';
import { getPool } from '../database';

const QUEUE = QUEUE_NAMES.WORKER;
const retryPolicy = getRetryPolicy(QUEUE);

/** Critical threshold — workers already ON_VACATION, skip disruption check */
const CRITICAL_THRESHOLD = 30;

/**
 * Worker disruption worker handles:
 * - worker.disruption_check — rolls for absence/sickness based on effective commitment (every 4h)
 * - worker.salary_deduction — deducts daily salary for all hired workers regardless of status
 *
 * Requirements: 4.2, 15.4, 25.6, 25.8
 */
export function createWorkerDisruptionWorker(
  connection: ConnectionOptions,
  concurrency: number,
  dlqHandler: DeadLetterQueueHandler,
): Worker {
  const worker = new Worker(
    QUEUE,
    async (job: Job) => {
      console.log(`[${QUEUE}] Processing job ${job.name} (id: ${job.id})`);

      switch (job.name) {
        case 'worker.disruption_check':
          await processDisruptionCheck();
          break;
        case 'worker.salary_deduction':
          await processSalaryDeduction();
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
 * Process disruption check for all players in the active season.
 * For each WORKING worker, rolls for ABSENT/SICK based on effective commitment.
 *
 * Disruption probability = (1 - effective_commitment / 100) × 0.1
 * Where effective_commitment = clamp(base_commitment × (happiness / 80), 0, 100)
 *
 * Disruption type: 60% ABSENT, 40% SICK
 * Duration: ABSENT 4-8h, SICK 8-24h
 */
async function processDisruptionCheck(): Promise<void> {
  const pool = getPool();

  // Get active season
  const seasonResult = await pool.query<{ id: string }>(
    `SELECT id FROM seasons WHERE status = 'ACTIVE' ORDER BY starts_at DESC LIMIT 1`,
  );

  if (seasonResult.rows.length === 0) {
    console.log(`[${QUEUE}] No active season found, skipping disruption check`);
    return;
  }

  const seasonId = seasonResult.rows[0].id;

  // --- Recovery: restore workers whose disruption period has ended ---
  const recovered = await pool.query(
    `UPDATE worker_assignments
     SET status = 'WORKING', status_changed_at = NOW(), disruption_ends_at = NULL
     WHERE season_id = $1 AND status IN ('ABSENT', 'SICK') AND disruption_ends_at <= NOW()
     RETURNING worker_id, factory_id`,
    [seasonId],
  );

  if ((recovered.rowCount ?? 0) > 0) {
    console.log(`[${QUEUE}] Recovered ${recovered.rowCount} workers from disruption`);
    // Recalibrate affected factories
    const affectedFactories = new Set(recovered.rows.map((r: any) => r.factory_id).filter(Boolean));
    for (const factoryId of affectedFactories) {
      await recalibrateFactory(pool, factoryId as string, seasonId);
    }
  }

  // --- Disruption rolls for WORKING workers ---

  // Get all player seasons (need happiness value)
  const playerSeasons = await pool.query<{
    player_id: string;
    workforce_happiness: string;
  }>(
    `SELECT player_id, workforce_happiness FROM player_seasons WHERE season_id = $1`,
    [seasonId],
  );

  let totalDisruptions = 0;

  for (const ps of playerSeasons.rows) {
    const happiness = parseFloat(ps.workforce_happiness);

    // Skip if happiness is at critical level (workers already ON_VACATION)
    if (happiness <= CRITICAL_THRESHOLD) {
      continue;
    }

    // Get all WORKING workers for this player, joined with their profile for commitment
    const workingWorkers = await pool.query<{
      id: string;
      worker_id: string;
      factory_id: string | null;
      commitment_level: string;
    }>(
      `SELECT wa.id, wa.worker_id, wa.factory_id, wp.commitment_level
       FROM worker_assignments wa
       JOIN worker_profiles wp ON wp.id = wa.worker_id
       WHERE wa.player_id = $1 AND wa.season_id = $2 AND wa.status = 'WORKING'`,
      [ps.player_id, seasonId],
    );

    for (const worker of workingWorkers.rows) {
      const baseCommitment = parseFloat(worker.commitment_level);
      const effectiveCommitment = calculateEffectiveCommitment(baseCommitment, happiness);

      // Disruption probability per 4-hour check
      const disruptionProbability = (1 - effectiveCommitment / 100) * 0.1;

      const roll = Math.random();
      if (roll < disruptionProbability) {
        // Determine type: 60% ABSENT, 40% SICK
        const disruptionType = Math.random() < 0.6 ? 'ABSENT' : 'SICK';

        // Duration: ABSENT 4-8h, SICK 8-24h
        const durationHours =
          disruptionType === 'ABSENT' ? 4 + Math.random() * 4 : 8 + Math.random() * 16;

        const endsAt = new Date(Date.now() + durationHours * 60 * 60 * 1000);

        await pool.query(
          `UPDATE worker_assignments
           SET status = $1, status_changed_at = NOW(), disruption_ends_at = $2
           WHERE id = $3`,
          [disruptionType, endsAt.toISOString(), worker.id],
        );

        // Check if factory has no remaining WORKING workers → pause production
        if (worker.factory_id) {
          const remainingWorking = await pool.query<{ count: string }>(
            `SELECT count(*)::text as count FROM worker_assignments
             WHERE factory_id = $1 AND season_id = $2 AND status = 'WORKING' AND id != $3`,
            [worker.factory_id, seasonId, worker.id],
          );
          if (parseInt(remainingWorking.rows[0]?.count ?? '0', 10) === 0) {
            // No working workers left — pause active production and set factory IDLE
            await pool.query(
              `UPDATE production_jobs SET status = 'PAUSED', paused_at = NOW(), pause_reason = 'WORKERS_UNAVAILABLE'
               WHERE factory_id = $1 AND status = 'ACTIVE'`,
              [worker.factory_id],
            );
            await pool.query(
              `UPDATE factories SET status = 'IDLE' WHERE id = $1`,
              [worker.factory_id],
            );
            console.log(
              `[${QUEUE}] Factory ${worker.factory_id} paused: all workers unavailable`,
            );
          } else {
            // Some workers still active — recalibrate yield mid-cycle
            await recalibrateFactory(pool, worker.factory_id, seasonId);
          }
        }

        totalDisruptions++;

        console.log(
          `[${QUEUE}] Worker disruption: worker=${worker.worker_id}, player=${ps.player_id}, type=${disruptionType}, ends=${endsAt.toISOString()}`,
        );
      }
    }
  }

  console.log(
    `[${QUEUE}] Disruption check complete: ${totalDisruptions} disruptions triggered`,
  );
}

/**
 * Process daily salary deductions for all hired workers regardless of status.
 * Workers continue to be paid even when ABSENT, SICK, or ON_VACATION.
 *
 * For each hired worker:
 * - Deduct daily salary from player's wallet (coins)
 * - Record WORKER_WAGE transaction in wallet_transactions
 * - If insufficient funds, log warning but don't fail (best-effort for MVP)
 */
async function processSalaryDeduction(): Promise<void> {
  const pool = getPool();

  // Get active season
  const seasonResult = await pool.query<{ id: string }>(
    `SELECT id FROM seasons WHERE status = 'ACTIVE' ORDER BY starts_at DESC LIMIT 1`,
  );

  if (seasonResult.rows.length === 0) {
    console.log(`[${QUEUE}] No active season found, skipping salary deduction`);
    return;
  }

  const seasonId = seasonResult.rows[0].id;

  // Get all hired workers grouped by player (any status except UNASSIGNED means hired)
  // Join with worker_profiles for salary amount
  const hiredWorkers = await pool.query<{
    player_id: string;
    worker_id: string;
    salary: string;
  }>(
    `SELECT wa.player_id, wa.worker_id, wp.salary
     FROM worker_assignments wa
     JOIN worker_profiles wp ON wp.id = wa.worker_id
     WHERE wa.season_id = $1 AND wa.status != 'UNASSIGNED'`,
    [seasonId],
  );

  if (hiredWorkers.rows.length === 0) {
    console.log(`[${QUEUE}] No hired workers found, skipping salary deduction`);
    return;
  }

  // Aggregate salary per player
  const playerSalaries = new Map<string, { total: number; workerCount: number }>();
  for (const row of hiredWorkers.rows) {
    const existing = playerSalaries.get(row.player_id) || { total: 0, workerCount: 0 };
    existing.total += parseFloat(row.salary);
    existing.workerCount++;
    playerSalaries.set(row.player_id, existing);
  }

  let successCount = 0;
  let failCount = 0;

  for (const [playerId, { total, workerCount }] of playerSalaries) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Lock player's wallet row
      const walletResult = await client.query<{ id: string; coins: string }>(
        `SELECT id, coins FROM player_seasons
         WHERE player_id = $1 AND season_id = $2
         FOR UPDATE`,
        [playerId, seasonId],
      );

      if (walletResult.rows.length === 0) {
        await client.query('ROLLBACK');
        continue;
      }

      const currentCoins = parseFloat(walletResult.rows[0].coins);
      const deduction = total;

      // Check if player has sufficient funds
      if (currentCoins < deduction) {
        // Deduct what we can (down to 0) — for MVP, we don't enforce full payment
        const actualDeduction = currentCoins;
        const newBalance = 0;

        await client.query(
          `UPDATE player_seasons SET coins = $1 WHERE id = $2`,
          [newBalance.toFixed(2), walletResult.rows[0].id],
        );

        // Record wallet transaction
        await client.query(
          `INSERT INTO wallet_transactions (id, player_id, season_id, transaction_type, amount, balance_after, reference_type, reference_id, description, created_at)
           VALUES (gen_random_uuid(), $1, $2, 'WORKER_WAGE', $3, $4, 'salary_deduction', 'daily', $5, NOW())`,
          [
            playerId,
            seasonId,
            (-actualDeduction).toFixed(2),
            newBalance.toFixed(2),
            `Daily salary for ${workerCount} workers (partial: insufficient funds)`,
          ],
        );

        console.warn(
          `[${QUEUE}] Insufficient funds for salary: player=${playerId}, needed=${deduction.toFixed(2)}, had=${currentCoins.toFixed(2)}`,
        );
        failCount++;
      } else {
        const newBalance = currentCoins - deduction;

        await client.query(
          `UPDATE player_seasons SET coins = $1 WHERE id = $2`,
          [newBalance.toFixed(2), walletResult.rows[0].id],
        );

        // Record wallet transaction
        await client.query(
          `INSERT INTO wallet_transactions (id, player_id, season_id, transaction_type, amount, balance_after, reference_type, reference_id, description, created_at)
           VALUES (gen_random_uuid(), $1, $2, 'WORKER_WAGE', $3, $4, 'salary_deduction', 'daily', $5, NOW())`,
          [
            playerId,
            seasonId,
            (-deduction).toFixed(2),
            newBalance.toFixed(2),
            `Daily salary for ${workerCount} workers`,
          ],
        );

        successCount++;
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(
        `[${QUEUE}] Error processing salary for player=${playerId}:`,
        err,
      );
      failCount++;
    } finally {
      client.release();
    }
  }

  console.log(
    `[${QUEUE}] Salary deduction complete: ${successCount} players charged, ${failCount} failed/partial, ${hiredWorkers.rows.length} total workers`,
  );
}


/**
 * Recalibrate a factory's active production job based on current WORKING workers.
 * Called when a worker goes absent/sick or recovers mid-cycle.
 */
async function recalibrateFactory(pool: ReturnType<typeof getPool>, factoryId: string, seasonId: string): Promise<void> {
  // Get the active production job
  const jobResult = await pool.query<{
    id: string; commodity_id: string; final_yield: number; units_produced: number; increment_interval_minutes: number;
  }>(
    `SELECT id, commodity_id, final_yield, units_produced, increment_interval_minutes
     FROM production_jobs WHERE factory_id = $1 AND status = 'ACTIVE' LIMIT 1`,
    [factoryId],
  );
  if (jobResult.rows.length === 0) return;
  const job = jobResult.rows[0];

  // Get factory info
  const factoryResult = await pool.query<{ category: string; factory_level: number }>(
    `SELECT category, factory_level FROM factories WHERE id = $1`, [factoryId],
  );
  if (factoryResult.rows.length === 0) return;
  const factory = factoryResult.rows[0];

  // Get WORKING workers
  const workers = await pool.query<{ specialty: string; experience_level: number }>(
    `SELECT wp.specialty, wp.experience_level FROM worker_assignments wa
     JOIN worker_profiles wp ON wa.worker_id = wp.id
     WHERE wa.factory_id = $1 AND wa.season_id = $2 AND wa.status = 'WORKING'`,
    [factoryId, seasonId],
  );

  // Get commodity base data
  const commodity = await pool.query<{ base_yield: number; base_production_time_minutes: number }>(
    `SELECT base_yield, base_production_time_minutes FROM commodities WHERE id = $1`, [job.commodity_id],
  );
  if (commodity.rows.length === 0) return;
  const baseYield = commodity.rows[0].base_yield;
  const prodTime = commodity.rows[0].base_production_time_minutes;

  // Get player specialty
  const ps = await pool.query<{ specialty: string | null }>(
    `SELECT ps.specialty FROM player_seasons ps
     JOIN factories f ON ps.player_id = f.player_id AND ps.season_id = $2
     WHERE f.id = $1`, [factoryId, seasonId],
  );
  const playerSpecialty = ps.rows[0]?.specialty;

  // Calculate bonuses
  const specCatMap: Record<string, string> = {
    'rice': 'AGRICULTURE', 'palm-fruit': 'AGRICULTURE', 'cocoa': 'AGRICULTURE', 'coffee': 'AGRICULTURE',
    'crude-oil': 'ENERGY', 'natural-gas': 'ENERGY', 'iron-ore': 'METAL', 'nickel-ore': 'METAL',
    'poultry': 'LIVESTOCK', 'cattle': 'LIVESTOCK', 'fish': 'FISHERY', 'timber': 'FORESTRY', 'rubber': 'FORESTRY',
  };
  const roleCatMap: Record<string, string> = {
    'farmer': 'AGRICULTURE', 'miner': 'METAL', 'fisherman': 'FISHERY',
    'driller': 'ENERGY', 'rancher': 'LIVESTOCK', 'lumberjack': 'FORESTRY',
  };

  let bonus = 0;
  if (playerSpecialty && specCatMap[playerSpecialty] === factory.category) bonus += 0.10;
  if (workers.rows.length >= 2) bonus += 0.25;
  for (const w of workers.rows) {
    let isMatch = false;
    if (factory.factory_level === 0) isMatch = roleCatMap[w.specialty] === factory.category;
    else if (factory.factory_level === 1) {
      if (['ENERGY', 'METAL', 'FORESTRY'].includes(factory.category)) isMatch = w.specialty === 'engineer';
      else isMatch = roleCatMap[w.specialty] === factory.category;
    } else if (factory.factory_level === 2) isMatch = w.specialty === 'technician';
    if (isMatch) bonus += w.experience_level / 100;
  }

  const newFinalYield = Math.floor(baseYield * (1 + bonus));
  const newInterval = Math.max(1, Math.round(prodTime / newFinalYield));

  // Update job
  await pool.query(
    `UPDATE production_jobs SET final_yield = $1, increment_interval_minutes = $2 WHERE id = $3`,
    [newFinalYield, newInterval, job.id],
  );

  console.log(
    `[${QUEUE}] Recalibrated factory ${factoryId}: yield ${job.final_yield}→${newFinalYield}, interval ${job.increment_interval_minutes}→${newInterval}min`,
  );
}
