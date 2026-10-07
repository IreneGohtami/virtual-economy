// SEA Commodity Tycoon - Game Rules Package
// Pure calculation functions for game mechanics (yield, pricing, intervals, etc.)

/**
 * Represents a yield modifier with a bonus percentage (e.g., 0.10 for 10%).
 */
export interface YieldModifier {
  bonus: number;
}

/**
 * Calculates the final yield using the additive formula.
 * final_yield = baseYield * (1 + sum(bonuses))
 *
 * Validates: Requirement 5.6
 */
export function calculateFinalYield(baseYield: number, modifiers: YieldModifier[]): number {
  const totalBonus = modifiers.reduce((sum, mod) => sum + mod.bonus, 0);
  return Math.floor(baseYield * (1 + totalBonus));
}

/**
 * Calculates the time interval between each incremental unit of production.
 * incrementInterval = productionTime / finalYield
 *
 * Validates: Requirement 5.7
 */
export function calculateIncrementInterval(productionTime: number, finalYield: number): number {
  if (finalYield <= 0) {
    throw new Error('finalYield must be greater than 0');
  }
  return productionTime / finalYield;
}

/**
 * Calculates effective production time accounting for factory efficiency.
 * effectiveTime = baseTime / (efficiency / 100)
 *
 * A factory at 100% efficiency produces at base speed.
 * A factory at 50% efficiency takes twice as long.
 *
 * Validates: Requirement 22.2
 */
export function calculateEffectiveProductionTime(baseTime: number, efficiency: number): number {
  if (efficiency <= 0) {
    throw new Error('efficiency must be greater than 0');
  }
  return baseTime / (efficiency / 100);
}

/**
 * Calculates the total cost for purchasing `tileCount` new tiles
 * when the player already owns `totalTilesOwned` tiles.
 *
 * Pricing tiers:
 *  - Tiles 1-10 (tier 0): 25 coins each
 *  - Tiles 11-20 (tier 1): 30 coins each
 *  - Tiles 21-30 (tier 2): 35 coins each
 *  - Tier k: (25 + 5*k) coins per tile, where k = floor(tileIndex / 10)
 *
 * Each tile's price depends on its absolute position (totalTilesOwned + offset).
 *
 * Validates: Requirement 2.4
 */
export function calculateLandPrice(totalTilesOwned: number, tileCount: number): number {
  let totalCost = 0;
  for (let i = 0; i < tileCount; i++) {
    const tileIndex = totalTilesOwned + i;
    const tier = Math.floor(tileIndex / 10);
    const pricePerTile = 50 + 10 * tier;
    totalCost += pricePerTile;
  }
  return totalCost;
}

/**
 * Calculates the maintenance cost for a factory.
 * maintenanceCost = setupCost * 0.15
 *
 * Validates: Requirement 22.4
 */
export function calculateMaintenanceCost(setupCost: number): number {
  return setupCost * 0.15;
}

/**
 * Calculates the maximum efficiency a factory can reach after maintenance.
 * maxEfficiency = 100 - (maintenanceCount * 5)
 *
 * Each maintenance performed in the current season permanently reduces
 * the achievable ceiling by 5 percentage points.
 *
 * Validates: Requirement 22.6
 */
export function calculateMaxEfficiency(maintenanceCount: number): number {
  return 100 - maintenanceCount * 5;
}

/**
 * Calculates efficiency after a depreciation tick (no maintenance).
 * newEfficiency = max(50, currentEfficiency - 10)
 *
 * Efficiency decreases by 10 percentage points per tick, floored at 50%.
 *
 * Validates: Requirement 22.2, 22.3
 */
export function calculateDepreciation(currentEfficiency: number): number {
  return Math.max(50, currentEfficiency - 10);
}

/**
 * Calculates the amount received from an instant sell.
 * amount = marketPrice * 0.90 * quantity
 *
 * Validates: Requirement 9.1
 */
export function calculateInstantSellAmount(marketPrice: number, quantity: number): number {
  return marketPrice * 0.90 * quantity;
}

/**
 * Calculates a single loan installment amount.
 *
 * The loan uses a simple amortization:
 * - Interest is charged at `interestRate` (e.g., 0.05 for 5%) per period on the outstanding balance.
 * - Principal portion per installment = principal / numInstallments
 * - Interest portion = outstandingBalance * interestRate
 * - Total installment = principalPortion + interestPortion
 *
 * Validates: Requirement 11.2
 */
export function calculateLoanInstallment(
  principal: number,
  outstandingBalance: number,
  interestRate: number,
  numInstallments: number,
): number {
  if (numInstallments <= 0) {
    throw new Error('numInstallments must be greater than 0');
  }
  const principalPortion = principal / numInstallments;
  const interestPortion = outstandingBalance * interestRate;
  return principalPortion + interestPortion;
}

/**
 * Calculates a player's net worth.
 * netWorth = cash + landValue + factoryValue + inventoryMarketValue - outstandingDebt
 *
 * Validates: Requirement 10.1
 */
export function calculateNetWorth(
  cash: number,
  landValue: number,
  factoryValue: number,
  inventoryMarketValue: number,
  outstandingDebt: number,
): number {
  return cash + landValue + factoryValue + inventoryMarketValue - outstandingDebt;
}

/**
 * Calculates the effective commitment of a worker given workforce happiness.
 * effectiveCommitment = clamp(baseCommitment * (workforceHappiness / 80), 0, 100)
 *
 * At happiness = 80, commitment is unchanged. Above 80, it's boosted. Below 80, it's reduced.
 *
 * Validates: Requirement 25.6
 */
export function calculateEffectiveCommitment(baseCommitment: number, workforceHappiness: number): number {
  const raw = baseCommitment * (workforceHappiness / 80);
  return Math.min(100, Math.max(0, raw));
}

/**
 * Calculates the revenue generated by a shop per consumption cycle.
 * revenue = demandRate * (marketPrice * 1.20) * revenueMultiplier
 *
 * The shop sells at a 20% markup over market price, scaled by its revenue multiplier.
 *
 * Validates: Requirement 12.9
 */
export function calculateShopRevenue(
  demandRate: number,
  marketPrice: number,
  revenueMultiplier: number,
): number {
  return demandRate * (marketPrice * 1.20) * revenueMultiplier;
}

/**
 * Calculates the deconstruction fee for a factory or shop.
 * fee = setupCost * 0.25
 *
 * Validates: Requirement 21.2
 */
export function calculateDeconstructionFee(setupCost: number): number {
  return setupCost * 0.25;
}

/**
 * Calculates the resale price of land.
 * resalePrice = originalPrice * 0.50
 *
 * Calculates the land resale price based on time since purchase.
 * Starts at 100% refund, drops by 10% every 5 days, minimum 50%.
 *
 * Validates: Requirement 21.2
 */
export function calculateLandResalePrice(originalPrice: number, purchasedAt?: Date | string | null): number {
  if (!purchasedAt) {
    // Fallback to 50% if no purchase date available
    return originalPrice * 0.50;
  }

  const purchaseTime = new Date(purchasedAt).getTime();
  const now = Date.now();
  const daysSincePurchase = (now - purchaseTime) / (1000 * 60 * 60 * 24);

  // Drop 10% for every 5 days, starting at 100%
  const periods = Math.floor(daysSincePurchase / 5);
  const resalePercent = Math.max(0.50, 1.0 - periods * 0.10);

  return Math.floor(originalPrice * resalePercent);
}

/**
 * Calculates the dynamic market price for a commodity.
 * price = basePrice * supplyMultiplier * demandMultiplier
 *
 * During the first 7 days, both multipliers are 1.0 (price = basePrice).
 *
 * Validates: Requirement 10.1
 */
export function calculateDynamicPrice(
  basePrice: number,
  supplyMultiplier: number,
  demandMultiplier: number,
): number {
  return basePrice * supplyMultiplier * demandMultiplier;
}
