# Requirements Document

## Introduction

SEA Commodity Tycoon is a web-based multiplayer economic tycoon game set in Southeast Asia. Players begin each season with equal starting capital, choose a commodity specialty for bonus production yield, produce Level 0 natural resources, process them through multi-level supply chains, trade on a global marketplace, build consumer-facing shops, take out bank loans, hire workers, and respond to dynamic economic events. The game uses a server-authoritative architecture where all economic calculations happen on the backend, ensuring fairness and preventing cheating across all connected players.

## Glossary

- **Game_Server**: The server-authoritative backend that processes all game logic, economic calculations, and state mutations
- **Web_Client**: The browser-based frontend application that renders the game UI and sends player actions to the Game_Server
- **Player**: A registered user who participates in the game economy
- **Season**: A time-bounded game round (default 30 days) after which the economy resets
- **Commodity**: A tradeable resource produced or processed within the game economy
- **Level_0_Commodity**: A raw natural resource produced directly from land (Rice, Palm Fruit, Cocoa, Coffee, Crude Oil, Natural Gas, Iron Ore, Nickel Ore, Poultry, Cattle, Fish, Timber, Rubber)
- **Level_1_Commodity**: A processed good created from a Level 0 Commodity (Flour, Cooking Oil, Biodiesel, Roasted Coffee, Chocolate, Gasoline, Plastic, Fertilizer, Steel, Battery, Meat, Eggs, Beef, Milk, Frozen Fish, Furniture, Tire)
- **Level_2_Commodity**: A finished good created from multiple Level 1 Commodities (Mobile Phone, Automobile)
- **Factory**: A production facility placed on owned land that converts inputs into outputs using a Recipe
- **Processing_Factory**: A Level 1 factory that converts raw Level_0_Commodities into Level_1_Commodities using a Recipe. Requires separate land, terrain, and setup from a production factory.
- **Assembly_Factory**: A Level 2 factory that combines multiple Level_1_Commodities into Level_2_Commodities (Mobile Phone, Automobile). Requires 2 workers and higher setup cost.
- **Recipe**: A data-driven definition specifying inputs, outputs, processing time, and worker requirements for production
- **Worker**: A hireable NPC with attributes (name, age, gender, specialty, salary, experience level, commitment level) that enables and modifies production
- **Marketplace**: The global FIFO queue-based trading system where players sell inventory at the current global market price
- **Shop**: A consumer-facing business that generates NPC demand and revenue by consuming finished goods
- **Bank**: The in-game financial institution that issues loans to players
- **Loan**: A financial agreement where the Bank provides coins to a Player with scheduled repayment and interest
- **Net_Worth**: A player's total economic value calculated as Cash + Land Value + Factory Value + Inventory Market Value - Outstanding Debt
- **Tile**: A single pixel unit on the game map representing purchasable land
- **Mountain**: A terrain type where Metal and Energy factories can be built
- **Fertile_Soil**: A terrain type where Agriculture and Forestry factories can be built
- **Farmland**: A savannah-like terrain type where Livestock (Poultry, Cattle), Energy, and Forestry factories can be built
- **Water_Terrain**: A terrain type required for Fishery factories (exactly 2 tiles of the Fishery layout must be on water)
- **City**: A terrain type exclusively for consumer-facing Shops. No factories can be placed on CITY tiles. Each Shop requires exactly 1 CITY tile.
- **Specialty**: The commodity category a player selects at the start of each Season for a 10% production yield bonus
- **Fertilizer_Boost**: A time-limited production bonus applied to an Agriculture or Forestry Factory by consuming Fertilizer units; the boost lasts 5 days before requiring reapplication
- **Fertilizer_Quota**: The configurable number of Fertilizer units required to activate a Fertilizer_Boost on a specific factory type
- **Increment_Interval**: The time between each single unit of production output, calculated as production_time divided by yield
- **Instant_Sell**: A mechanism allowing players to sell inventory immediately to the Bank at 90% of the current market price
- **Demand_Multiplier**: A price modifier based on consumer demand that takes effect after Day 7
- **Supply_Multiplier**: A price modifier based on available supply that takes effect after Day 7
- **FIFO_Queue**: First-In-First-Out ordering system used by the Marketplace to determine which seller's goods are sold first
- **Wallet_Ledger**: An append-only transaction log recording every monetary change for a Player
- **Deconstruction_Fee**: A fee charged when a Player demolishes a Factory or Shop, calculated as a percentage of the original setup cost
- **Output_Switch_Cooldown**: A 72-hour lock period after a Player switches a Factory's exclusive output recipe, preventing further switches until the cooldown expires
- **Factory_Efficiency**: A percentage value (0%-100%) representing a Factory's current production speed relative to its base production time; new Factories start at 100%
- **Depreciation_Tick**: A recurring time interval (default every 5 days) at which a Factory's Factory_Efficiency decreases
- **Maintenance_Upgrade**: A paid action that restores a Factory's Factory_Efficiency up to a degrading maximum cap (100% minus 5% per prior maintenance performed in the current Season)
- **Land_Resale**: The act of selling previously owned land tiles back to the system at a depreciated price after Factory deconstruction
- **Workforce_Happiness**: A global per-Player metric (0%-100%) representing overall worker morale; affects effective commitment levels of all Workers owned by that Player
- **Happiness_Boost**: A purchasable action (Bonus, Company Trip, Salary Raise) that increases a Player's Workforce_Happiness metric by a configured amount
- **ON_VACATION**: A Worker status indicating the Worker refuses to work temporarily due to critically low Workforce_Happiness (triggered at or below 30%)
- **Season_Summary**: A generated record at the end of each Season containing key highlights, statistics, awards, and a thematic tagline
- **Last_Active_At**: A per-Player timestamp tracking the most recent login or game action, used for inactivity detection
- **Recipe_Simulation_Engine**: An admin-only tool that runs economic simulations using the same calculation logic as the live Game_Server to test balance configurations before applying them to a live season

---

## Requirements

### Requirement 1: Player Registration and Onboarding

**User Story:** As a new player, I want to create an account, customize my avatar, and choose a display name, so that I can begin playing with my unique identity. As any player, I want to select a commodity specialty at the start of each season, so that I can experiment with different strategies each round.

#### Acceptance Criteria

1. WHEN a new user authenticates via email or Google login, THE Game_Server SHALL create a Player account with 1,000 starting coins, 500 storage capacity, and zero owned land.
2. WHEN a Player account is created for the first time, THE Web_Client SHALL prompt the Player to customize an avatar and enter a display name.
3. WHEN a Season starts, THE Web_Client SHALL prompt every Player (new and returning) to select exactly one Level_0_Commodity category as their Specialty for that Season before allowing any other game actions.
4. THE Game_Server SHALL apply a 10% yield bonus to all production jobs in the Player's chosen Specialty category for the current Season.
5. WHEN an existing user authenticates mid-Season, THE Game_Server SHALL load the Player's current game state (including their already-selected Specialty) and redirect to the main game view.
6. IF a Player attempts to register with a display name that is already taken, THEN THE Game_Server SHALL reject the registration and return a descriptive error indicating the name is unavailable.

---

### Requirement 2: Map System and Land Purchase

**User Story:** As a player, I want to view a SEA-inspired pixel map with different terrain types and purchase tiles to place my factories, so that I can establish production facilities in strategic locations matching terrain requirements.

#### Acceptance Criteria

1. WHEN a new Season starts, THE Game_Server SHALL generate a randomized pixel-based map inspired by the geography of Malaysia and Indonesia with consistent percentages of Water_Terrain (15%), Mountain (20%), Fertile_Soil (25%), Farmland (25%), and City (15%) terrain types.
2. THE Web_Client SHALL render the map with distinct colors for each terrain type (Water_Terrain, Mountain, Fertile_Soil, Farmland, City) and indicate owned tiles per Player.
3. WHEN a Player selects a group of tiles for purchase, THE Game_Server SHALL validate that the tiles are unowned, contiguous, and that the Player has sufficient coins. For factory placement the tiles must match the required layout and terrain type for the chosen commodity category. For shop placement the Player must purchase exactly 1 CITY tile.
4. THE Game_Server SHALL price land at 25 coins per tile for the first 10 tiles, increasing by 5 coins per tile for every subsequent group of 10 tiles owned (tiles 11-20 cost 30, tiles 21-30 cost 35, and so on).
5. WHEN a land purchase is confirmed, THE Game_Server SHALL atomically deduct the total cost from the Player's wallet, record a LAND_PURCHASE entry in the Wallet_Ledger, and mark those tiles as owned by the Player.
6. THE Game_Server SHALL enforce commodity category land layout and terrain requirements: Agricultural requires 9 tiles (3x3) on Fertile_Soil, Energy requires 6 tiles (3x2) on Mountain or Farmland, Metal requires 4 tiles (2x2) on Mountain, Livestock (Poultry/Cattle) requires 6 tiles (3x2) on Farmland, Fishery requires 4 tiles (2x2) where exactly 2 tiles are on Water_Terrain and 2 tiles are on adjacent land terrain, and Forestry requires 9 tiles (3x3) on Fertile_Soil or Farmland. CITY terrain cannot be used for any factory type.
7. IF a Player attempts to place a Factory on tiles whose terrain type does not match the commodity category's terrain requirement, THEN THE Game_Server SHALL reject the placement and return a descriptive error indicating the terrain mismatch.
8. THE Game_Server SHALL NOT allow any Factory to be constructed on CITY terrain tiles.
9. THE Game_Server SHALL lock all CITY terrain tiles from purchase during the first 5 days of a Season. CITY tiles become available for purchase starting on Day 6.
10. IF a Player attempts to purchase a CITY tile during the first 5 days of a Season, THEN THE Game_Server SHALL reject the purchase and return a descriptive error indicating CITY tiles are locked until Day 6.
11. FOR THE MVP, THE Game_Server SHALL generate maps inspired by the combined geography of Malaysia and Indonesia, featuring terrain distributions that reflect these regions: Water_Terrain representing coastal and river areas, Fertile_Soil representing lowland tropical regions, Farmland representing plains and savannah areas, Mountain representing highland regions (e.g., Borneo Highlands, Java Highlands), and City representing urban centers (e.g., Kuala Lumpur, Jakarta).

---

### Requirement 3: Factory Construction

**User Story:** As a player, I want to build factories on my owned land to produce commodities, so that I can generate resources and begin participating in the economy.

#### Acceptance Criteria

1. WHEN a Player requests to construct a Factory on owned land, THE Game_Server SHALL validate that the Player owns sufficient contiguous tiles matching the commodity's layout requirement, that the tiles' terrain type matches the commodity category's terrain requirement, and that the Player has enough coins to pay the setup cost.
2. THE Game_Server SHALL charge setup costs based on commodity category and factory level: Level 0 production factories — Agricultural 300 coins, Energy 500 coins, Metal 500 coins, Livestock & Fisheries 400 coins, Forestry 300 coins. Level 1 processing factories — Agriculture Processing 350 coins, Energy Processing 600 coins, Metal Processing 650 coins, Livestock Processing 350 coins, Forestry Processing 400 coins. Level 2 assembly factories — Electronics Assembly 800 coins, Automotive Assembly 1000 coins.
3. WHEN a Factory is constructed, THE Game_Server SHALL record a FACTORY_PURCHASE entry in the Wallet_Ledger, set the Factory status to idle until at least one Worker is hired, initialize Factory_Efficiency at 100%, and record the setup cost for future Deconstruction_Fee calculation.
4. THE Game_Server SHALL enforce that a Factory remains idle and cannot begin production until the Player assigns at least one Worker to the Factory.
5. IF a Player attempts to construct a Factory without sufficient coins, valid land, on tiles with incorrect terrain type, or on CITY terrain, THEN THE Game_Server SHALL reject the request and return a descriptive error.
6. THE Game_Server SHALL associate each constructed Factory with depreciation tracking (see Requirement 22) and support deconstruction lifecycle (see Requirement 21).
7. THE Game_Server SHALL distinguish between Level 0 production factories (which produce raw commodities), Level 1 processing factories (which convert L0 goods into L1 goods using Recipes), and Level 2 assembly factories (which combine multiple L1 goods into L2 finished goods). Each factory type is a separate physical facility requiring its own land, terrain, workers, and setup cost.

---

### Requirement 4: Worker Hiring and Management

**User Story:** As a player, I want to hire workers with varying skills and assign them to my factories, so that I can start and optimize production output.

#### Acceptance Criteria

1. THE Game_Server SHALL maintain a pool of 2,000 Worker profiles, each with randomly generated name, age, gender, specialty, salary (6-10 coins per day based on experience level), experience level (1-5), and commitment level (70%-100%).
2. WHEN a Player hires a Worker, THE Game_Server SHALL assign the Worker to the Player and deduct the Worker's daily salary from the Player's wallet each game day, recording WORKER_WAGE entries in the Wallet_Ledger.
3. THE Game_Server SHALL enforce a maximum of 2 Workers per Factory.
4. WHEN a second Worker is assigned to a Factory, THE Game_Server SHALL increase that Factory's production yield by 25% before any specialty bonuses.
5. WHEN a Worker with a matching specialty is assigned to a Factory in that specialty's category, THE Game_Server SHALL increase the Factory's yield by the Worker's experience level percentage (level 5 Worker adds 5% yield).
6. THE Game_Server SHALL unlock additional Workers from the pool proportionally as more Players join or more commodities are produced.
7. THE Game_Server SHALL track each Worker with one of the following statuses: UNASSIGNED, WORKING, ABSENT, SICK, or ON_VACATION.
8. WHEN a Worker's effective commitment level (modified by Workforce_Happiness, see Requirement 25) triggers a random absence or sickness event, THE Game_Server SHALL set the Worker's status to ABSENT or SICK and reduce or halt production at the assigned Factory until the Worker returns.
9. WHEN a Player fires a Worker, THE Game_Server SHALL immediately settle any outstanding salary balance, return the Worker to the pool with UNASSIGNED status, and reduce the Player's Workforce_Happiness by 5 percentage points.

---

### Requirement 5: Level 0 Production System

**User Story:** As a player, I want to produce raw natural resources from my factories using hired workers, so that I can generate inventory to sell or process further.

#### Acceptance Criteria

1. WHEN a Player starts production at a Factory with at least one assigned Worker, THE Game_Server SHALL validate available input resources (if any), create a production job with a calculated completion time, and consume required inputs.
2. THE Game_Server SHALL calculate production time and yield based on the commodity's base values: Rice (4h, yield 12), Palm Fruit (6h, yield 10), Cocoa (8h, yield 8), Coffee (12h, yield 6), Crude Oil (8h, yield 8), Natural Gas (10h, yield 7), Iron Ore (10h, yield 10), Nickel Ore (18h, yield 6), Cattle (16h, yield 5), Poultry (6h, yield 15), Fish (8h, yield 12), Timber (24h, yield 10), Rubber (18h, yield 8).
3. THE Game_Server SHALL produce output incrementally during a production job: one unit is added to the Player's inventory every Increment_Interval, where Increment_Interval equals production_time divided by yield (e.g., Nickel Ore with 18h production time and yield 6 produces 1 unit every 3h).
4. THE Game_Server SHALL continue processing production jobs regardless of whether the Player's Web_Client is connected.
5. IF a Player's inventory reaches storage capacity mid-production, THEN THE Game_Server SHALL pause the production timer at the current increment until the Player frees inventory space (via marketplace listing, instant sell, or storage upgrade), at which point production resumes automatically.
6. THE Game_Server SHALL apply all yield modifiers additively from the base yield using the formula: final_yield equals base_yield multiplied by (1 + sum of all applicable bonus percentages), where bonus percentages include Specialty bonus (10%), second Worker bonus (25%), Worker skill bonus (experience level %), and Fertilizer bonus (when applicable). Example: base_yield 10 with Specialty 10%, second Worker 25%, and Worker skill 5% produces final_yield of 10 multiplied by (1 + 0.10 + 0.25 + 0.05) equals 14.
7. THE Game_Server SHALL apply the additive yield modifier to the base yield before calculating the Increment_Interval; Increment_Interval equals production_time divided by final_yield.
8. WHEN a production job completes (all units produced), THE Game_Server SHALL NOT automatically restart a new production cycle. The Player must manually initiate each production run. The Factory returns to IDLE status after completion.

---

### Requirement 6: Commodity Processing and Supply Chains

**User Story:** As a player, I want to process raw commodities into higher-value goods through defined recipes, so that I can move up the supply chain and generate more revenue.

#### Acceptance Criteria

1. THE Game_Server SHALL define processing paths as data-driven Recipes forming a directed production graph, supporting forks (one input producing different outputs), merges (multiple inputs combining), and varying chain depths.
2. WHEN a Player initiates Level 1 processing, THE Game_Server SHALL validate that the Player owns a dedicated Processing_Factory configured for that Recipe (separate from any Level 0 production factory), has sufficient input inventory, and has an assigned Worker, then create a production job.
3. THE Game_Server SHALL support Level 1 processing paths: Rice to Flour, Palm Fruit to Cooking Oil, Palm Fruit to Biodiesel, Coffee to Roasted Coffee, Cocoa to Chocolate, Crude Oil to Gasoline, Crude Oil to Plastic, Natural Gas to Fertilizer, Iron Ore to Steel, Nickel Ore to Battery, Poultry to Meat (choose one output), Poultry to Eggs (choose one output), Cattle to Beef (choose one output), Cattle to Milk (choose one output), Fish to Frozen Fish (choose one output), Timber to Furniture, Rubber to Tire.
4. THE Game_Server SHALL support Level 2 processing paths: 1 Plastic + 1 Battery to Mobile Phone, 1 Steel + 1 Tire + 1 Battery to Automobile.
5. THE Game_Server SHALL allow Fish to either bypass processing and route directly to the Butcher Shop as a Level 0 Commodity OR be processed into Frozen Fish at a Livestock Processing_Factory for sale at the Supermarket. The choice follows the same exclusive output switching system as Poultry and Cattle (see Requirement 27).
6. WHEN Fertilizer is applied to an Agriculture or Forestry Factory, THE Game_Server SHALL consume the configured Fertilizer_Quota from the Player's inventory, activate a Fertilizer_Boost on that Factory, and increase yield or reduce production time for the duration of the boost.
7. THE Game_Server SHALL expire each Fertilizer_Boost after 5 days from activation, removing the production bonus from the affected Factory.
8. WHEN a Fertilizer_Boost expires, THE Game_Server SHALL automatically consume another Fertilizer_Quota from the Player's inventory to reapply the boost; if the Player's inventory does not contain sufficient Fertilizer units, the boost SHALL simply expire without reapplication.
9. THE Game_Server SHALL load the Fertilizer_Quota required per factory type from configuration data, allowing game operators to tune Fertilizer costs per commodity category without code changes.
10. THE Game_Server SHALL store Fertilizer in the Player's regular inventory subject to the same storage capacity limits as any other commodity.
11. WHEN a Level 1 or Level 2 production job completes, THE Game_Server SHALL return the Processing_Factory or Assembly_Factory to IDLE status. The Player must manually initiate each new processing run.

---

### Requirement 7: Inventory and Storage Management

**User Story:** As a player, I want to manage my commodity inventory within a storage capacity limit and upgrade my storage as needed, so that I can hold more goods as my operations scale.

#### Acceptance Criteria

1. THE Game_Server SHALL track inventory as aggregated quantities per commodity type per Player.
2. THE Game_Server SHALL enforce storage capacity limits: each commodity type occupies storage space according to its defined storage_size, and total stored quantity cannot exceed the Player's current storage capacity.
3. THE Game_Server SHALL provide storage upgrades at fixed cost tiers: 500 (free default), 750 (100 coins), 1,000 (175 coins), 1,500 (300 coins), 2,000 (500 coins), 3,000 (800 coins), 5,000 (1,500 coins).
4. WHEN a Player purchases a storage upgrade, THE Game_Server SHALL atomically deduct the cost, record the transaction in the Wallet_Ledger, and increase the Player's storage capacity to the new tier.
5. IF a Player attempts to store inventory that would exceed capacity, THEN THE Game_Server SHALL reject the storage operation and notify the Player.

---

### Requirement 8: Global Marketplace with FIFO Queue

**User Story:** As a player, I want to list my commodities for sale on the global marketplace and buy available goods from other players, so that I can trade resources and earn coins.

#### Acceptance Criteria

1. THE Marketplace SHALL use a FIFO queue system where all goods of a given commodity type are sold at the current global market price, and earlier listings are fulfilled before later ones.
2. WHEN a Player lists inventory on the Marketplace, THE Game_Server SHALL move the specified quantity from the Player's inventory into the Marketplace queue for that commodity type, timestamping the listing for FIFO ordering.
3. WHEN a Player purchases a commodity from the Marketplace, THE Game_Server SHALL fulfill the order from the earliest listing in the FIFO queue, transfer the commodity to the buyer's inventory, transfer coins from buyer to seller, and record MARKETPLACE_SALE entries in both Players' Wallet_Ledgers.
4. THE Marketplace SHALL support partial fills: if a buyer purchases fewer units than the earliest listing contains, the remainder stays at the front of the queue.
5. WHEN a Player cancels a Marketplace listing, THE Game_Server SHALL return the unsold quantity to the Player's inventory.
6. THE Game_Server SHALL NOT allow Players to set custom prices on Marketplace listings; all transactions execute at the current global market price for that commodity.
7. THE Web_Client SHALL display available marketplace inventory per commodity type including quantity, current price, and queue position.

---

### Requirement 9: Instant Sell Mechanism

**User Story:** As a player, I want to immediately sell my inventory for guaranteed coins without waiting in the marketplace queue, so that I can access liquidity when I need it urgently.

#### Acceptance Criteria

1. WHEN a Player executes an Instant_Sell, THE Game_Server SHALL purchase the specified commodity quantity at 90% of the current global market price.
2. WHEN an Instant_Sell is executed, THE Game_Server SHALL atomically remove the commodity from the Player's inventory, credit the Player's wallet, and record an INSTANT_SELL entry in the Wallet_Ledger.
3. THE Game_Server SHALL process Instant_Sell transactions independently from the Marketplace FIFO queue; instant-sold goods do not enter or affect the player-to-player queue.
4. IF a Player attempts to Instant_Sell more units than they hold in inventory, THEN THE Game_Server SHALL reject the transaction and return a descriptive error.

---

### Requirement 10: Dynamic Pricing Engine

**User Story:** As a player, I want commodity prices to fluctuate based on supply and demand after the initial stabilization period, so that the economy feels dynamic and strategic trading decisions matter.

#### Acceptance Criteria

1. THE Game_Server SHALL calculate the actual commodity price as: Base Price multiplied by Demand_Multiplier multiplied by Supply_Multiplier.
2. THE Game_Server SHALL hold all prices at their base values for the first 7 days of a Season (multipliers equal 1.0).
3. WHEN Day 8 of a Season begins, THE Game_Server SHALL activate dynamic pricing where Supply_Multiplier and Demand_Multiplier reflect actual production, inventory, marketplace activity, shop consumption, and events.
4. WHILE dynamic pricing is active, THE Game_Server SHALL recalibrate all commodity prices once per day at midnight GMT+8.
5. THE Game_Server SHALL record every price recalibration in a commodity_price_history table including commodity_id, timestamp, price, supply metric, demand metric, and trade volume.
6. THE Web_Client SHALL display price history charts for each commodity so Players can observe trends and make informed trading decisions.

---

### Requirement 11: Bank and Loan System

**User Story:** As a player, I want to borrow money from the bank to accelerate my expansion, taking multiple concurrent loans with structured repayment schedules, so that I can grow faster while managing financial risk.

#### Acceptance Criteria

1. THE Bank SHALL allow a Player to hold multiple concurrent Loans, provided the total outstanding debt does not exceed 50% of the Player's current Net_Worth.
2. THE Game_Server SHALL enforce loan parameters: minimum loan amount of 100 coins, interest rate of 5% per 5-day period, repayment installments every 5 days, and maximum loan duration of 20 days.
3. WHEN a Player takes a Loan, THE Game_Server SHALL atomically credit the loan amount to the Player's wallet, create a Loan record with a repayment schedule, and record a LOAN_DISBURSEMENT entry in the Wallet_Ledger.
4. WHEN a loan installment is due, THE Game_Server SHALL automatically deduct the installment amount (principal portion plus accrued interest) from the Player's wallet and record a LOAN_REPAYMENT entry in the Wallet_Ledger.
5. THE Game_Server SHALL allow early repayment of any active Loan at any time without penalty.
6. IF a Player fails to make a scheduled loan payment due to insufficient funds, THEN THE Game_Server SHALL apply a late payment penalty and restrict the Player from taking new loans until the overdue amount is settled.
7. THE Game_Server SHALL recalculate maximum borrowing capacity before each new loan request based on current Net_Worth minus total outstanding debt.

---

### Requirement 12: Shop System and Consumer Demand

**User Story:** As a player, I want to build and operate consumer-facing shops that automatically consume my inventory and generate revenue from NPC customers, so that I can create a profitable end-to-end supply chain.

#### Acceptance Criteria

1. THE Game_Server SHALL support seven shop types: Supermarket (Rice products, Cooking Oil, Eggs, Milk, Chocolate, Frozen Fish), Butcher (Meat, Beef, Fish), Cafe (Roasted Coffee), Petrol Station (Gasoline, Biodiesel), Furniture Shop (Furniture), Electronics Shop (Mobile Phone), Car Store (Automobile).
2. WHEN a Player constructs a Shop, THE Game_Server SHALL validate that the Player owns exactly 1 CITY terrain tile designated for the Shop, that the tile is unoccupied by another Shop, and that the Player has sufficient coins, then record the purchase in the Wallet_Ledger.
3. WHILE a Shop is stocked with the minimum required product types (Supermarket: 2 types, Butcher: 1 type, all others: 1 type), THE Game_Server SHALL automatically consume inventory at the shop's configured demand rate and credit the Player's wallet with revenue.
4. THE Game_Server SHALL record all shop revenue as SHOP_REVENUE entries in the Wallet_Ledger.
5. IF a Shop's inventory drops below the minimum required product types, THEN THE Game_Server SHALL pause revenue generation until restocked.
6. THE Game_Server SHALL define each Shop type with configurable attributes: accepted commodities, demand rate, storage capacity, and minimum stocking requirements.
7. THE Game_Server SHALL enforce that all Shop types require exactly 1 CITY terrain tile regardless of shop type.
8. THE Game_Server SHALL NOT allow Shop construction on any terrain type other than CITY.
9. THE Game_Server SHALL calculate shop revenue per consumed unit using the formula: revenue_per_unit equals the commodity's current_market_price multiplied by 1.20 (20% markup over market rate). The total hourly revenue equals demand_rate multiplied by revenue_per_unit multiplied by revenue_multiplier for each stocked commodity type.
10. THE Game_Server SHALL apply the shop's revenue_multiplier as a configurable scaling factor on top of the base 20% shop markup, allowing different shop types to have different profitability profiles.

---

### Requirement 13: Season Lifecycle Management

**User Story:** As a player, I want the game to operate in time-bounded seasons with clear start and end points, so that the economy periodically resets and all players can compete on equal footing.

#### Acceptance Criteria

1. THE Game_Server SHALL manage Seasons with a configurable duration (default 30 days), using server-side UTC timestamps for all time calculations.
2. WHEN a Season starts, THE Game_Server SHALL initialize a fresh economy: new map generation, all Players reset to starting conditions (1,000 coins, 500 storage, zero assets), all marketplace queues cleared, and all Players' Specialty selections cleared requiring reselection.
3. WHEN a Season starts, THE Game_Server SHALL require every Player to select a new Specialty before performing any other game actions, allowing Players to choose a different commodity category than their previous Season.
4. THE Web_Client SHALL display a countdown timer to season end, calculated from the server-provided ends_at timestamp rather than browser-local time.
5. WHEN a Season ends, THE Game_Server SHALL calculate final standings, record the leaderboard, and prevent further economic actions until the next Season begins.
6. THE Game_Server SHALL persist season timestamps as absolute UTC values (starts_at, ends_at) and never store relative durations like "remaining_hours".

---

### Requirement 14: Natural Disasters and Economic Events

**User Story:** As a player, I want the game world to experience random events like natural disasters and market disruptions, so that the economy remains unpredictable and requires adaptive strategy.

#### Acceptance Criteria

1. THE Game_Server SHALL implement events as time-bounded modifiers with defined affected categories, affected regions, production modifiers, demand modifiers, and price modifiers.
2. WHEN a negative event triggers (Flood, Livestock Disease, Storm, Forest Fire), THE Game_Server SHALL apply the corresponding production modifier to affected commodity categories: Flood reduces Agriculture production by 30%, Livestock Disease reduces Poultry and Cattle production by 40%, Storm reduces Fisheries production by 30%, Forest Fire reduces Timber production by 50%.
3. WHEN a positive event triggers (Excellent Harvest, Government Infrastructure Program, EV Incentive), THE Game_Server SHALL apply the corresponding bonus modifier to affected categories.
4. THE Game_Server SHALL broadcast event start and end notifications to all connected Players via WebSocket.
5. WHEN an event ends, THE Game_Server SHALL remove all associated modifiers and restore normal production and pricing parameters.

---

### Requirement 15: Worker Disruption Events

**User Story:** As a player, I want worker reliability to vary based on their commitment level and my Workforce_Happiness, creating random disruptions that I must manage, so that workforce management adds strategic depth.

#### Acceptance Criteria

1. THE Game_Server SHALL generate random Worker absence, sickness, and ON_VACATION events with probability inversely proportional to the Worker's effective commitment level, where effective commitment equals the Worker's base commitment level multiplied by (Workforce_Happiness / 80), clamped between 0% and 100%.
2. WHEN a Worker becomes ABSENT or SICK, THE Game_Server SHALL reduce production output at the affected Factory proportionally to the number of unavailable Workers.
3. WHEN an absent or sick Worker recovers, THE Game_Server SHALL automatically restore the Worker to WORKING status and return production to normal output levels.
4. THE Game_Server SHALL generate Worker disruption events server-side on a periodic schedule, independent of Player connectivity.
5. WHEN a Worker disruption occurs, THE Game_Server SHALL notify the affected Player via the notification system.
6. WHEN a Player's Workforce_Happiness drops to 30% or below, THE Game_Server SHALL set one or more Workers to ON_VACATION status, halting production at their assigned Factories until Workforce_Happiness is raised above 30%.
7. WHILE a Worker is in ON_VACATION status, THE Game_Server SHALL halt all production at the Worker's assigned Factory and continue to deduct the Worker's daily salary from the Player's wallet.

---

### Requirement 16: Real-Time Notifications and Updates

**User Story:** As a player, I want to receive real-time updates about marketplace changes, production completions, events, and other relevant game activities, so that I can react promptly to changes in the economy.

#### Acceptance Criteria

1. THE Game_Server SHALL push real-time updates to connected Players via WebSocket for: marketplace order fills, price changes, production completions, worker status changes, global events, season events, and loan payment reminders.
2. THE Game_Server SHALL broadcast global announcements visible to all Players for significant events: Bank opens (Day 1), Global price changes begin (Day 8), Worker strikes, natural disasters, and season milestones.
3. WHEN a Player is not connected, THE Game_Server SHALL queue notifications and deliver them upon the Player's next connection.
4. THE Web_Client SHALL display notifications in a persistent notification panel and as transient toast messages for high-priority updates.

---

### Requirement 17: Leaderboard and Player Statistics

**User Story:** As a player, I want to see how I rank against other players and view my own economic statistics, so that I can track my progress and compete effectively.

#### Acceptance Criteria

1. THE Game_Server SHALL calculate and update Player rankings based on Net_Worth at regular intervals throughout the Season.
2. THE Web_Client SHALL display a leaderboard showing all Players ranked by Net_Worth with their display name and avatar.
3. THE Game_Server SHALL provide each Player with a personal dashboard showing: current cash balance, total Net_Worth breakdown, owned land count, factory count, active workers, inventory summary, outstanding loans, and shop revenue.
4. WHEN a Season ends, THE Game_Server SHALL finalize the leaderboard and preserve it as the Season's historical record.

---

### Requirement 18: Wallet Ledger and Transaction Integrity

**User Story:** As a player, I want every financial transaction to be recorded in an auditable ledger, so that I can review my economic history and the game maintains integrity against cheating.

#### Acceptance Criteria

1. THE Game_Server SHALL record every monetary change in the Wallet_Ledger with: player_id, transaction type, amount, balance_after, reference_type, reference_id, and timestamp.
2. THE Game_Server SHALL support transaction types including: FACTORY_PURCHASE, FACTORY_DECONSTRUCTION, FACTORY_MAINTENANCE, LAND_PURCHASE, LAND_RESALE, WORKER_WAGE, WORKER_FIRING_SETTLEMENT, MARKETPLACE_SALE, INSTANT_SELL, LOAN_DISBURSEMENT, LOAN_REPAYMENT, PRODUCTION_COST, SHOP_REVENUE, SHOP_DECONSTRUCTION, STORAGE_UPGRADE, and HAPPINESS_BOOST.
3. THE Game_Server SHALL execute all economic mutations (marketplace trades, loan repayments, factory purchases, production starts, instant sells) within database transactions to prevent duplication exploits and ensure atomicity.
4. THE Game_Server SHALL never trust the Web_Client for authoritative values of money, inventory, production completion, market prices, worker status, loan balances, or asset ownership.
5. IF a transaction would result in a negative wallet balance, THEN THE Game_Server SHALL reject the transaction and return a descriptive error.

---

### Requirement 19: Anti-Cheat and Server Authority

**User Story:** As a game operator, I want all economic calculations to be server-authoritative and protected against manipulation, so that the game remains fair for all players.

#### Acceptance Criteria

1. THE Game_Server SHALL perform all production calculations, price computations, trade executions, and inventory mutations server-side, treating the Web_Client as an untrusted display layer.
2. THE Game_Server SHALL validate every player action against current server state before executing: sufficient funds, valid ownership, correct inventory levels, active worker assignments, and valid factory configurations.
3. THE Game_Server SHALL use database-level row locking during marketplace trades to prevent race conditions where multiple buyers attempt to purchase the same queued inventory.
4. THE Game_Server SHALL rate-limit player actions to prevent automated exploitation of game mechanics.
5. IF the Game_Server detects an inconsistency between a Player's claimed state and the authoritative server state, THEN THE Game_Server SHALL reject the action and log the discrepancy for investigation.

---

### Requirement 20: Data-Driven Economy Configuration

**User Story:** As a game operator, I want commodity definitions, recipes, pricing, and economic parameters to be data-driven and configurable without code changes, so that the economy can be balanced through data updates.

#### Acceptance Criteria

1. THE Game_Server SHALL load all commodity definitions (name, category, level, base_price, base_production_time, base_yield, storage_size, max_workers) from configuration data rather than hard-coded application logic.
2. THE Game_Server SHALL load all Recipe definitions (input commodities, input quantities, output commodities, output quantities, processing time, worker requirements) from configuration data.
3. THE Game_Server SHALL load economic parameters (land pricing tiers, worker salary ranges, loan terms, storage upgrade costs, instant sell percentage, season duration) from configuration data.
4. WHEN configuration data is updated, THE Game_Server SHALL apply changes to new production jobs and economic calculations without requiring application redeployment.
5. THE Game_Server SHALL represent the commodity supply chain as a directed production graph supporting arbitrary depth, forks, merges, and shared resources.

---

### Requirement 21: Factory Deconstruction and Land Resale

**User Story:** As a player, I want to deconstruct factories or shops I no longer need and sell back the freed land tiles, so that I can recoup some investment and reallocate resources to more profitable ventures.

#### Acceptance Criteria

1. WHEN a Player requests to deconstruct a Factory, THE Game_Server SHALL validate that the Factory is idle (no active production job in progress) and that all assigned Workers are unassigned or fired before proceeding.
2. THE Game_Server SHALL charge a Deconstruction_Fee equal to 25% of the Factory's original setup cost, deduct the fee from the Player's wallet, and record a FACTORY_DECONSTRUCTION entry in the Wallet_Ledger.
3. WHEN a Factory is deconstructed, THE Game_Server SHALL remove the Factory, release the associated land tiles back to the Player as unoccupied owned land, and terminate any depreciation tracking for that Factory.
4. WHEN a Player requests to resell released land tiles, THE Game_Server SHALL credit the Player's wallet at 50% of the original per-tile purchase price, release tile ownership, record a LAND_RESALE entry in the Wallet_Ledger, and make the tiles available for other Players to purchase.
5. IF a Player attempts to deconstruct a Factory while a production job is active, THEN THE Game_Server SHALL reject the request and return a descriptive error indicating production must complete or be cancelled first.
6. IF a Player attempts to deconstruct a Factory without sufficient coins to cover the Deconstruction_Fee, THEN THE Game_Server SHALL reject the request and return a descriptive error.
7. THE Game_Server SHALL allow a Player to construct a new Factory on released land tiles without reselling them first, provided the tiles meet the layout requirements for the new commodity category.
8. WHEN a Player requests to deconstruct a Shop, THE Game_Server SHALL charge a Deconstruction_Fee equal to 25% of the Shop's original setup cost, remove the Shop, release the CITY tile back to the Player as unoccupied owned land, and record a SHOP_DECONSTRUCTION entry in the Wallet_Ledger.
9. THE Game_Server SHALL allow a Player to resell a released CITY tile using the same Land_Resale rules (50% of original purchase price).

---

### Requirement 22: Factory Depreciation and Maintenance

**User Story:** As a player, I want my factories to degrade in efficiency over time and require maintenance investment to stay productive, so that factory ownership involves ongoing strategic cost management and a decision between frequent maintenance vs. deconstruction and rebuilding.

#### Acceptance Criteria

1. THE Game_Server SHALL initialize every newly constructed Factory with a Factory_Efficiency of 100% and a maintenance_count of 0 for the current Season.
2. THE Game_Server SHALL reduce a Factory's Factory_Efficiency by 10 percentage points at every Depreciation_Tick (every 5 game days), to a minimum of 50% Factory_Efficiency (resulting in the schedule: Day 0 = 100%, Day 5 = 90%, Day 10 = 80%, Day 15 = 70%, Day 20 = 60%, Day 25 = 50%).
3. WHILE a Factory's Factory_Efficiency is below 100%, THE Game_Server SHALL increase that Factory's effective production time proportionally: effective_production_time equals base_production_time divided by (Factory_Efficiency / 100).
4. WHEN a Player performs a Maintenance_Upgrade on a Factory, THE Game_Server SHALL restore that Factory's Factory_Efficiency to a maximum of (100% minus (maintenance_count multiplied by 5%)), increment maintenance_count by 1, deduct the maintenance cost from the Player's wallet, and record a FACTORY_MAINTENANCE entry in the Wallet_Ledger.
5. THE Game_Server SHALL enforce that a Factory's maximum achievable efficiency permanently degrades with each Maintenance_Upgrade performed within a Season: the 1st maintenance restores to 95%, the 2nd to 90%, the 3rd to 85%, and so on, following the formula max_efficiency equals 100% minus (n multiplied by 5%) where n is the total number of maintenances performed on that Factory in the current Season.
6. THE Game_Server SHALL calculate maintenance cost as 15% of the Factory's original setup cost per Maintenance_Upgrade.
7. THE Game_Server SHALL process Depreciation_Ticks server-side on a scheduled basis, independent of Player connectivity.
8. THE Web_Client SHALL display each Factory's current Factory_Efficiency percentage, the current maximum achievable efficiency after maintenance, maintenance_count, and the time remaining until the next Depreciation_Tick.
9. IF a Factory's Factory_Efficiency reaches the minimum of 50%, THEN THE Game_Server SHALL hold Factory_Efficiency at 50% and notify the Player that maintenance is strongly recommended.
10. THE Game_Server SHALL reset each Factory's maintenance_count to 0 at the start of each new Season.

---

### Requirement 23: Season-End Summary and Highlights

**User Story:** As a player, I want to see a comprehensive summary of the season's highlights after it ends, so that I can reflect on what happened, celebrate achievements, and compare my performance to the broader economy.

#### Acceptance Criteria

1. WHEN a Season ends, THE Game_Server SHALL generate a Season_Summary record containing: a list of key events that occurred during the season (natural disasters, positive events, market disruptions), the highest-produced commodity type by total volume, the wealthiest Player (highest final Net_Worth), the market monopoly Player (Player who controlled the largest share of a single commodity's marketplace supply), the best pivot Player (Player who achieved the largest Net_Worth improvement in the shortest time window), and a thematic season tagline.
2. THE Game_Server SHALL calculate "market monopoly" as the Player who held the highest percentage of total marketplace supply for any single commodity at any point during the Season.
3. THE Game_Server SHALL calculate "best pivot" as the Player who achieved the greatest positive Net_Worth delta over any consecutive 5-day window within the Season.
4. THE Game_Server SHALL generate a thematic season tagline based on the Season's dominant trends (e.g., most-traded commodity category, frequency of disasters, economic volatility), stored as a text field in the Season record.
5. WHEN the Season_Summary is generated, THE Web_Client SHALL display the full summary to all Players, accessible from the season history view.
6. THE Game_Server SHALL persist Season_Summary data permanently as part of the Season's historical record, viewable across future Seasons.
7. THE Game_Server SHALL support a configurable tagline field in the Season data model to allow game operators to manually override or workshop the generated tagline.

---

### Requirement 24: Player Inactivity Email Reminder

**User Story:** As a game operator, I want inactive players to receive an email reminder after prolonged absence, so that players are encouraged to return and maintain engagement without being spammed.

#### Acceptance Criteria

1. THE Game_Server SHALL track a last_active_at timestamp for each Player, updated on every login or game action (production start, marketplace transaction, factory construction, or any state-mutating request).
2. WHEN a Player has been inactive for 5 consecutive days (no login or game action), THE Game_Server SHALL send a single email reminder to the Player's registered email address encouraging them to check in.
3. THE Game_Server SHALL send at most one inactivity reminder per continuous inactivity period; if the Player remains inactive after the reminder, no additional emails SHALL be sent until the Player returns and becomes inactive again.
4. WHEN a Player performs any game action or logs in, THE Game_Server SHALL reset the inactivity tracker by updating last_active_at, clearing any pending inactivity reminder state.
5. THE Game_Server SHALL process inactivity checks server-side on a daily scheduled basis, independent of Player connectivity.

---

### Requirement 25: Workforce Happiness System

**User Story:** As a player, I want to manage my overall workforce morale through strategic investments, so that I can reduce worker disruptions and maintain consistent production output across all my factories.

#### Acceptance Criteria

1. THE Game_Server SHALL initialize each Player's Workforce_Happiness at 80% at the start of every Season.
2. THE Game_Server SHALL passively decrease each Player's Workforce_Happiness by 1 percentage point per game day, processed server-side on a daily schedule independent of Player connectivity.
3. THE Game_Server SHALL provide purchasable Happiness_Boosts with configurable costs and effects, including at minimum: Bonus (small cost, +5% Workforce_Happiness), Company Trip (medium cost, +10% Workforce_Happiness), and Salary Raise (high cost, +15% Workforce_Happiness).
4. WHEN a Player purchases a Happiness_Boost, THE Game_Server SHALL atomically deduct the configured cost from the Player's wallet, increase the Player's Workforce_Happiness by the configured amount (capped at 100%), and record a HAPPINESS_BOOST entry in the Wallet_Ledger.
5. THE Game_Server SHALL load all Happiness_Boost definitions (name, cost, happiness increase percentage) from configuration data, allowing game operators to add, remove, or adjust boosts without code changes.
6. THE Game_Server SHALL calculate each Worker's effective commitment level as: base commitment level multiplied by (Workforce_Happiness / 80), clamped between 0% and 100%, where 80% represents the neutral baseline.
7. WHEN a Player's Workforce_Happiness drops to 50% or below, THE Game_Server SHALL send a warning notification to the Player indicating low workforce morale.
8. WHEN a Player's Workforce_Happiness drops to 30% or below, THE Game_Server SHALL trigger ON_VACATION status for one or more of the Player's Workers (see Requirement 15, criterion 6).
9. WHEN a Player fires a Worker, THE Game_Server SHALL reduce that Player's Workforce_Happiness by 5 percentage points (see Requirement 4, criterion 9).
10. THE Web_Client SHALL display the Player's current Workforce_Happiness percentage, available Happiness_Boosts with their costs, and a visual indicator when happiness is in warning (50% or below) or critical (30% or below) range.

---

### Requirement 26: Recipe Simulation Engine

**User Story:** As a game operator, I want to run economic simulations with different commodity parameters before applying them to a live season, so that I can balance the economy through data-driven analysis rather than trial and error on live players.

#### Acceptance Criteria

1. THE Game_Server SHALL provide a Recipe Simulation Engine accessible only to authorized game operators through the admin interface.
2. THE Recipe Simulation Engine SHALL accept configurable input parameters including: commodity base prices, production times, yields, recipe configurations, worker salary ranges, storage costs, and shop demand rates.
3. WHEN a game operator runs a simulation, THE Recipe Simulation Engine SHALL execute the same calculation logic used by the live Game_Server to model production output, marketplace flow, and pricing dynamics over a configurable simulated time period.
4. THE Recipe Simulation Engine SHALL output simulation results including: projected player earnings per commodity chain, supply and demand equilibrium points for each commodity, commodity flow analysis showing production-to-consumption ratios, and estimated price trajectories over the simulated period.
5. THE Recipe Simulation Engine SHALL support comparing multiple parameter configurations side-by-side so game operators can evaluate trade-offs between different balance approaches.
6. THE Game_Server SHALL store all commodity metrics (base_price, production_time, yield, storage_size, demand_rate) in a configuration table that the Recipe Simulation Engine reads from and that game operators can modify for simulation runs without affecting the live season.
7. THE Recipe Simulation Engine SHALL NOT affect any live game state; all simulation runs operate on isolated copies of configuration data.
8. THE Recipe Simulation Engine SHALL log each simulation run with its input parameters and output results for historical reference and audit purposes.

---

### Requirement 27: Exclusive Output Switching

**User Story:** As a player, I want to switch my Livestock or Fishery factory's output type (e.g., from Chicken Meat to Eggs) at any time, with a cooldown period after switching, so that I can adapt my strategy while preventing constant flip-flopping.

#### Acceptance Criteria

1. THE Game_Server SHALL allow a Player to switch a Factory's exclusive output recipe at any time, provided the Factory is idle (no active production job) and the 72-hour Output_Switch_Cooldown has expired or no switch has been made yet.
2. WHEN a Player switches a Factory's exclusive output, THE Game_Server SHALL lock the Factory from further output switches for 72 hours from the time of the switch.
3. THE Game_Server SHALL apply exclusive output switching to: Poultry factories (Chicken Meat OR Eggs), Cattle factories (Beef OR Milk), and Fishery factories (direct Fish to Butcher OR Frozen Fish to Supermarket).
4. IF a Player attempts to switch output while the 72-hour cooldown is active, THEN THE Game_Server SHALL reject the request and return a descriptive error indicating the remaining cooldown time.
5. IF a Player attempts to switch output while a production job is active at the Factory, THEN THE Game_Server SHALL reject the request and return a descriptive error indicating production must complete first.
6. THE Web_Client SHALL display the current output selection, available alternatives, and cooldown timer (if active) for each applicable Factory.
7. THE Game_Server SHALL default new Livestock and Fishery factories to no output selection, requiring the Player to choose an output before starting the first production job.
