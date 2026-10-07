# Implementation Plan: SEA Commodity Tycoon

## Overview

This plan implements a multiplayer economic tycoon game as a modular monolith using NestJS (API + Workers), Next.js (Web Client), PostgreSQL, Redis, and BullMQ. The monorepo uses Turborepo with shared packages for game rules, types, UI components, and configuration. Tasks are ordered by dependency: shared packages first, then data layer, then API modules, then background workers, then frontend, and finally integration wiring.

## Tasks

- [x] 1. Set up monorepo structure and shared packages
  - [x] 1.1 Initialize Turborepo monorepo with apps/ and packages/ directories
    - Create root `package.json`, `turbo.json`, `.gitignore`, `tsconfig.base.json`
    - Create `apps/api`, `apps/web`, `apps/worker`, `apps/admin` directories with minimal scaffolding
    - Create `packages/game-rules`, `packages/shared-types`, `packages/ui`, `packages/config` directories
    - Set up workspace references and build pipeline in turbo.json
    - _Requirements: 20.1, 20.2, 20.3_

  - [x] 1.2 Define shared TypeScript interfaces and enums in `packages/shared-types`
    - Define `TerrainType`, `CommodityCategory`, `FactoryStatus`, `WorkerStatus`, `LoanStatus`, `SeasonStatus`, `ProductionJobStatus`, `ListingStatus`, `EventType`, `ShopType`, `NotificationType`, `TransactionType` enums
    - Define interfaces for all DTOs: `StartProductionDto`, `ConstructFactoryDto`, `ConstructShopDto`, `ListItemDto`, `PurchaseDto`, `InstantSellDto`, `LoanRequestDto`, `CreateProfileDto`, `TriggerEventDto`
    - Define response interfaces: `PlayerState`, `NetWorthBreakdown`, `PriceInfo`, `YieldCalculation`, `TradeResult`
    - Define WebSocket event payload types for all server→client and client→server events
    - _Requirements: 1.1, 5.6, 8.1, 16.1, 20.1_

  - [x] 1.3 Implement pure game-rules calculation functions in `packages/game-rules`
    - Implement `calculateFinalYield(baseYield, modifiers)`: additive formula `baseYield * (1 + sum(bonuses))`
    - Implement `calculateIncrementInterval(productionTime, finalYield)`: `productionTime / finalYield`
    - Implement `calculateEffectiveProductionTime(baseTime, efficiency)`: `baseTime / (efficiency / 100)`
    - Implement `calculateLandPrice(totalTilesOwned, tileCount)`: tier-based pricing (25 + 5k per tier of 10)
    - Implement `calculateMaintenanceCost(setupCost)`: `setupCost * 0.15`
    - Implement `calculateMaxEfficiency(maintenanceCount)`: `100 - (maintenanceCount * 5)`
    - Implement `calculateDepreciation(currentEfficiency)`: `max(50, currentEfficiency - 10)`
    - Implement `calculateInstantSellAmount(marketPrice, quantity)`: `marketPrice * 0.90 * quantity`
    - Implement `calculateLoanInstallment(principal, outstandingBalance, interestRate, numInstallments)`
    - Implement `calculateNetWorth(cash, landValue, factoryValue, inventoryMarketValue, outstandingDebt)`
    - Implement `calculateEffectiveCommitment(baseCommitment, workforceHappiness)`: `clamp(base * (H / 80), 0, 100)`
    - Implement `calculateShopRevenue(demandRate, marketPrice, revenueMultiplier)`: `demandRate * (marketPrice * 1.20) * revenueMultiplier`
    - Implement `calculateDeconstructionFee(setupCost)`: `setupCost * 0.25`
    - Implement `calculateLandResalePrice(originalPrice)`: `originalPrice * 0.50`
    - Implement `calculateDynamicPrice(basePrice, supplyMultiplier, demandMultiplier)`: `basePrice * supplyMultiplier * demandMultiplier`
    - _Requirements: 2.4, 5.6, 5.7, 9.1, 10.1, 11.2, 21.2, 22.2, 22.3, 22.4, 22.6, 25.6, 12.9_

  - [ ]* 1.4 Write property tests for game-rules calculation functions
    - **Property 2: Production Yield Additivity** — final_yield equals base_yield × (1 + sum of bonuses), order-independent
    - **Property 7: Factory Efficiency Bounds** — efficiency always between 50% and (100% - n×5%)
    - **Property 8: Depreciation Monotonicity** — efficiency monotonically decreases by 10pp without maintenance
    - **Property 9: Production Time Efficiency Relationship** — effective time = base_time / (E / 100)
    - **Property 10: Instant Sell Price Discount** — amount = 90% × price × quantity
    - **Property 13: Workforce Happiness Effective Commitment** — clamp(C × (H / 80), 0, 100)
    - **Property 15: Land Price Scaling** — tiles (10k+1)..10(k+1) cost (25 + 5k) each
    - **Property 17: Deconstruction Fee Calculation** — fee = 25% × setup_cost
    - **Validates: Requirements 2.4, 5.6, 5.7, 9.1, 9.2, 22.2, 22.3, 22.4, 22.5, 25.6**

  - [x] 1.5 Create game configuration loader in `packages/config`
    - Implement configuration schema validation using Zod for commodity, recipe, shop, event, and economic parameter definitions
    - Load `recipe-config.json` as the source of truth for all game parameters
    - Export typed configuration objects: `CommodityConfig`, `RecipeConfig`, `ShopConfig`, `EventConfig`, `EconomicParameters`
    - Implement hot-reload support for configuration changes without redeployment
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5_

  - [ ]* 1.6 Write property test for recipe configuration round-trip
    - **Property 19: Recipe Configuration Round-Trip** — serialize/deserialize = identity for all valid recipe configs
    - **Validates: Requirements 20.2, 20.5**

- [x] 2. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Set up NestJS API application with database layer
  - [x] 3.1 Bootstrap NestJS application in `apps/api`
    - Initialize NestJS project with TypeORM, PostgreSQL driver, class-validator, class-transformer
    - Configure environment-based database connection, Redis connection, BullMQ integration
    - Set up global validation pipes, exception filters, and interceptors
    - Configure CORS for web client and admin dashboard origins
    - Set up Swagger/OpenAPI documentation generation
    - _Requirements: 18.3, 19.1, 19.4_

  - [x] 3.2 Create PostgreSQL entity definitions and migrations
    - Define all TypeORM entities matching the design schema: `Season`, `Player`, `PlayerSeason`, `MapTile`, `Commodity`, `Recipe`, `RecipeInput`, `Factory`, `WorkerProfile`, `WorkerAssignment`, `ProductionJob`, `Inventory`, `MarketListing`, `MarketTrade`, `CommodityPrice`, `CurrentPrice`, `Loan`, `LoanPayment`, `Shop`, `ShopInventory`, `ShopAcceptedCommodity`, `GameEvent`, `WalletTransaction`, `Notification`, `SimulationRun`, `GameConfig`
    - Include `factory_level`, `exclusive_output_slug`, `output_switch_cooldown_until` columns on Factory entity
    - Include `tile_id` FK on Shop entity referencing MapTile
    - Create initial migration with all tables, indices, and constraints
    - Create seed migration loading commodity and recipe data from `recipe-config.json`
    - _Requirements: 18.1, 20.1, 20.2, 27.1_

  - [x] 3.3 Implement Wallet Ledger service with transactional integrity
    - Create `WalletService` with `executeTransaction(playerId, seasonId, type, amount, reference)` method
    - Implement pessimistic row-level locking on `player_seasons.coins` for all mutations
    - Ensure every coin change records a `WalletTransaction` with `balance_after`
    - Validate that no transaction results in negative balance (reject with `InsufficientFundsError`)
    - Support all transaction types: FACTORY_PURCHASE, FACTORY_DECONSTRUCTION, FACTORY_MAINTENANCE, LAND_PURCHASE, LAND_RESALE, WORKER_WAGE, WORKER_FIRING_SETTLEMENT, MARKETPLACE_SALE, INSTANT_SELL, LOAN_DISBURSEMENT, LOAN_REPAYMENT, PRODUCTION_COST, SHOP_REVENUE, SHOP_DECONSTRUCTION, STORAGE_UPGRADE, HAPPINESS_BOOST
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5_

  - [ ]* 3.4 Write property test for wallet ledger integrity
    - **Property 1: Wallet Ledger Integrity** — current balance = 1000 + sum(all wallet_transaction amounts) for any player in any season
    - **Validates: Requirements 18.1, 18.3**

- [x] 4. Implement Auth and Player modules
  - [x] 4.1 Implement Auth module with JWT-based session management
    - Create `AuthModule` with email and Google OAuth registration/login
    - Implement JWT access token issuance and refresh token rotation
    - Create `AuthGuard` for protecting all game endpoints
    - Validate display name uniqueness on registration
    - Initialize new players with 1,000 coins, 500 storage, zero assets via `PlayerSeason` record
    - _Requirements: 1.1, 1.2, 1.5, 1.6_

  - [x] 4.2 Implement Player module with specialty selection and state management
    - Create `PlayerModule` with profile management (avatar, display name)
    - Implement specialty selection (exactly one L0 category per season, required before any game action)
    - Implement `getPlayerState` returning full current state including specialty
    - Implement `getNetWorth` calculation: cash + land value + factory value + inventory market value - outstanding debt
    - Implement `updateLastActiveAt` called on every game action for inactivity tracking
    - Expose REST endpoints: GET /players/me, PUT /players/me/profile, POST /players/me/specialty, GET /players/me/net-worth, GET /players/me/dashboard
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 17.1, 17.3, 24.1_

- [x] 5. Implement Map and Land modules
  - [x] 5.1 Implement Map module with procedural generation and terrain validation
    - Create `MapModule` with Perlin noise-based map generation inspired by Malaysia & Indonesia geography
    - Generate terrain distribution: Water 15%, Fertile Soil 25%, Farmland 25%, Mountain 20%, City 15% (±5% tolerance)
    - Implement terrain smoothing pass for contiguous patches
    - Implement `getTiles(regionBounds)` for viewport-based tile fetching
    - Implement `validateTerrain(tileIds, category)` enforcing layout requirements per commodity category: Agriculture 3×3 Fertile Soil, Energy 3×2 Mountain/Farmland, Metal 2×2 Mountain, Livestock 3×2 Farmland, Fishery 2×2 (2 Water + 2 adjacent land), Forestry 3×3 Fertile Soil/Farmland
    - Reject any factory placement on CITY terrain
    - _Requirements: 2.1, 2.6, 2.7, 2.8, 2.11_

  - [x] 5.2 Implement land purchase system with tiered pricing and CITY tile lock
    - Implement `purchaseTiles(playerId, tileIds)` with validation: unowned, contiguous, sufficient coins
    - Enforce tiered land pricing: first 10 tiles at 25 coins, then +5 per subsequent tier of 10
    - Implement CITY tile purchase lock for first 5 days of season (available starting Day 6)
    - Record LAND_PURCHASE entries in Wallet Ledger atomically
    - Implement `resellTiles(playerId, tileIds)` at 50% of original purchase price, record LAND_RESALE
    - Expose REST endpoints: GET /map/tiles, POST /map/tiles/purchase, POST /map/tiles/resell, GET /map/tiles/validate
    - _Requirements: 2.3, 2.4, 2.5, 2.9, 2.10, 21.4_

- [x] 6. Implement Factory module with construction, depreciation, and output switching
  - [x] 6.1 Implement factory construction with level differentiation
    - Create `FactoryModule` with `construct(playerId, dto)` method
    - Validate owned contiguous tiles, matching terrain, sufficient coins
    - Enforce setup costs by category and level: L0 (Agri 300, Energy 500, Metal 500, Livestock/Fishery 400, Forestry 300), L1 (Agri 350, Energy 600, Metal 650, Livestock 350, Forestry 400), L2 (Electronics 800, Automotive 1000)
    - Set `factory_level` (0, 1, 2), initialize efficiency at 100%, maintenance_count at 0
    - Record FACTORY_PURCHASE in Wallet Ledger
    - Reject construction on CITY terrain
    - Factory remains IDLE until at least one worker assigned
    - Expose REST endpoints: POST /factories, GET /factories, GET /factories/:id
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

  - [x] 6.2 Implement factory deconstruction and maintenance
    - Implement `deconstruct(playerId, factoryId)`: validate IDLE status, charge 25% deconstruction fee, release tiles, record FACTORY_DECONSTRUCTION
    - Implement `performMaintenance(playerId, factoryId)`: restore efficiency to max (100% - n×5%), increment maintenance_count, charge 15% of setup_cost, record FACTORY_MAINTENANCE
    - Expose REST endpoints: DELETE /factories/:id, POST /factories/:id/maintenance
    - _Requirements: 21.1, 21.2, 21.3, 21.5, 21.6, 21.7, 22.4, 22.5, 22.6_

  - [x] 6.3 Implement exclusive output switching (Requirement 27)
    - Implement `switchOutput(playerId, factoryId, newOutputSlug)` method
    - Validate factory is IDLE (no active production job)
    - Validate 72-hour cooldown has expired (check `output_switch_cooldown_until`)
    - Set `exclusive_output_slug` to new recipe slug, set cooldown to NOW + 72h
    - Apply to: Poultry (chicken-meat/eggs), Cattle (beef/milk), Fishery (fish direct/frozen-fish)
    - New factories default to `exclusive_output_slug = NULL` (must select before first production)
    - Emit `factory.output_switched` WebSocket event
    - Expose REST endpoint: POST /factories/:id/switch-output
    - _Requirements: 27.1, 27.2, 27.3, 27.4, 27.5, 27.6, 27.7_

- [x] 7. Implement Worker module
  - [x] 7.1 Implement worker pool, hiring, and assignment system
    - Create `WorkerModule` with 2,000 worker pool generation (random name, age, gender, specialty, salary 6-10, experience 1-5, commitment 70-100%)
    - Implement `hire(playerId, workerId, factoryId)`: assign worker, start daily salary deductions
    - Implement `fire(playerId, workerId)`: settle salary, return to pool, reduce happiness by 5%
    - Implement `reassign(playerId, workerId, newFactoryId)`: move between factories
    - Enforce max 2 workers per factory
    - Track worker statuses: UNASSIGNED, WORKING, ABSENT, SICK, ON_VACATION
    - Implement progressive worker unlocking as players join / commodities are produced
    - Expose REST endpoints: GET /workers/available, POST /workers/:id/hire, POST /workers/:id/fire, POST /workers/:id/reassign, GET /workers/mine
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9_

- [x] 8. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Implement Production module
  - [x] 9.1 Implement L0 production with incremental output and yield modifiers
    - Create `ProductionModule` with `startProduction(playerId, dto)` method
    - Validate: factory has at least 1 worker, factory is IDLE, sufficient input inventory (for processing)
    - For exclusive-output factories: reject if `exclusive_output_slug` is NULL
    - Calculate final_yield with additive modifiers: specialty 10%, second worker 25%, worker skill (exp%), fertilizer bonus
    - Calculate increment_interval = effective_production_time / final_yield
    - Consume input commodities atomically, create production_job record (ACTIVE), schedule first BullMQ increment job
    - Produce 1 unit per increment_interval into player inventory
    - Factory does NOT auto-restart; returns to IDLE after completion
    - Expose REST endpoints: POST /production/start, GET /production/jobs, GET /production/jobs/:id
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.6, 5.7, 5.8_

  - [x] 9.2 Implement production pause/resume on storage capacity overflow
    - On each increment: check if player inventory + 1 would exceed storage_capacity
    - If full: set job status to PAUSED, stop scheduling increments, emit `production.paused` event
    - On inventory change (sell, list, storage upgrade): trigger `production.check_resume` job
    - Resume: recalculate remaining increments, reschedule from paused point
    - _Requirements: 5.5, 7.2_

  - [x] 9.3 Implement L1 processing and L2 assembly production paths
    - Validate Processing_Factory/Assembly_Factory type matches recipe's factory_category
    - Consume multiple input commodities per recipe definition
    - L2 assembly requires 2 workers
    - Support all L1 recipes from recipe-config.json (rice→flour, palm→cooking-oil, palm→biodiesel, coffee→roasted, cocoa→chocolate, oil→gasoline, oil→plastic, gas→fertilizer, iron→steel, nickel→battery, poultry→meat/eggs, cattle→beef/milk, fish→frozen-fish, timber→furniture, rubber→tire)
    - Support L2 recipes: plastic+battery→mobile-phone, steel+tire+battery→automobile
    - Fish dual-route: direct fish to Butcher shop OR processed frozen-fish to Supermarket via exclusive output switching
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.11_

  - [x] 9.4 Implement fertilizer boost system
    - Implement `applyFertilizer(playerId, factoryId)`: consume configured Fertilizer_Quota from inventory
    - Agriculture: 4 units for 15% yield bonus; Forestry: 6 units for 12% yield bonus (from config)
    - Set `fertilizer_boost_active = true`, `fertilizer_boost_expires_at = NOW + 5 days`
    - Schedule expiry job; on expiry attempt auto-reapply if sufficient inventory, otherwise deactivate
    - Expose REST endpoint: POST /factories/:id/fertilizer
    - _Requirements: 6.6, 6.7, 6.8, 6.9, 6.10_

  - [ ]* 9.5 Write property tests for production system
    - **Property 12: Incremental Production Conservation** — total units_produced = final_yield, each increment adds exactly 1 unit
    - **Property 5: Storage Capacity Invariant** — sum(quantity × storage_size) never exceeds storage_capacity
    - **Property 16: Fertilizer Boost Expiry** — boost expires at exactly 5 days, no reapply without inventory
    - **Validates: Requirements 5.3, 5.5, 5.7, 6.7, 6.8, 7.2**

- [x] 10. Implement Inventory and Storage module
  - [x] 10.1 Implement inventory tracking and storage upgrade system
    - Create `InventoryModule` tracking aggregated quantities per commodity per player per season
    - Enforce storage capacity: sum(quantity × storage_size) ≤ player's current storage_capacity
    - Implement storage upgrades at fixed tiers: 500 (free), 750 (100), 1000 (175), 1500 (300), 2000 (500), 3000 (800), 5000 (1500)
    - Record STORAGE_UPGRADE in Wallet Ledger
    - Reject inventory additions that would exceed capacity
    - Expose REST endpoints: GET /inventory, POST /inventory/storage/upgrade
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

- [x] 11. Implement Marketplace module
  - [x] 11.1 Implement FIFO marketplace with listing, purchase, and cancellation
    - Create `MarketplaceModule` with FIFO queue per commodity type
    - Implement `listForSale`: move quantity from inventory to marketplace queue, timestamp for FIFO
    - Implement `purchase`: fulfill from earliest listing(s) using row-level locking (SELECT FOR UPDATE ORDER BY listed_at ASC), support partial fills
    - Transfer coins buyer→seller, transfer commodity to buyer inventory
    - Record MARKETPLACE_SALE in both players' Wallet Ledgers
    - All transactions execute at current global market price (no custom prices)
    - Implement `cancelListing`: return unsold quantity to seller's inventory
    - Emit `marketplace.trade` and `marketplace.price_update` WebSocket events
    - Expose REST endpoints: GET /marketplace/:commodityId, POST /marketplace/list, POST /marketplace/buy, DELETE /marketplace/listings/:id, GET /marketplace/prices
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 19.3_

  - [ ]* 11.2 Write property tests for marketplace
    - **Property 3: Inventory Conservation on Marketplace Trade** — total commodity quantity across buyer + seller + listings remains constant
    - **Property 4: FIFO Ordering Guarantee** — earliest listing always fills first
    - **Validates: Requirements 8.1, 8.3, 8.4, 18.3**

  - [x] 11.3 Implement Instant Sell mechanism
    - Implement `instantSell(playerId, dto)`: sell at 90% of current market price
    - Atomically remove from inventory, credit wallet, record INSTANT_SELL in ledger
    - Independent from FIFO queue (does not enter or affect marketplace)
    - Reject if quantity exceeds held inventory
    - Expose REST endpoint: POST /marketplace/instant-sell
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

- [x] 12. Implement Economy and Dynamic Pricing module
  - [x] 12.1 Implement dynamic pricing engine with stabilization period
    - Create `EconomyModule` with price calculation: base_price × supply_multiplier × demand_multiplier
    - Hold all prices at base values for first 7 days (multipliers = 1.0)
    - After Day 7: calculate supply_multiplier from total_production_24h + total_inventory, clamp(0.5, 2.0)
    - After Day 7: calculate demand_multiplier from marketplace_purchases_24h + shop_consumption_24h, clamp(0.5, 2.0)
    - Store current prices in `current_prices` table (single row per commodity per season)
    - Record each recalibration in `commodity_prices` history table
    - Expose REST endpoints: GET /economy/prices/:commodityId/history, GET /economy/leaderboard
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

  - [ ]* 12.2 Write property test for dynamic pricing stability period
    - **Property 14: Dynamic Pricing Stability Period** — price = base_price for first 7 days (multipliers = 1.0)
    - **Validates: Requirements 10.1, 10.2**

- [x] 13. Implement Bank and Loan module
  - [x] 13.1 Implement loan system with multiple concurrent loans and installment processing
    - Create `BankModule` with loan lifecycle management
    - Implement `requestLoan`: validate total outstanding ≤ 50% net worth, minimum 100 coins
    - Disburse: credit wallet, create loan record with repayment schedule, record LOAN_DISBURSEMENT
    - Implement installment processing: auto-deduct principal + interest every 5 days, record LOAN_REPAYMENT
    - Interest: 5% per 5-day period on outstanding balance
    - Implement early repayment without penalty
    - Handle insufficient funds: apply late penalty, restrict new loans until settled
    - Recalculate max borrowing capacity before each new loan
    - Expose REST endpoints: POST /bank/loans, GET /bank/loans, POST /bank/loans/:id/repay, GET /bank/capacity
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7_

  - [ ]* 13.2 Write property test for loan system
    - **Property 6: Loan Debt Ceiling** — total outstanding ≤ 50% of net worth at all times
    - **Validates: Requirements 11.1, 11.7**

- [x] 14. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 15. Implement Shop module
  - [x] 15.1 Implement shop construction, stocking, and revenue generation
    - Create `ShopModule` supporting 7 shop types: Supermarket, Butcher, Cafe, Petrol Station, Furniture Shop, Electronics Shop, Car Store
    - Implement `construct`: validate player owns exactly 1 CITY tile (unoccupied), sufficient coins, record in ledger
    - Each shop requires exactly 1 CITY tile; reject any non-CITY terrain
    - Implement `stockShop`: transfer commodities from player inventory to shop inventory
    - Implement `processConsumption`: auto-consume stocked inventory at configured demand rate per hour
    - Generate revenue: `demand_rate × (market_price × 1.20) × revenue_multiplier` per consumed unit
    - Enforce minimum stocking requirements (Supermarket: 2 types, others: 1 type)
    - Pause revenue generation if below minimum types
    - Record SHOP_REVENUE in Wallet Ledger
    - Implement shop deconstruction: 25% fee of setup cost, release CITY tile, record SHOP_DECONSTRUCTION
    - Expose REST endpoints: POST /shops, GET /shops, DELETE /shops/:id, POST /shops/:id/stock, GET /shops/:id/revenue
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 12.9, 12.10, 21.8, 21.9_

- [x] 16. Implement Season Lifecycle module
  - [x] 16.1 Implement season management with initialization and reset
    - Create `SeasonModule` with configurable duration (default 30 days), UTC timestamps
    - Implement `startSeason`: generate new map, reset all players (1000 coins, 500 storage, zero assets), clear marketplace, clear specialties
    - Require specialty re-selection before any game action each season
    - Implement `endSeason`: calculate final standings, record leaderboard, prevent further actions
    - Reset factory maintenance_count to 0 at season start
    - Expose REST endpoints: GET /season/current, GET /season/summary/:id, GET /season/history
    - _Requirements: 13.1, 13.2, 13.3, 13.5, 13.6, 22.10_

  - [ ]* 16.2 Write property test for season reset completeness
    - **Property 11: Season Reset Completeness** — on season transition, all player state resets to initial values
    - **Validates: Requirements 13.2**

- [x] 17. Implement Event module
  - [x] 17.1 Implement natural disasters and economic events system
    - Create `EventModule` with time-bounded modifier system
    - Support negative events: Flood (-30% Agri), Livestock Disease (-40% Livestock), Storm (-30% Fishery), Forest Fire (-50% Forestry)
    - Support positive events: Excellent Harvest (+20% Agri), Infrastructure Program (+30% Metal demand), EV Incentive (+40% Metal/Energy demand)
    - Apply production/demand/price modifiers to affected categories during event duration
    - Remove modifiers on event end, restore normal parameters
    - Broadcast event start/end via WebSocket to all players
    - Expose event data via REST for admin trigger
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5_

- [x] 18. Implement Workforce Happiness module
  - [x] 18.1 Implement happiness tracking, decay, boosts, and worker disruptions
    - Initialize happiness at 80% each season
    - Implement daily 1% passive decay (server-side scheduled)
    - Implement purchasable boosts: Bonus (50 coins, +5%), Company Trip (120 coins, +10%), Salary Raise (200 coins, +15%)
    - Record HAPPINESS_BOOST in Wallet Ledger; cap at 100%
    - Load boost definitions from config (allow operator tuning)
    - At ≤50%: send warning notification
    - At ≤30%: trigger ON_VACATION for workers, halt production at affected factories
    - Calculate effective_commitment = base × (happiness / 80), clamped [0, 100]
    - Generate random ABSENT/SICK events proportional to (1 - effective_commitment) every 4 hours
    - Continue salary deductions during ON_VACATION/ABSENT/SICK
    - Expose REST endpoints: GET /happiness, POST /happiness/boost, GET /happiness/boosts
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 25.1, 25.2, 25.3, 25.4, 25.5, 25.6, 25.7, 25.8, 25.9_

  - [ ]* 18.2 Write property test for worker salary deduction consistency
    - **Property 18: Worker Salary Deduction Consistency** — daily salary deducted exactly once per day regardless of worker status, recorded as WORKER_WAGE
    - **Validates: Requirements 4.2, 15.7**

- [x] 19. Implement Notification module with WebSocket gateway
  - [x] 19.1 Implement real-time notification system with WebSocket channels
    - Create `NotificationModule` with WebSocket gateway (Socket.io)
    - Define channels: `global:announcements`, `player:{id}:notifications`, `marketplace:{commodity}:updates`, `season:events`
    - Implement server→client events: production.progress, production.complete, production.paused, marketplace.trade, marketplace.price_update, worker.status_change, event.started, event.ended, season.milestone, notification, loan.payment_reminder, shop.revenue, factory.output_switched, happiness.warning
    - Implement client→server events: subscribe, unsubscribe, heartbeat
    - Persist notifications to database before WebSocket delivery
    - Queue notifications for offline players; deliver on reconnection via REST
    - Implement heartbeat (30s interval, 3 missed = dead connection)
    - Expose REST endpoint: GET /notifications (for offline queue fetch)
    - _Requirements: 16.1, 16.2, 16.3, 16.4_

- [x] 20. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 21. Implement Background Workers
  - [x] 21.1 Set up BullMQ worker infrastructure in `apps/worker`
    - Bootstrap worker process with BullMQ queue connections
    - Define queue names: production, economy, depreciation, happiness, worker, bank, shop, season, events, fertilizer, inactivity
    - Implement graceful shutdown with job completion on SIGTERM
    - Implement dead-letter queue (DLQ) handling for failed jobs
    - Configure retry policies per queue: production (3 retries, exponential), economy (5 retries, 30s), loan (3 retries, 1min), depreciation (3 retries)
    - _Requirements: 5.4, 19.1_

  - [x] 21.2 Implement production worker for incremental production jobs
    - Process `production.increment` jobs: add 1 unit to inventory, update progress, notify via WebSocket
    - Handle storage full: pause job, emit production.paused event
    - Handle worker absence mid-production: reduce yield proportionally or halt
    - Process `production.check_resume` on inventory change events
    - On server restart: scan ACTIVE jobs with overdue increments, process and reschedule
    - Schedule next increment with correct delay after each processing
    - _Requirements: 5.3, 5.4, 5.5_

  - [x] 21.3 Implement economy worker for daily price recalibration
    - Process `economy.recalibrate` cron job (daily midnight GMT+8): recalculate all commodity prices
    - Process `economy.snapshot` cron job (hourly): record price/volume snapshots
    - Calculate supply/demand multipliers using formula from design document
    - Skip price changes during first 7 days of season
    - _Requirements: 10.3, 10.4, 10.5_

  - [x] 21.4 Implement depreciation and maintenance workers
    - Process `factory.depreciation_tick` cron job (every 5 game days): reduce efficiency by 10pp, floor at 50%
    - Notify player at 50% minimum with maintenance recommendation
    - _Requirements: 22.1, 22.2, 22.7, 22.8, 22.9_

  - [x] 21.5 Implement happiness, worker disruption, and salary workers
    - Process `happiness.daily_decay`: reduce all players' happiness by 1%
    - Process `worker.disruption_check` (every 4h): roll for absence/sickness based on effective commitment
    - Process `worker.salary_deduction` (daily): deduct salary for all hired workers regardless of status
    - Implement ON_VACATION trigger when happiness ≤ 30%
    - _Requirements: 4.2, 15.1, 15.4, 25.2, 25.6, 25.8_

  - [x] 21.6 Implement loan installment and shop consumption workers
    - Process `loan.installment`: auto-deduct scheduled payments, handle insufficient funds
    - Process `shop.consumption` (hourly): consume shop inventory at demand rate, credit revenue to player
    - _Requirements: 11.4, 11.6, 12.3, 12.4_

  - [x] 21.7 Implement event and season workers
    - Process `event.trigger`: activate random events based on schedule
    - Process `event.end`: deactivate event modifiers
    - Process `season.end`: trigger season end flow
    - Process `season.summary`: generate Season_Summary record
    - Process `fertilizer.expire` and `fertilizer.auto_reapply`
    - _Requirements: 14.1, 14.5, 6.7, 6.8, 13.5_

  - [x] 21.8 Implement inactivity check worker
    - Process `player.inactivity_check` (daily): find players with last_active_at > 5 days ago
    - Send single email reminder per inactivity period
    - Track `inactivity_reminder_sent` flag; clear on next activity
    - _Requirements: 24.1, 24.2, 24.3, 24.4, 24.5_

- [x] 22. Implement Season Summary generation
  - [x] 22.1 Implement Season-End Summary and highlights
    - Query highest-produced commodity by total volume
    - Calculate wealthiest player (highest final Net_Worth)
    - Calculate market monopoly (highest % of single commodity supply held by one player)
    - Calculate best pivot (greatest Net_Worth delta over any 5-day window)
    - Generate thematic tagline based on dominant trends, most-traded category, disasters, volatility
    - Support configurable tagline override by operators
    - Persist Season_Summary permanently as historical record
    - _Requirements: 23.1, 23.2, 23.3, 23.4, 23.5, 23.6, 23.7_

- [x] 23. Implement Admin module and Recipe Simulation Engine
  - [x] 23.1 Implement admin endpoints and simulation engine
    - Create `AdminModule` with role-based access (IP-whitelist + admin role)
    - Implement recipe simulation engine: run same calculation logic as live server over configurable days
    - Accept configurable parameters: base prices, production times, yields, recipes, salaries, storage costs, demand rates
    - Output: projected earnings per chain, supply/demand equilibrium, price trajectories, commodity flow ratios
    - Support side-by-side comparison of multiple configurations
    - Isolated from live state; operates on copies of config data
    - Log each simulation run with parameters and results
    - Expose REST endpoints: POST /admin/simulation/run, GET /admin/simulation/results/:id, PUT /admin/config/commodities, PUT /admin/config/recipes, POST /admin/events/trigger, POST /admin/season/start, POST /admin/season/end
    - _Requirements: 26.1, 26.2, 26.3, 26.4, 26.5, 26.6, 26.7, 26.8_

- [x] 24. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 25. Implement Web Client (Next.js frontend)
  - [x] 25.1 Set up Next.js application with shared UI library
    - Initialize Next.js app in `apps/web` with TypeScript, Tailwind CSS, and App Router
    - Set up `packages/ui` with shared component library (buttons, modals, panels, cards, loaders)
    - Configure API client with JWT auth, automatic token refresh, and error handling
    - Set up WebSocket client (Socket.io) with auto-reconnect and notification queue fetch on reconnect
    - Implement auth pages: login, register, avatar customization, specialty selection
    - _Requirements: 1.2, 1.3, 16.4_

  - [x] 25.2 Implement game map view with terrain rendering and tile interaction
    - Render pixel-based map with distinct colors per terrain type (Water, Mountain, Fertile Soil, Farmland, City)
    - Implement viewport-based tile loading (lazy load as user scrolls/zooms)
    - Show owned tiles highlighted per player
    - Implement tile selection for purchase with validation feedback
    - Display CITY tile lock countdown during first 5 days
    - _Requirements: 2.2, 2.3, 2.9, 2.10_

  - [x] 25.3 Implement factory management UI
    - Factory construction flow: select tiles → choose commodity/recipe → confirm
    - Display factory list with status, efficiency, maintenance count, max efficiency, next depreciation tick
    - Factory detail view with production controls, worker slots, fertilizer application
    - Output switching UI for Livestock/Fishery factories with cooldown timer display
    - Deconstruction confirmation with fee preview
    - _Requirements: 3.1, 22.8, 27.6_

  - [x] 25.4 Implement production, inventory, and marketplace UI
    - Production start flow with yield preview and modifier breakdown
    - Active production jobs list with progress bars and incremental unit counters
    - Inventory grid showing quantities, storage usage, storage upgrade options
    - Marketplace view per commodity: queue depth, current price, list/buy/cancel actions
    - Instant sell interface with 90% price preview
    - _Requirements: 5.1, 7.1, 8.7, 9.1, 10.6_

  - [x] 25.5 Implement worker, shop, bank, and happiness UI panels
    - Worker marketplace: browse available workers, hire, fire, reassign, view status
    - Shop management: construct on CITY tile, stock inventory, view revenue
    - Bank panel: request loans, view active loans, early repayment, capacity indicator
    - Happiness panel: current %, available boosts with costs, warning/critical indicators
    - _Requirements: 4.1, 12.1, 11.1, 25.10_

  - [x] 25.6 Implement dashboard, leaderboard, notifications, and season summary views
    - Player dashboard: cash, net worth breakdown, land/factory/worker/inventory/loan summaries
    - Leaderboard: ranked by net worth, display name + avatar
    - Notification panel: persistent list + transient toast messages for high-priority updates
    - Season summary view: key events, highest-produced, wealthiest, monopoly, best pivot, tagline
    - Price history charts per commodity
    - Season countdown timer (from server-provided ends_at, not browser time)
    - _Requirements: 13.4, 17.1, 17.2, 17.3, 16.4, 23.5, 10.6_

- [x] 26. Implement Anti-Cheat and Rate Limiting
  - [x] 26.1 Implement server-authority validation and rate limiting
    - Add validation layer on every player action: verify ownership, funds, inventory, worker assignments, factory state
    - Implement per-player rate limiting: 60 req/min general, 30 req/min marketplace, IP-whitelist admin
    - Log state inconsistency discrepancies for investigation
    - Never trust client-supplied values for money, inventory, production, prices, or ownership
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5_

- [x] 27. Integration wiring and Docker setup
  - [x] 27.1 Create Docker Compose development environment
    - Define `docker-compose.yml` with PostgreSQL, Redis, API, Worker, and Web services
    - Configure environment variables for all service connections
    - Add health checks for database and Redis readiness
    - Include volume mounts for development hot-reload
    - _Requirements: 20.4_

  - [x] 27.2 Wire all modules together with end-to-end flow verification
    - Verify complete production pipeline: register → select specialty → buy land → build factory → hire worker → produce → list on marketplace → buy → process → stock shop → generate revenue
    - Verify season lifecycle: start → play → end → summary
    - Verify loan lifecycle: request → installments → payoff
    - Verify event system: trigger → modifiers applied → end → modifiers removed
    - Verify depreciation/maintenance cycle over multiple ticks
    - Verify exclusive output switching with cooldown enforcement
    - _Requirements: All requirements integrated_

  - [ ]* 27.3 Write integration tests for critical paths
    - Full trade flow: seller lists → buyer purchases → coins/inventory transferred correctly
    - Production lifecycle: start → increments → pause on storage full → resume → complete
    - Season reset: verify all state returns to initial values
    - Loan default flow: insufficient funds → penalty → restrictions applied
    - Shop revenue: stock → consumption → revenue credited at correct formula
    - Exclusive output switch: switch → cooldown → reject during cooldown → allow after cooldown
    - _Requirements: 5.3, 8.3, 11.4, 12.3, 13.2, 27.2_

- [x] 28. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The `recipe-config.json` file serves as the seed data source for all commodity, recipe, shop, and economic parameter definitions
- All WebSocket events are persisted before delivery to handle offline scenarios
- The `packages/game-rules` package contains all pure calculation functions, making them testable independently of the database layer
- Factory levels (0, 1, 2) are physically separate facilities with their own land, terrain, workers, and setup costs
- CITY terrain is exclusively for shops; no factories can be placed on CITY tiles
- Exclusive output switching applies to Poultry, Cattle, and Fishery factories with a 72-hour cooldown

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.5"] },
    { "id": 2, "tasks": ["1.3", "1.6"] },
    { "id": 3, "tasks": ["1.4", "3.1"] },
    { "id": 4, "tasks": ["3.2"] },
    { "id": 5, "tasks": ["3.3", "4.1"] },
    { "id": 6, "tasks": ["3.4", "4.2", "5.1"] },
    { "id": 7, "tasks": ["5.2", "6.1"] },
    { "id": 8, "tasks": ["6.2", "6.3", "7.1"] },
    { "id": 9, "tasks": ["9.1", "10.1"] },
    { "id": 10, "tasks": ["9.2", "9.3", "9.4"] },
    { "id": 11, "tasks": ["9.5", "11.1"] },
    { "id": 12, "tasks": ["11.2", "11.3", "12.1"] },
    { "id": 13, "tasks": ["12.2", "13.1"] },
    { "id": 14, "tasks": ["13.2", "15.1"] },
    { "id": 15, "tasks": ["16.1", "17.1"] },
    { "id": 16, "tasks": ["16.2", "18.1"] },
    { "id": 17, "tasks": ["18.2", "19.1"] },
    { "id": 18, "tasks": ["21.1"] },
    { "id": 19, "tasks": ["21.2", "21.3", "21.4", "21.5"] },
    { "id": 20, "tasks": ["21.6", "21.7", "21.8"] },
    { "id": 21, "tasks": ["22.1", "23.1"] },
    { "id": 22, "tasks": ["25.1", "26.1"] },
    { "id": 23, "tasks": ["25.2", "25.3"] },
    { "id": 24, "tasks": ["25.4", "25.5"] },
    { "id": 25, "tasks": ["25.6", "27.1"] },
    { "id": 26, "tasks": ["27.2"] },
    { "id": 27, "tasks": ["27.3"] }
  ]
}
```
