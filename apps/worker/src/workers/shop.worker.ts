import { Worker, Job, ConnectionOptions } from 'bullmq';
import { QUEUE_NAMES, getRetryPolicy } from '../queues';
import { DeadLetterQueueHandler } from '../dlq';
import { getPool } from '../database';

const QUEUE = QUEUE_NAMES.SHOP;
const retryPolicy = getRetryPolicy(QUEUE);

/**
 * Minimum stocking types required per shop type.
 * Supermarket requires 2, all others require 1.
 */
const MIN_TYPES_BY_SHOP: Record<string, number> = {
  SUPERMARKET: 2,
  BUTCHER: 1,
  CAFE: 1,
  PETROL_STATION: 1,
  FURNITURE: 1,
  ELECTRONICS: 1,
  CAR_STORE: 1,
};

/**
 * Revenue multiplier per shop type.
 */
const REVENUE_MULTIPLIER_BY_SHOP: Record<string, number> = {
  SUPERMARKET: 1.2,
  BUTCHER: 1.3,
  CAFE: 1.5,
  PETROL_STATION: 1.1,
  FURNITURE: 1.4,
  ELECTRONICS: 1.6,
  CAR_STORE: 1.8,
};

/**
 * Shop worker handles:
 * - shop.consumption — hourly processing of shop inventory consumption and revenue
 *
 * Requirements: 12.3, 12.4
 */
export function createShopWorker(
  connection: ConnectionOptions,
  concurrency: number,
  dlqHandler: DeadLetterQueueHandler,
): Worker {
  const worker = new Worker(
    QUEUE,
    async (job: Job) => {
      console.log(`[${QUEUE}] Processing job ${job.name} (id: ${job.id})`);

      switch (job.name) {
        case 'shop.consumption':
          await processShopConsumption();
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

interface ShopRow {
  id: string;
  player_id: string;
  season_id: string;
  shop_type: string;
  demand_rate: string;
}

interface ShopInventoryRow {
  id: string;
  shop_id: string;
  commodity_id: string;
  quantity: number;
}

/**
 * Processes hourly shop consumption for all shops in the active season.
 *
 * For each shop:
 * 1. Check minimum stocking types requirement (Supermarket: 2, others: 1)
 * 2. For each stocked commodity: consume min(available, floor(demandRate)) units
 * 3. Calculate revenue per consumed unit: (market_price × 1.20) × revenue_multiplier
 * 4. Credit total revenue to player wallet as SHOP_REVENUE
 *
 * Revenue formula: consumed_units × (market_price × 1.20) × revenue_multiplier
 */
async function processShopConsumption(): Promise<void> {
  const pool = getPool();

  // Get active season
  const seasonResult = await pool.query<{ id: string }>(
    `SELECT id FROM seasons WHERE status = 'ACTIVE' ORDER BY starts_at DESC LIMIT 1`,
  );

  if (seasonResult.rows.length === 0) {
    console.log(`[${QUEUE}] No active season found, skipping shop consumption`);
    return;
  }

  const seasonId = seasonResult.rows[0].id;

  // Get all shops in the active season
  const shopsResult = await pool.query<ShopRow>(
    `SELECT id, player_id, season_id, shop_type, demand_rate
     FROM shops
     WHERE season_id = $1`,
    [seasonId],
  );

  if (shopsResult.rows.length === 0) {
    console.log(`[${QUEUE}] No shops found in active season`);
    return;
  }

  console.log(`[${QUEUE}] Processing consumption for ${shopsResult.rows.length} shops`);

  let totalShopsProcessed = 0;
  let totalShopsPaused = 0;
  let totalRevenueGenerated = 0;

  for (const shop of shopsResult.rows) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Get shop inventories with positive quantity
      const inventoryResult = await client.query<ShopInventoryRow>(
        `SELECT id, shop_id, commodity_id, quantity
         FROM shop_inventories
         WHERE shop_id = $1 AND quantity > 0
         FOR UPDATE`,
        [shop.id],
      );

      // Check minimum types requirement
      const stockedTypes = inventoryResult.rows.length;
      const minRequired = MIN_TYPES_BY_SHOP[shop.shop_type] ?? 1;

      if (stockedTypes < minRequired) {
        // Shop is paused — doesn't meet minimum stocking requirement
        await client.query('COMMIT');
        totalShopsPaused++;
        continue;
      }

      const demandRate = parseFloat(shop.demand_rate);
      const consumePerType = Math.floor(demandRate);

      if (consumePerType <= 0) {
        await client.query('COMMIT');
        continue;
      }

      let shopRevenue = 0;
      const revenueMultiplier = REVENUE_MULTIPLIER_BY_SHOP[shop.shop_type] ?? 1.0;

      for (const inventory of inventoryResult.rows) {
        // Consume min(available, floor(demandRate)) units
        const consumed = Math.min(inventory.quantity, consumePerType);
        if (consumed <= 0) continue;

        // Get current market price for this commodity
        const priceResult = await client.query<{ price: string }>(
          `SELECT price FROM current_prices
           WHERE season_id = $1 AND commodity_id = $2`,
          [seasonId, inventory.commodity_id],
        );

        if (priceResult.rows.length === 0) {
          // No price data available, skip this commodity
          continue;
        }

        const marketPrice = parseFloat(priceResult.rows[0].price);

        // Revenue = consumed × (market_price × 1.20) × revenue_multiplier
        const revenue = consumed * (marketPrice * 1.20) * revenueMultiplier;
        shopRevenue += revenue;

        // Reduce shop inventory
        const newQuantity = inventory.quantity - consumed;
        await client.query(
          `UPDATE shop_inventories SET quantity = $1 WHERE id = $2`,
          [newQuantity, inventory.id],
        );
      }

      // Credit revenue to player wallet
      if (shopRevenue > 0) {
        // Lock player wallet row
        const walletResult = await client.query<{ id: string; coins: string }>(
          `SELECT id, coins FROM player_seasons
           WHERE player_id = $1 AND season_id = $2
           FOR UPDATE`,
          [shop.player_id, shop.season_id],
        );

        if (walletResult.rows.length > 0) {
          const currentCoins = parseFloat(walletResult.rows[0].coins);
          const newBalance = currentCoins + shopRevenue;

          await client.query(
            `UPDATE player_seasons SET coins = $1 WHERE id = $2`,
            [newBalance.toFixed(2), walletResult.rows[0].id],
          );

          // Record wallet transaction
          await client.query(
            `INSERT INTO wallet_transactions (id, player_id, season_id, type, amount, balance_after, reference_type, reference_id, description, created_at)
             VALUES (gen_random_uuid(), $1, $2, 'SHOP_REVENUE', $3, $4, 'shop', $5, $6, NOW())`,
            [
              shop.player_id,
              shop.season_id,
              shopRevenue.toFixed(2),
              newBalance.toFixed(2),
              shop.id,
              `Hourly revenue from ${shop.shop_type} shop`,
            ],
          );

          totalRevenueGenerated += shopRevenue;
        }
      }

      await client.query('COMMIT');
      totalShopsProcessed++;
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`[${QUEUE}] Error processing consumption for shop=${shop.id}:`, err);
    } finally {
      client.release();
    }
  }

  console.log(
    `[${QUEUE}] Shop consumption complete: ${totalShopsProcessed} processed, ${totalShopsPaused} paused (min types not met), total revenue=${totalRevenueGenerated.toFixed(2)}`,
  );
}
