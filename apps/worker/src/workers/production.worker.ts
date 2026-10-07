import { Worker, Job, Queue, ConnectionOptions } from 'bullmq';
import { QUEUE_NAMES, getRetryPolicy } from '../queues';
import { DeadLetterQueueHandler } from '../dlq';
import { getPool } from '../database';

const QUEUE = QUEUE_NAMES.PRODUCTION;
const retryPolicy = getRetryPolicy(QUEUE);

/** BullMQ Queue instance used to schedule follow-up increment jobs from within the worker */
let productionQueue: Queue | null = null;

function getProductionQueue(connection: ConnectionOptions): Queue {
  if (!productionQueue) {
    productionQueue = new Queue(QUEUE, { connection });
  }
  return productionQueue;
}

// ============================================================
// Data types
// ============================================================

interface ProductionJobRow {
  id: string;
  player_id: string;
  factory_id: string;
  commodity_id: string;
  season_id: string;
  status: string;
  final_yield: number;
  units_produced: number;
  increment_interval_minutes: number;
  pause_reason: string | null;
  recipe_id: string | null;
}

interface WorkerAssignmentRow {
  id: string;
  status: string;
}

// ============================================================
// production.increment — Process a single production unit
// ============================================================

/**
 * Process one production increment:
 * 1. Fetch the production job, ensure it's still ACTIVE
 * 2. Check workers are not all absent/on vacation (handle workforce disruption)
 * 3. Check storage capacity for 1 more unit
 * 4. If capacity: add 1 unit to inventory, update units_produced
 * 5. If full: pause with STORAGE_FULL
 * 6. If all units done: mark COMPLETED, factory → IDLE
 * 7. Otherwise: schedule next increment
 */
async function processIncrement(
  job: Job,
  connection: ConnectionOptions,
): Promise<void> {
  const { jobId } = job.data as { jobId: string };
  const pool = getPool();

  // 1. Fetch production job
  const jobResult = await pool.query<ProductionJobRow>(
    `SELECT id, player_id, factory_id, commodity_id, season_id,
            status, final_yield, units_produced, increment_interval_minutes, pause_reason, recipe_id
     FROM production_jobs
     WHERE id = $1`,
    [jobId],
  );

  if (jobResult.rows.length === 0) {
    console.warn(`[${QUEUE}] production.increment — job ${jobId} not found, skipping`);
    return;
  }

  const prodJob = jobResult.rows[0];

  if (prodJob.status !== 'ACTIVE') {
    console.log(
      `[${QUEUE}] production.increment — job ${jobId} is ${prodJob.status}, not ACTIVE. Skipping.`,
    );
    return;
  }

  // 2. Check worker availability for this factory
  const workersResult = await pool.query<WorkerAssignmentRow>(
    `SELECT id, status
     FROM worker_assignments
     WHERE factory_id = $1 AND season_id = $2`,
    [prodJob.factory_id, prodJob.season_id],
  );

  const workers = workersResult.rows;
  const activeWorkers = workers.filter(
    (w) => w.status === 'WORKING',
  );

  // If ALL workers are absent/sick/on_vacation, pause production
  if (workers.length > 0 && activeWorkers.length === 0) {
    await pauseProductionJob(prodJob, 'WORKERS_UNAVAILABLE');
    console.log(
      `[${QUEUE}] production.increment — job ${jobId} paused: all workers unavailable`,
    );
    return;
  }

  // 3. Check storage capacity
  const hasCapacity = await checkStorageCapacity(
    prodJob.player_id,
    prodJob.season_id,
    prodJob.commodity_id,
    1,
  );

  if (!hasCapacity) {
    await pauseProductionJob(prodJob, 'STORAGE_FULL');
    console.log(
      `[${QUEUE}] production.increment — job ${jobId} paused: storage full`,
    );
    return;
  }

  // 4. Add 1 unit to inventory (upsert)
  await pool.query(
    `INSERT INTO inventory (id, player_id, season_id, commodity_id, quantity)
     VALUES (gen_random_uuid(), $1, $2, $3, 1)
     ON CONFLICT (player_id, season_id, commodity_id)
     DO UPDATE SET quantity = inventory.quantity + 1`,
    [prodJob.player_id, prodJob.season_id, prodJob.commodity_id],
  );

  // 5. Update units_produced
  const newUnitsProduced = prodJob.units_produced + 1;

  // 6. Check if production is complete
  if (newUnitsProduced >= prodJob.final_yield) {
    await pool.query(
      `UPDATE production_jobs
       SET units_produced = $1, status = 'COMPLETED', completed_at = NOW()
       WHERE id = $2`,
      [newUnitsProduced, jobId],
    );

    console.log(
      `[${QUEUE}] production.increment — job ${jobId} COMPLETED (${newUnitsProduced}/${prodJob.final_yield} units)`,
    );

    // Insert notification for production complete
    await insertNotification(
      prodJob.player_id,
      prodJob.season_id,
      'PRODUCTION_COMPLETE',
      'Production complete',
      `Your factory has finished producing ${newUnitsProduced} units.`,
    );

    // Auto-loop: check if workers are still assigned, if so start a new cycle
    const workersStillAssigned = await pool.query<{ count: string }>(
      `SELECT count(*)::text as count FROM worker_assignments WHERE factory_id = $1 AND season_id = $2 AND status = 'WORKING'`,
      [prodJob.factory_id, prodJob.season_id],
    );
    const workerCount = parseInt(workersStillAssigned.rows[0]?.count ?? '0', 10);

    if (workerCount > 0) {
      // Start a new production cycle immediately
      await startNewProductionCycle(pool, prodJob, connection);
    } else {
      // No workers — set factory to IDLE
      await pool.query(
        `UPDATE factories SET status = 'IDLE' WHERE id = $1`,
        [prodJob.factory_id],
      );
    }

    return;
  }

  // Save updated units count
  await pool.query(
    `UPDATE production_jobs SET units_produced = $1 WHERE id = $2`,
    [newUnitsProduced, jobId],
  );

  // 7. Schedule next increment
  await scheduleNextIncrement(
    connection,
    prodJob,
    newUnitsProduced,
  );

  console.log(
    `[${QUEUE}] production.increment — job ${jobId} produced unit ${newUnitsProduced}/${prodJob.final_yield}`,
  );
}

// ============================================================
// production.check_resume — Resume paused jobs when inventory frees up
// ============================================================

/**
 * Check paused production jobs for a player and resume if capacity is now available.
 * Triggered when inventory decreases (sell, list on marketplace) or storage upgrades.
 */
async function processCheckResume(
  job: Job,
  connection: ConnectionOptions,
): Promise<void> {
  const { playerId, seasonId } = job.data as { playerId: string; seasonId: string };
  const pool = getPool();

  // Find all paused jobs for this player with STORAGE_FULL reason
  const pausedResult = await pool.query<ProductionJobRow>(
    `SELECT id, player_id, factory_id, commodity_id, season_id,
            status, final_yield, units_produced, increment_interval_minutes, pause_reason, recipe_id
     FROM production_jobs
     WHERE player_id = $1
       AND season_id = $2
       AND status = 'PAUSED'
       AND pause_reason = 'STORAGE_FULL'`,
    [playerId, seasonId],
  );

  if (pausedResult.rows.length === 0) {
    return;
  }

  let resumed = 0;

  for (const pausedJob of pausedResult.rows) {
    const hasCapacity = await checkStorageCapacity(
      pausedJob.player_id,
      pausedJob.season_id,
      pausedJob.commodity_id,
      1,
    );

    if (hasCapacity) {
      await resumeProductionJob(pausedJob, connection);
      resumed++;
    }
  }

  if (resumed > 0) {
    console.log(
      `[${QUEUE}] production.check_resume — resumed ${resumed} paused jobs for player ${playerId}`,
    );
  }
}

// ============================================================
// Startup recovery — scan for overdue ACTIVE jobs
// ============================================================

/**
 * On worker startup, scans for ACTIVE production jobs whose next increment
 * is overdue (last scheduled increment time has passed). This handles
 * server restart scenarios where delayed BullMQ jobs may have been lost.
 *
 * Called once when the production worker is created.
 */
export async function recoverOverdueJobs(connection: ConnectionOptions): Promise<void> {
  const pool = getPool();

  // Find ACTIVE jobs where the expected next increment time has passed.
  // The "next expected increment" = started_at + (units_produced + 1) * interval
  // If that time is in the past, the job is overdue.
  const overdueResult = await pool.query<ProductionJobRow>(
    `SELECT id, player_id, factory_id, commodity_id, season_id,
            status, final_yield, units_produced, increment_interval_minutes, pause_reason, recipe_id
     FROM production_jobs
     WHERE status = 'ACTIVE'
       AND (started_at + ((units_produced + 1) * increment_interval_minutes || ' minutes')::interval) <= NOW()`,
  );

  if (overdueResult.rows.length === 0) {
    console.log(`[${QUEUE}] Startup recovery: no overdue production jobs found`);
    return;
  }

  console.log(
    `[${QUEUE}] Startup recovery: found ${overdueResult.rows.length} overdue production jobs`,
  );

  const queue = getProductionQueue(connection);

  for (const overdueJob of overdueResult.rows) {
    // Schedule an immediate increment for this job
    await queue.add(
      'production.increment',
      {
        jobId: overdueJob.id,
        playerId: overdueJob.player_id,
        factoryId: overdueJob.factory_id,
        commodityId: overdueJob.commodity_id,
        seasonId: overdueJob.season_id,
        finalYield: overdueJob.final_yield,
        unitsProduced: overdueJob.units_produced,
        incrementIntervalMinutes: overdueJob.increment_interval_minutes,
      },
      {
        delay: 0, // Process immediately — it's overdue
        jobId: `recovery-${overdueJob.id}-${overdueJob.units_produced + 1}`,
        removeOnComplete: true,
        removeOnFail: false,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );
  }

  console.log(
    `[${QUEUE}] Startup recovery: scheduled ${overdueResult.rows.length} immediate increment jobs`,
  );
}

// ============================================================
// Helper functions
// ============================================================

/**
 * Check if the player has storage capacity for additional units of a commodity.
 */
async function checkStorageCapacity(
  playerId: string,
  seasonId: string,
  commodityId: string,
  quantity: number,
): Promise<boolean> {
  const pool = getPool();

  // Get the commodity's storage_size
  const commodityResult = await pool.query<{ storage_size: number }>(
    `SELECT storage_size FROM commodities WHERE id = $1`,
    [commodityId],
  );

  if (commodityResult.rows.length === 0) return false;

  const storageSize = commodityResult.rows[0].storage_size;

  // Get player's storage capacity
  const playerResult = await pool.query<{ storage_capacity: number }>(
    `SELECT storage_capacity FROM player_seasons WHERE player_id = $1 AND season_id = $2`,
    [playerId, seasonId],
  );

  if (playerResult.rows.length === 0) return false;

  const capacity = playerResult.rows[0].storage_capacity;

  // Calculate current storage usage
  const usageResult = await pool.query<{ total: string }>(
    `SELECT COALESCE(SUM(inv.quantity * c.storage_size), 0) AS total
     FROM inventory inv
     JOIN commodities c ON inv.commodity_id = c.id
     WHERE inv.player_id = $1 AND inv.season_id = $2`,
    [playerId, seasonId],
  );

  const currentUsage = parseInt(usageResult.rows[0]?.total ?? '0', 10);
  const additionalStorage = quantity * storageSize;

  return currentUsage + additionalStorage <= capacity;
}

/**
 * Pause a production job and set its factory to PAUSED.
 */
async function pauseProductionJob(
  prodJob: ProductionJobRow,
  reason: string,
): Promise<void> {
  const pool = getPool();

  await pool.query(
    `UPDATE production_jobs
     SET status = 'PAUSED', paused_at = NOW(), pause_reason = $1
     WHERE id = $2`,
    [reason, prodJob.id],
  );

  await pool.query(
    `UPDATE factories SET status = 'PAUSED' WHERE id = $1`,
    [prodJob.factory_id],
  );
}

/**
 * Resume a paused production job:
 * - Set status back to ACTIVE
 * - Clear pause fields
 * - Recalculate completes_at
 * - Set factory to PRODUCING
 * - Schedule next increment
 */
async function resumeProductionJob(
  prodJob: ProductionJobRow,
  connection: ConnectionOptions,
): Promise<void> {
  const pool = getPool();
  const remainingUnits = prodJob.final_yield - prodJob.units_produced;
  const remainingTimeMs = remainingUnits * prodJob.increment_interval_minutes * 60 * 1000;
  const newCompletesAt = new Date(Date.now() + remainingTimeMs);

  await pool.query(
    `UPDATE production_jobs
     SET status = 'ACTIVE',
         paused_at = NULL,
         pause_reason = NULL,
         completes_at = $1
     WHERE id = $2`,
    [newCompletesAt.toISOString(), prodJob.id],
  );

  await pool.query(
    `UPDATE factories SET status = 'PRODUCING' WHERE id = $1`,
    [prodJob.factory_id],
  );

  // Schedule next increment
  await scheduleNextIncrement(connection, prodJob, prodJob.units_produced);
}

/**
 * Schedule the next production.increment job via BullMQ.
 */
async function scheduleNextIncrement(
  connection: ConnectionOptions,
  prodJob: ProductionJobRow,
  currentUnitsProduced: number,
): Promise<void> {
  const queue = getProductionQueue(connection);
  const delayMs = prodJob.increment_interval_minutes * 60 * 1000;
  const nextUnit = currentUnitsProduced + 1;

  await queue.add(
    'production.increment',
    {
      jobId: prodJob.id,
      playerId: prodJob.player_id,
      factoryId: prodJob.factory_id,
      commodityId: prodJob.commodity_id,
      seasonId: prodJob.season_id,
      finalYield: prodJob.final_yield,
      unitsProduced: currentUnitsProduced,
      incrementIntervalMinutes: prodJob.increment_interval_minutes,
    },
    {
      delay: delayMs,
      jobId: `increment-${prodJob.id}-${nextUnit}`,
      removeOnComplete: true,
      removeOnFail: false,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    },
  );
}

interface RecipeInputRow {
  commodity_id: string;
  slug: string;
  name: string;
  quantity: number;
}

/**
 * For L1/L2 factories (recipes with inputs), atomically validate that the player
 * has enough input commodities in inventory and consume (deduct) them for one cycle.
 *
 * Returns:
 *   { ok: true, snapshot } when inputs were consumed (or when the recipe has no inputs)
 *   { ok: false, missing } when inventory is insufficient — caller should NOT start a cycle
 */
async function consumeRecipeInputs(
  pool: ReturnType<typeof getPool>,
  recipeId: string | null,
  playerId: string,
  seasonId: string,
  factoryId: string,
): Promise<
  | { ok: true; snapshot: Record<string, unknown> | null; recipeId: string | null }
  | { ok: false; missing: string }
> {
  // Fall back to the factory's recipe if the job row lacks one (older jobs
  // created before recipe_id was propagated may have a NULL recipe_id).
  let resolvedRecipeId = recipeId;
  if (!resolvedRecipeId) {
    const factoryRecipe = await pool.query<{ recipe_id: string | null }>(
      `SELECT recipe_id FROM factories WHERE id = $1`,
      [factoryId],
    );
    resolvedRecipeId = factoryRecipe.rows[0]?.recipe_id ?? null;
  }

  // L0 factories (no recipe) never have inputs
  if (!resolvedRecipeId) {
    return { ok: true, snapshot: null, recipeId: null };
  }

  const inputsResult = await pool.query<RecipeInputRow>(
    `SELECT ri.commodity_id, c.slug, c.name, ri.quantity
     FROM recipe_inputs ri
     JOIN commodities c ON c.id = ri.commodity_id
     WHERE ri.recipe_id = $1`,
    [resolvedRecipeId],
  );

  const inputs = inputsResult.rows;
  if (inputs.length === 0) {
    return { ok: true, snapshot: null, recipeId: resolvedRecipeId };
  }

  // Consume atomically inside a transaction; validate availability first.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const snapshot: Record<string, unknown> = {};

    for (const input of inputs) {
      const invResult = await client.query<{ quantity: string }>(
        `SELECT quantity FROM inventory
         WHERE player_id = $1 AND season_id = $2 AND commodity_id = $3
         FOR UPDATE`,
        [playerId, seasonId, input.commodity_id],
      );
      const available = parseInt(invResult.rows[0]?.quantity ?? '0', 10);

      if (available < input.quantity) {
        await client.query('ROLLBACK');
        return {
          ok: false,
          missing: `${input.name} (need ${input.quantity}, have ${available})`,
        };
      }

      snapshot[input.commodity_id] = {
        commodityId: input.commodity_id,
        slug: input.slug,
        quantity: input.quantity,
      };
    }

    // All inputs available — deduct them
    for (const input of inputs) {
      await client.query(
        `UPDATE inventory SET quantity = quantity - $1
         WHERE player_id = $2 AND season_id = $3 AND commodity_id = $4`,
        [input.quantity, playerId, seasonId, input.commodity_id],
      );
    }

    await client.query('COMMIT');
    return { ok: true, snapshot, recipeId: resolvedRecipeId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Start a new production cycle for a factory that just completed.
 * Re-uses the same parameters (commodity, yield modifiers) from the completed job.
 *
 * For L1/L2 factories this first consumes the recipe's input commodities. If the
 * player lacks sufficient inputs, the factory goes IDLE instead of looping — this
 * ensures raw materials (L0) are deducted for every cycle, not just the first.
 */
async function startNewProductionCycle(
  pool: ReturnType<typeof getPool>,
  completedJob: ProductionJobRow,
  connection: ConnectionOptions,
): Promise<void> {
  const queue = getProductionQueue(connection);

  // Consume recipe inputs for this new cycle (L1/L2 only)
  const inputResult = await consumeRecipeInputs(
    pool,
    completedJob.recipe_id,
    completedJob.player_id,
    completedJob.season_id,
    completedJob.factory_id,
  );

  if (!inputResult.ok) {
    // Not enough raw materials — stop looping, set factory IDLE and notify player
    await pool.query(
      `UPDATE factories SET status = 'IDLE' WHERE id = $1`,
      [completedJob.factory_id],
    );
    await insertNotification(
      completedJob.player_id,
      completedJob.season_id,
      'PRODUCTION_HALTED',
      'Production halted — missing materials',
      `Your factory ran out of raw materials: ${inputResult.missing}. Restock to resume production.`,
    );
    console.log(
      `[${QUEUE}] Auto-loop halted: factory ${completedJob.factory_id} lacks inputs (${inputResult.missing}) → IDLE`,
    );
    return;
  }

  const inputSnapshot = inputResult.snapshot;
  const resolvedRecipeId = inputResult.recipeId ?? completedJob.recipe_id;

  // Create a new production job with the same parameters
  const completesAt = new Date(
    Date.now() + completedJob.increment_interval_minutes * completedJob.final_yield * 60 * 1000,
  );

  const result = await pool.query<{ id: string }>(
    `INSERT INTO production_jobs (id, player_id, factory_id, commodity_id, recipe_id, season_id, status, base_yield, final_yield, units_produced, increment_interval_minutes, effective_production_time_minutes, started_at, completes_at, input_snapshot)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'ACTIVE', $6, $7, 0, $8, $9, NOW(), $10, $11) RETURNING id`,
    [
      completedJob.player_id,
      completedJob.factory_id,
      completedJob.commodity_id,
      resolvedRecipeId,
      completedJob.season_id,
      completedJob.final_yield, // use final_yield as base for simplicity (modifiers already applied)
      completedJob.final_yield,
      completedJob.increment_interval_minutes,
      completedJob.increment_interval_minutes * completedJob.final_yield,
      completesAt,
      inputSnapshot ? JSON.stringify(inputSnapshot) : null,
    ],
  );

  const newJobId = result.rows[0].id;

  // Ensure factory stays PRODUCING
  await pool.query(
    `UPDATE factories SET status = 'PRODUCING' WHERE id = $1`,
    [completedJob.factory_id],
  );

  // Schedule first increment for the new cycle
  const delayMs = completedJob.increment_interval_minutes * 60 * 1000;
  await queue.add(
    'production.increment',
    {
      jobId: newJobId,
      playerId: completedJob.player_id,
      factoryId: completedJob.factory_id,
      commodityId: completedJob.commodity_id,
      seasonId: completedJob.season_id,
      finalYield: completedJob.final_yield,
      unitsProduced: 0,
      incrementIntervalMinutes: completedJob.increment_interval_minutes,
    },
    {
      delay: delayMs,
      jobId: `increment-${newJobId}-1`,
      removeOnComplete: true,
      removeOnFail: false,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    },
  );

  console.log(
    `[${QUEUE}] Auto-loop: started new cycle ${newJobId} for factory ${completedJob.factory_id} (yield: ${completedJob.final_yield}, interval: ${completedJob.increment_interval_minutes}min)`,
  );
}

/**
 * Insert a notification record for the player.
 */
async function insertNotification(
  playerId: string,
  seasonId: string,
  type: string,
  title: string,
  body: string,
): Promise<void> {
  const pool = getPool();
  try {
    await pool.query(
      `INSERT INTO notifications (id, player_id, season_id, type, title, body, priority, read, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'NORMAL', false, NOW())`,
      [playerId, seasonId, type, title, body],
    );
  } catch (err) {
    // Non-critical — log and continue
    console.warn(`[${QUEUE}] Failed to insert notification for player ${playerId}:`, err);
  }
}

// ============================================================
// Worker factory
// ============================================================

/**
 * Production worker handles:
 * - production.increment — produces one unit of output per interval
 * - production.check_resume — checks if paused jobs can resume after inventory changes
 *
 * Requirements: 5.3, 5.4, 5.5
 */
export function createProductionWorker(
  connection: ConnectionOptions,
  concurrency: number,
  dlqHandler: DeadLetterQueueHandler,
): Worker {
  // Run startup recovery in the background (non-blocking)
  recoverOverdueJobs(connection).catch((err) => {
    console.error(`[${QUEUE}] Startup recovery failed:`, err);
  });

  const worker = new Worker(
    QUEUE,
    async (job: Job) => {
      console.log(`[${QUEUE}] Processing job ${job.name} (id: ${job.id})`);

      switch (job.name) {
        case 'production.increment':
          await processIncrement(job, connection);
          break;
        case 'production.check_resume':
          await processCheckResume(job, connection);
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
