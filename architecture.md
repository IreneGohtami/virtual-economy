# SEA Commodity Tycoon — MVP Architecture & Technology Stack

## 1. Project Overview

A web-based multiplayer economic tycoon game inspired by Southeast Asian supply chains.

Players:

- Start with limited capital and land.
- Produce Level 0 natural commodities.
- Choose different processing paths/forks.
- Trade commodities in a shared real-time marketplace.
- Upgrade into processed and high-value goods.
- Build consumer-facing businesses such as supermarkets, cafes, petrol stations, butcher shops, furniture shops, electronics shops and car stores.
- Borrow money from a bank to accelerate expansion.
- React to supply/demand-driven price fluctuations.
- Eventually respond to events such as natural disasters, worker absence and other market disruptions.

The game should prioritize:

1. A responsive, game-like user experience.
2. Server-authoritative economic simulation.
3. Deterministic and auditable game calculations.
4. Real-time multiplayer interaction.
5. Strong protection against cheating and market manipulation.
6. The ability to evolve the economy without rewriting the core architecture.

---

# 2. Recommended Architecture

## Architecture Style

Use a **modular monolith with asynchronous workers** for MVP.

Avoid starting with microservices.

```text
                        ┌─────────────────────┐
                        │      Web Client      │
                        │   React / Next.js    │
                        └──────────┬──────────┘
                                   │
                         HTTPS / WebSocket
                                   │
                                   ▼
┌──────────────────────────────────────────────────────────────┐
│                         Game Backend                          │
│                                                              │
│  ┌──────────┐ ┌─────────────┐ ┌────────────┐ ┌────────────┐ │
│  │ Identity │ │ Game State  │ │ Marketplace│ │  Economy   │ │
│  │ & Player │ │ & Actions   │ │            │ │ Simulation │ │
│  └──────────┘ └─────────────┘ └────────────┘ └────────────┘ │
│                                                              │
│  ┌──────────────┐ ┌────────────┐ ┌────────────┐             │
│  │ Production   │ │ Bank /     │ │ Event /    │             │
│  │ & Workers    │ │ Loans      │ │ Season     │             │
│  └──────────────┘ └────────────┘ └────────────┘             │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
              ┌─────────────────────────┐
              │       PostgreSQL        │
              │ Persistent game state   │
              └─────────────────────────┘
                           │
                  ┌────────┴────────┐
                  ▼                 ▼
             Redis / Cache     Job Queue
                               & Workers
```

### Why a modular monolith?

The game has many tightly coupled systems:

- Production affects inventory.
- Inventory affects supply.
- Supply affects prices.
- Prices affect player decisions.
- Processing consumes inventory.
- Shops create demand.
- Loans affect player liquidity.
- Seasons affect the entire economy.

Keeping these systems in one backend initially makes transactions and consistency much easier.

Extract services only when actual scale or operational complexity justifies it.

---

# 3. Technology Stack

## Frontend

### Recommended

- **Next.js**
- **React**
- **TypeScript**
- **Tailwind CSS**
- **TanStack Query**
- **Zustand** for lightweight client-side UI state
- **WebSocket / SSE client** for real-time updates
- **ECharts / Recharts** for economic charts

### Responsibilities

The frontend should handle:

- Map/grid rendering
- Player dashboard
- Factory management
- Worker management
- Inventory UI
- Marketplace
- Bank
- Production queues
- Commodity price charts
- Notifications
- Shop management
- Season countdown
- Game events

The frontend should **never be responsible for authoritative economic calculations**.

For example, do not trust:

```text
client says:
"I produced 100 units."
```

Instead:

```text
client:
"Start production."

server:
validates resources
→ creates production job
→ calculates completion
→ updates inventory
```

---

# 4. Backend

## Recommended

### TypeScript + Node.js

Use a structured backend framework such as:

- **NestJS** for the core API/application layer

or, if preferring a lighter stack:

- Fastify + TypeScript

For this game, NestJS is a good fit because the domain will naturally split into modules.

### Backend modules

```text
src/
├── auth/
├── players/
├── seasons/
├── maps/
├── land/
├── commodities/
├── factories/
├── workers/
├── production/
├── inventory/
├── marketplace/
├── economy/
├── bank/
├── shops/
├── events/
├── notifications/
└── admin/
```

Each module owns its business rules.

---

# 5. Database

## PostgreSQL

Use PostgreSQL as the primary source of truth.

Recommended for:

- Player accounts
- Player assets
- Land
- Factories
- Workers
- Commodity definitions
- Recipes
- Production jobs
- Inventory
- Marketplace orders
- Transactions
- Loans
- Shops
- Seasons
- Economic events
- Price history

### Important principle

Do not store only the current balance.

Maintain a **transaction ledger**.

Example:

```text
wallet_transactions

id
player_id
type
amount
balance_after
reference_type
reference_id
created_at
```

Examples:

```text
FACTORY_PURCHASE
LAND_PURCHASE
WORKER_WAGE
MARKETPLACE_SALE
INSTANT_SELL
LOAN_DISBURSEMENT
LOAN_REPAYMENT
PRODUCTION_COST
SHOP_REVENUE
```

This gives you:

- Auditability
- Debugging
- Anti-cheat investigation
- Economic analysis
- Player support tools
- Ability to reconstruct what happened

---

# 6. Redis

Use Redis for temporary, high-frequency state.

Good candidates:

- WebSocket presence
- Short-lived cache
- Rate limiting
- Marketplace snapshots
- Active production timers
- Distributed locks
- Session-related ephemeral state

Do **not** make Redis the permanent source of truth for player inventory or money.

PostgreSQL remains authoritative.

---

# 7. Job Queue / Workers

A background job system is essential because production and economic events should not depend on a player keeping their browser open.

Use:

- Redis + BullMQ

or another reliable queue system.

Example jobs:

```text
production.complete
worker.check_absence
worker.return_to_work
loan.installment_due
season.start
season.end
market.recalculate
price.snapshot
natural_disaster.start
natural_disaster.end
```

---

# 8. Real-Time Architecture

The game should be server-authoritative but selectively real-time.

Use WebSockets for things players care about immediately:

- Marketplace order updates
- Price changes
- Production completion
- Worker status
- Notifications
- Global events
- Season events

Do NOT stream every economic calculation to every player.

Instead:

```text
Server
  │
  ├── PostgreSQL → authoritative state
  │
  ├── Redis → transient state
  │
  └── WebSocket → relevant changes
```

Example:

```text
Player A lists 500 Rice
        ↓
Marketplace transaction
        ↓
PostgreSQL transaction
        ↓
Publish marketplace event
        ↓
Relevant connected players receive update
```

---

# 9. Game Time & Seasons

The game must use **server time**, not browser time.

Initial configuration:

```text
Season duration: 30 days
Price stabilization: first 7 days
```

Use UTC timestamps internally.

```text
season
├── id
├── starts_at
├── ends_at
├── status
└── configuration
```

The client calculates display countdowns from server timestamps.

Never persist:

```text
"remaining_hours": 23
```

Persist:

```text
"ends_at": "2026-09-10T00:00:00Z"
```

This avoids timer drift and browser manipulation.

---

# 10. Commodity System

Commodity definitions should be **data-driven**, not hard-coded.

Example conceptual model:

```text
commodity
├── id
├── name
├── category
├── level
├── base_price
├── base_production_time
├── base_yield
├── storage_size
├── max_workers
└── metadata
```

Recipes should be separate:

```text
recipe
├── id
├── input_commodity
├── input_quantity
├── output_commodity
├── output_quantity
├── processing_time
├── worker_requirement
└── setup_requirement
```

This lets you change:

```text
Cocoa → Chocolate
```

without deploying new application code.

---

# 11. Commodity Chain

The economy should support arbitrary depth and branching.

Do NOT model:

```text
Level 0 → Level 1 → Level 2 → Level 3
```

as a rigid hierarchy.

Instead model a **directed production graph**.

Example:

```text
                  Crude Oil
                 /         \
                ↓           ↓
           Gasoline       Plastic
               ↓             \
        Petrol Station       + Battery
                              ↓
                         Mobile Phone
                              ↓
                      Electronics Shop
```

This supports:

- Forks
- Multiple inputs
- Multiple outputs
- Shared resources
- Different chain depths
- Future expansion

---

# 12. Current MVP Commodity Graph

## Agriculture

```text
Rice → Rice Flour → Supermarket

Palm Fruit ─→ Cooking Oil → Supermarket
            └→ Biodiesel → Petrol Station

Coffee Beans → Roasted Coffee → Cafe

Cocoa Beans → Chocolate → Supermarket
```

## Energy

```text
Crude Oil ─→ Gasoline → Petrol Station
           └→ Plastic ─┐
                       ├→ Mobile Phone
Nickel Ore → Battery ──┘
                       ↓
                 Electronics Shop

Natural Gas → Fertilizer → Agriculture
```

Fertilizer is a production input rather than a consumer product.

It can:

- Increase yield
- Reduce production time
- Be consumed when applied

## Metal

```text
Iron Ore → Steel ───────────────┐
                                ├→ Automobile
Rubber → Tire ──────────────────┤
                                │
Nickel Ore → Battery ───────────┘
                                ↓
                           Car Store
```

Battery may also be consumed by:

```text
Plastic + Battery → Mobile Phone
```

## Livestock & Fisheries

```text
Poultry ─→ Chicken ─┐
                    │
Poultry ─→ Eggs ────┼→ Consumer markets
                    │
Cattle ─→ Beef ─────┤
                    │
Cattle ─→ Milk ─────┤
                    │
Fish ───────────────┘
```

Consumer routing can later be:

```text
Meat / Fish → Butcher
Eggs / Milk → Supermarket
```

## Forestry

```text
Timber → Furniture → Furniture Shop

Rubber → Tire → Automobile
```

---

# 13. Worker System

Initial rules:

```text
Worker wage: 8 coins/day
Maximum workers per Level 0 setup: 2
Second worker: +25% base yield
```

Worker state:

```text
AVAILABLE
WORKING
ABSENT
SICK
FIRED
```

The worker system should support temporary disruptions without permanently changing the player's assets.

Example:

```text
2 workers
    ↓
1 worker absent
    ↓
production temporarily drops
    ↓
worker returns
    ↓
production returns to normal
```

Worker absence should be server-generated.

---

# 14. Production System

Production should be represented as jobs.

```text
production_job

id
player_id
factory_id
recipe_id
started_at
completes_at
status
worker_count
input_snapshot
output_snapshot
```

When a player starts production:

1. Validate factory.
2. Validate workers.
3. Validate input inventory.
4. Reserve/consume inputs.
5. Create production job.
6. Worker calculates completion.
7. Queue completion job.
8. Add output to inventory when completed.

The client does not need to remain online.

---

# 15. Inventory & Storage

Each player starts with:

```text
500 storage capacity
```

Inventory should be itemized by commodity.

```text
inventory
├── player_id
├── commodity_id
└── quantity
```

Storage expansion is an asset upgrade.

Do not store every individual unit as a database row.

Use aggregated quantities unless individual item provenance becomes important later.

---

# 16. Marketplace

The marketplace is a player-to-player trading system.

Core entities:

```text
market_orders
market_trades
market_prices
```

Example order:

```text
SELL
Rice
500 units
4.20 coins/unit
```

The marketplace should support:

- Partial fills
- Order cancellation
- Order matching
- Transaction fees
- Price history
- Market depth

### Instant Sell

Players can immediately liquidate inventory at:

```text
90% of current market price
```

This provides guaranteed liquidity.

Keep the Instant Sell mechanism separate from player-to-player orders.

---

# 17. Supply & Demand Engine

Dynamic pricing starts after Day 7.

Do not calculate prices solely from the current order book.

The economic engine should eventually incorporate:

```text
Production
+
Inventory
+
Player demand
+
NPC demand
+
Shop consumption
+
Marketplace activity
+
Events
```

Conceptually:

```text
Supply / Demand
       ↓
Market pressure
       ↓
Price multiplier
       ↓
Current commodity price
```

Store historical prices so players can see charts.

Example:

```text
commodity_price_history

commodity_id
timestamp
price
supply
demand
volume
```

---

# 18. Bank

Initial design:

```text
Minimum loan: 100 coins
Maximum loan: 50% of net worth
Interest: 5% every 5 days
Maximum term: 20 days
Early repayment: allowed
```

Net worth:

```text
Cash
+ Land value
+ Factory value
+ Inventory market value
- Outstanding debt
```

Loans should be represented as ledger-backed financial entities.

Do not simply increase the player's balance without recording the debt.

---

# 19. Shop System

Shops are **consumer demand generators**, not simply another crafting step.

Examples:

```text
Supermarket
Butcher
Cafe
Petrol Station
Furniture Shop
Electronics Shop
Car Store
```

Each shop has:

```text
shop
├── type
├── player_id
├── level
├── storage
├── accepted_commodities
├── demand_rate
└── configuration
```

Later, shops can:

- Consume inventory automatically
- Generate NPC sales
- Have customer demand
- Have different product margins
- Have location effects
- Upgrade capacity
- Compete for market share

The actual shop revenue model can be added later without changing the commodity architecture.

---

# 20. Natural Disasters & Events

Events should be implemented as modifiers rather than hard-coded exceptions.

Example:

```text
event
├── type
├── starts_at
├── ends_at
├── affected_categories
├── affected_regions
├── production_modifier
├── demand_modifier
└── price_modifier
```

Examples:

```text
Flood
→ Agriculture production -30%

Livestock Disease
→ Poultry / Cattle production -40%

Storm
→ Fisheries production -30%

Forest Fire
→ Timber production -50%
```

This also allows positive events later:

```text
Excellent Harvest
→ Agriculture +20%

Government Infrastructure Program
→ Steel demand +30%

EV Incentive
→ Battery demand +40%
```

---

# 21. Anti-Cheat & Economic Integrity

This is critical for a multiplayer economy.

Never trust the client with:

- Money
- Inventory
- Production completion
- Market price
- Worker status
- Loan balances
- Asset ownership
- Shop revenue

All economic mutations must happen server-side.

Use database transactions for operations such as:

```text
Marketplace trade
Loan repayment
Factory purchase
Production start
Production completion
Instant sell
```

For example:

```text
BEGIN TRANSACTION

Lock buyer wallet
Lock seller inventory
Lock marketplace order

Validate balances
Transfer currency
Transfer inventory
Update order

Write ledger entries

COMMIT
```

This prevents duplication exploits.

---

# 22. Admin / Game Master Tools

Build an internal admin interface early.

It should allow authorized admins to:

- Inspect player wallets
- Inspect inventory
- Inspect assets
- Adjust balances
- Pause production
- Modify commodity prices
- Modify recipes
- Modify production times
- Trigger events
- Start/end seasons
- View economic statistics
- Investigate transaction history

This is particularly important while balancing the economy.

---

# 23. Observability

Recommended:

- Structured application logs
- Error tracking
- Metrics
- Database monitoring
- Job queue monitoring
- Economic dashboards

Track metrics such as:

```text
Average player wealth
Median player wealth
Money created / destroyed
Commodity production
Commodity consumption
Marketplace volume
Instant Sell volume
Average commodity price
Price volatility
Loan issuance
Loan default rate
Factory utilization
Shop consumption
```

These metrics will be far more useful for balancing than intuition alone.

---

# 24. Deployment

For MVP:

```text
Frontend
    ↓
CDN / Edge hosting

Backend API
    ↓
Managed container / application hosting

PostgreSQL
    ↓
Managed PostgreSQL

Redis
    ↓
Managed Redis

Worker
    ↓
Separate worker process
```

The frontend, API and worker should be deployable independently, even if they live in the same repository.

Recommended repository structure:

```text
/apps
  /web
  /api
  /worker
  /admin

/packages
  /game-rules
  /shared-types
  /ui
  /config
```

---

# 25. Shared Game Rules Package

This is particularly useful.

Create a shared package:

```text
packages/game-rules
```

Containing definitions such as:

```text
commodity definitions
recipe definitions
worker modifiers
land pricing
storage upgrades
loan rules
market constants
season rules
```

However, the **server remains authoritative**.

The frontend can use shared definitions for display and previews, but the server performs the final calculation.

---

# 26. Suggested MVP Development Phases

## Phase 1 — Core Game

- Authentication
- Player profile
- 1,000 starting coins
- Map
- Land purchase
- Factory/setup
- Workers
- Level 0 production
- Inventory
- Storage

## Phase 2 — Economy

- Commodity configuration
- Recipes
- Processing
- Multiple production paths
- Wallet ledger
- Production jobs

## Phase 3 — Multiplayer

- Marketplace
- Player-to-player trades
- Instant Sell
- Real-time price updates
- Price history

## Phase 4 — Financial System

- Bank
- Loans
- Interest
- Net worth
- Repayment

## Phase 5 — Consumer Economy

- Shops
- Shop inventory
- Consumer demand
- Revenue generation

## Phase 6 — Dynamic World

- Supply/demand pricing
- NPC demand
- Events
- Natural disasters
- Worker absence/sickness

## Phase 7 — Balance & Scale

- Economic analytics
- Admin tools
- Anti-exploit hardening
- Performance optimization
- Season reset / progression
- More commodities and recipes

---

# 27. MVP Principles

Keep these principles throughout development:

### 1. Server-authoritative

The browser is a client, not the game engine.

### 2. Data-driven economy

Commodity prices, recipes and production times should be configurable.

### 3. Transactional money and inventory

Every economic change should be atomic and auditable.

### 4. Event-driven where appropriate

Use jobs/events for production, seasons, market updates and world events.

### 5. Don't over-engineer

Start with a modular monolith.

### 6. Don't hard-code the commodity tree

Represent it as a graph of recipes and inputs/outputs.

### 7. Balance through data

Do not rewrite application logic whenever:

```text
Cocoa production = 8h
```

needs to become:

```text
Cocoa production = 10h
```

### 8. Build for simulation, not just UI

The economy should continue progressing when the player is offline.

---

# 28. High-Level Final Stack

```text
Frontend
├── Next.js
├── React
├── TypeScript
├── Tailwind CSS
├── TanStack Query
├── Zustand
└── WebSocket client

Backend
├── Node.js
├── TypeScript
├── NestJS
└── WebSocket Gateway

Data
├── PostgreSQL
├── Redis
└── BullMQ

Infrastructure
├── CDN / Edge hosting
├── Managed API/container hosting
├── Managed PostgreSQL
├── Managed Redis
└── Separate worker process

Observability
├── Error tracking
├── Structured logs
├── Metrics
└── Economic analytics

Architecture
└── Modular Monolith + Async Workers
```

## Core architectural philosophy

```text
                 PLAYER
                    │
                    ▼
              WEB CLIENT
                    │
                    ▼
           SERVER-AUTHORITATIVE API
                    │
       ┌────────────┼────────────┐
       ▼            ▼            ▼
    GAME STATE   ECONOMY     MARKETPLACE
       │            │            │
       └────────────┼────────────┘
                    ▼
               POSTGRESQL
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
       REDIS              JOB QUEUE
                              │
                              ▼
                           WORKER
                              │
                              ▼
                    PRODUCTION / MARKET
                       SIMULATION
```

The key architectural decision is to **treat the economy as a simulation engine**, not as a collection of CRUD screens. That will make your later supply/demand system, forks, shops, disasters and seasonal resets much easier to build on top of the MVP.
