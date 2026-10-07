import { Worker, Job, ConnectionOptions } from 'bullmq';
import { QUEUE_NAMES, getRetryPolicy } from '../queues';
import { DeadLetterQueueHandler } from '../dlq';
import { query, getClient } from '../database';
import { calculateDynamicPrice } from '@sea-commodity-tycoon/game-rules';
import { SeasonStatus, ListingStatus, ProductionJobStatus } from '@sea-commodity-tycoon/shared-types';

const QUEUE = QUEUE_NAMES.ECONOMY;
const retryPolicy = getRetryPolicy(QUEUE);

/** Number of days from season start where prices remain at base values */
const STABILIZATION_DAYS = 7;

/** Baseline supply reference for normalizing supply score */
const BASELINE_SUPPLY = 100;

/** Baseline demand reference for normalizing demand score */
const BASELINE_DEMAND = 50;

interface ActiveSeason {
  id: string;
  starts_at: Date;
}

interface CommodityRow {
  id: string;
  slug: string;
  base_price: string;
}

interface CurrentPriceRow {
  season_id: string;
  commodity_id: string;
  price: string;
  supply_multiplier: string;
  demand_multiplier: string;
}

/**
 * Get the active season from the database.
 */
async function getActiveSeason(): Promise<ActiveSeason | null> {
  const rows = await query<ActiveSeason>(
    `SELECT id, starts_at FROM seasons WHERE status = $1 LIMIT 1`,
    [SeasonStatus.ACTIVE],
  );
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Calculate days since season start.
 */
function getDaysSinceStart(startsAt: Date): number {
  const now = new Date();
  const diffMs = now.getTime() - new Date(startsAt).getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Calculate supply metrics for a commodity:
 * Supply = total_production_24h + total_inventory + marketplace_queue
 * supply_multiplier = clamp(2.0 - supply_score, 0.5, 2.0)
 */
async function calculateSupplyMetrics(
  commodityId: string,
  seasonId: string,
): Promise<{ totalSupply: number; multiplier: number }> {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Total production in last 24h
  const productionResult = await query<{ total: string }>(
    `SELECT COALESCE(SUM(units_produced), 0) AS total
     FROM production_jobs
     WHERE commodity_id = $1
       AND season_id = $2
       AND status IN ($3, $4)
       AND started_at >= $5`,
    [commodityId, seasonId, ProductionJobStatus.COMPLETED, ProductionJobStatus.ACTIVE, twentyFourHoursAgo],
  );
  const totalProduction24h = parseInt(productionResult[0]?.total ?? '0', 10);

  // Total inventory across all players
  const inventoryResult = await query<{ total: string }>(
    `SELECT COALESCE(SUM(quantity), 0) AS total
     FROM inventories
     WHERE commodity_id = $1 AND season_id = $2`,
    [commodityId, seasonId],
  );
  const totalInventory = parseInt(inventoryResult[0]?.total ?? '0', 10);

  // Total marketplace queue (remaining quantity in active listings)
  const listingResult = await query<{ total: string }>(
    `SELECT COALESCE(SUM(remaining_quantity), 0) AS total
     FROM market_listings
     WHERE commodity_id = $1
       AND season_id = $2
       AND status = $3`,
    [commodityId, seasonId, ListingStatus.ACTIVE],
  );
  const totalListings = parseInt(listingResult[0]?.total ?? '0', 10);

  const totalSupply = totalProduction24h + totalInventory + totalListings;

  // Higher supply → lower price: multiplier = 2.0 - supply_score, clamped [0.5, 2.0]
  const supplyScore = BASELINE_SUPPLY > 0 ? totalSupply / BASELINE_SUPPLY : 1;
  const multiplier = Math.min(2.0, Math.max(0.5, 2.0 - supplyScore));

  return { totalSupply, multiplier };
}

/**
 * Calculate demand metrics for a commodity:
 * Demand = marketplace_purchases_24h + shop_consumption_24h
 * demand_multiplier = clamp(demand_score, 0.5, 2.0)
 */
async function calculateDemandMetrics(
  commodityId: string,
  seasonId: string,
): Promise<{ totalDemand: number; multiplier: number }> {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Marketplace purchases in last 24h
  const tradeResult = await query<{ total: string }>(
    `SELECT COALESCE(SUM(quantity), 0) AS total
     FROM market_trades
     WHERE commodity_id = $1
       AND season_id = $2
       AND traded_at >= $3`,
    [commodityId, seasonId, twentyFourHoursAgo],
  );
  const marketplacePurchases24h = parseInt(tradeResult[0]?.total ?? '0', 10);

  // Shop consumption in last 24h (once shop worker tracks this, extend here)
  const shopConsumption24h = 0;

  const totalDemand = marketplacePurchases24h + shopConsumption24h;

  // Higher demand → higher price: multiplier = demand_score, clamped [0.5, 2.0]
  const demandScore = BASELINE_DEMAND > 0 ? totalDemand / BASELINE_DEMAND : 1;
  const multiplier = Math.min(2.0, Math.max(0.5, demandScore));

  return { totalDemand, multiplier };
}

/**
 * Get trade volume for a commodity in the last 24 hours.
 */
async function getTradeVolume24h(commodityId: string, seasonId: string): Promise<number> {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const result = await query<{ total: string }>(
    `SELECT COALESCE(SUM(quantity), 0) AS total
     FROM market_trades
     WHERE commodity_id = $1
       AND season_id = $2
       AND traded_at >= $3`,
    [commodityId, seasonId, twentyFourHoursAgo],
  );

  return parseInt(result[0]?.total ?? '0', 10);
}

/**
 * Process economy.recalibrate job:
 * Recalculates all commodity prices for the active season.
 * During first 7 days (stabilization), prices stay at base values.
 * After Day 7, supply and demand multipliers are computed from market activity.
 */
async function processRecalibrate(): Promise<void> {
  const season = await getActiveSeason();
  if (!season) {
    console.log(`[${QUEUE}] No active season found, skipping recalibration`);
    return;
  }

  const daysSinceStart = getDaysSinceStart(season.starts_at);
  const isStabilizationPeriod = daysSinceStart <= STABILIZATION_DAYS;

  console.log(
    `[${QUEUE}] Recalibrating prices for season ${season.id} ` +
    `(day ${daysSinceStart}, stabilization: ${isStabilizationPeriod})`,
  );

  // Fetch all active commodities
  const commodities = await query<CommodityRow>(
    `SELECT id, slug, base_price FROM commodities WHERE active = true`,
  );

  const client = await getClient();
  try {
    await client.query('BEGIN');

    let updatedCount = 0;

    for (const commodity of commodities) {
      const basePrice = parseFloat(commodity.base_price);

      let supplyMultiplier = 1.0;
      let demandMultiplier = 1.0;
      let supplyMetric: number | null = null;
      let demandMetric: number | null = null;
      let tradeVolume = 0;

      if (!isStabilizationPeriod) {
        const supplyData = await calculateSupplyMetrics(commodity.id, season.id);
        supplyMetric = supplyData.totalSupply;
        supplyMultiplier = supplyData.multiplier;

        const demandData = await calculateDemandMetrics(commodity.id, season.id);
        demandMetric = demandData.totalDemand;
        demandMultiplier = demandData.multiplier;

        tradeVolume = await getTradeVolume24h(commodity.id, season.id);
      }

      const newPrice = calculateDynamicPrice(basePrice, supplyMultiplier, demandMultiplier);

      // Upsert current_prices
      await client.query(
        `INSERT INTO current_prices (season_id, commodity_id, price, supply_multiplier, demand_multiplier, last_updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (season_id, commodity_id)
         DO UPDATE SET
           price = EXCLUDED.price,
           supply_multiplier = EXCLUDED.supply_multiplier,
           demand_multiplier = EXCLUDED.demand_multiplier,
           last_updated_at = NOW()`,
        [
          season.id,
          commodity.id,
          newPrice.toFixed(2),
          supplyMultiplier.toFixed(4),
          demandMultiplier.toFixed(4),
        ],
      );

      // Record in price history
      await client.query(
        `INSERT INTO commodity_prices (id, season_id, commodity_id, price, supply_multiplier, demand_multiplier, supply_metric, demand_metric, trade_volume, recorded_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
        [
          season.id,
          commodity.id,
          newPrice.toFixed(2),
          supplyMultiplier.toFixed(4),
          demandMultiplier.toFixed(4),
          supplyMetric !== null ? supplyMetric.toFixed(2) : null,
          demandMetric !== null ? demandMetric.toFixed(2) : null,
          tradeVolume,
        ],
      );

      updatedCount++;
    }

    await client.query('COMMIT');

    console.log(
      `[${QUEUE}] Recalibrated ${updatedCount} commodity prices ` +
      `(day ${daysSinceStart}, stabilization: ${isStabilizationPeriod})`,
    );
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Process economy.snapshot job:
 * Records current prices as a snapshot in the commodity_prices history table.
 * This runs hourly to provide granular price history data.
 */
async function processSnapshot(): Promise<void> {
  const season = await getActiveSeason();
  if (!season) {
    console.log(`[${QUEUE}] No active season found, skipping snapshot`);
    return;
  }

  // Read current prices from current_prices table
  const currentPrices = await query<CurrentPriceRow>(
    `SELECT season_id, commodity_id, price, supply_multiplier, demand_multiplier
     FROM current_prices
     WHERE season_id = $1`,
    [season.id],
  );

  if (currentPrices.length === 0) {
    console.log(`[${QUEUE}] No current prices found for season ${season.id}, skipping snapshot`);
    return;
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    for (const cp of currentPrices) {
      // Get trade volume for this commodity in the last hour
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const volumeResult = await client.query(
        `SELECT COALESCE(SUM(quantity), 0) AS total
         FROM market_trades
         WHERE commodity_id = $1
           AND season_id = $2
           AND traded_at >= $3`,
        [cp.commodity_id, season.id, oneHourAgo],
      );
      const hourlyVolume = parseInt(volumeResult.rows[0]?.total ?? '0', 10);

      await client.query(
        `INSERT INTO commodity_prices (id, season_id, commodity_id, price, supply_multiplier, demand_multiplier, supply_metric, demand_metric, trade_volume, recorded_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NULL, NULL, $6, NOW())`,
        [
          season.id,
          cp.commodity_id,
          cp.price,
          cp.supply_multiplier,
          cp.demand_multiplier,
          hourlyVolume,
        ],
      );
    }

    await client.query('COMMIT');

    console.log(`[${QUEUE}] Recorded price snapshot for ${currentPrices.length} commodities`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Economy worker handles:
 * - economy.recalibrate — daily price recalculation for all commodities (midnight GMT+8)
 * - economy.snapshot — hourly price/volume snapshots
 */
export function createEconomyWorker(
  connection: ConnectionOptions,
  concurrency: number,
  dlqHandler: DeadLetterQueueHandler,
): Worker {
  const worker = new Worker(
    QUEUE,
    async (job: Job) => {
      console.log(`[${QUEUE}] Processing job ${job.name} (id: ${job.id})`);

      switch (job.name) {
        case 'economy.recalibrate':
          await processRecalibrate();
          break;
        case 'economy.snapshot':
          await processSnapshot();
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
