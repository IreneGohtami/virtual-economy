# SEA Commodity Tycoon

A web-based multiplayer economic tycoon game set in Southeast Asia. Players produce, process, and trade commodities through multi-level supply chains inspired by the region's real-world industries. Built as a server-authoritative modular monolith ensuring fairness and preventing cheating across all connected players.

Players begin each season with equal starting capital, choose a commodity specialty, produce raw natural resources, process them through supply chains, trade on a global marketplace, build consumer-facing shops, take out bank loans, hire workers, and respond to dynamic economic events.

---

## Architecture Overview

The project is structured as a Turborepo monorepo:

```
/
├── apps/
│   ├── api/              # NestJS backend (REST + WebSocket)
│   ├── worker/           # BullMQ background job processors
│   ├── web/              # Next.js frontend (React)
│   └── admin/            # Admin dashboard
├── packages/
│   ├── shared-types/     # TypeScript interfaces & enums shared across apps
│   ├── game-rules/       # Pure calculation functions (yield, pricing, depreciation)
│   ├── config/           # Game configuration loader & schema validation
│   └── ui/               # Shared UI component library
├── docker-compose.yml
├── turbo.json
└── recipe-config.json    # Data-driven commodity, recipe & economy definitions
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14, React, TypeScript, Tailwind CSS |
| Backend API | NestJS, TypeORM, class-validator |
| Database | PostgreSQL 16 |
| Cache & Pub/Sub | Redis 7 |
| Job Queue | BullMQ |
| Real-Time | Socket.io (WebSocket Gateway) |
| Monorepo | Turborepo, pnpm workspaces |
| Testing | Vitest, fast-check (property-based) |
| Containerization | Docker, Docker Compose |
| Documentation | Swagger / OpenAPI |

---

## Prerequisites

- Node.js 20+
- pnpm 9.15+
- Docker & Docker Compose (for PostgreSQL and Redis)

---

## Getting Started

### 1. Install dependencies

```bash
pnpm install
```

### 2. Start infrastructure (PostgreSQL + Redis)

```bash
docker compose up -d postgres redis
```

### 3. Configure environment

```bash
cp .env.example .env
# Edit .env with your local settings (defaults work for Docker Compose)
```

### 4. Build all packages

```bash
pnpm build
```

### 5. Run services

```bash
# API server (port 3000)
pnpm --filter @sea-commodity-tycoon/api dev

# Background workers
pnpm --filter @sea-commodity-tycoon/worker dev

# Web client (port 3001)
pnpm --filter @sea-commodity-tycoon/web dev
```

---

## Docker Compose (Full Stack)

Run the entire stack with a single command:

```bash
docker compose up -d
```

This starts:

| Service | Port | Description |
|---------|------|-------------|
| `sct-postgres` | 5432 | PostgreSQL database |
| `sct-redis` | 6379 | Redis cache & queues |
| `sct-api` | 3000 | NestJS API server |
| `sct-worker` | — | BullMQ background workers |
| `sct-web` | 3001 | Next.js web client |

Health checks ensure services start in the correct order (DB/Redis ready before API/worker).

---

## Scripts

| Script | Description |
|--------|-------------|
| `pnpm build` | Build all apps and packages via Turborepo |
| `pnpm dev` | Start all services in development mode |
| `pnpm test` | Run all test suites |
| `pnpm lint` | Lint all packages |
| `pnpm clean` | Remove build artifacts and node_modules |

---

## Game Modules

| Module | Responsibility |
|--------|---------------|
| Auth | Registration, login (email/Google), JWT sessions |
| Player | Profile management, specialty selection, net worth |
| Map | Procedural map generation, terrain validation, tile purchase |
| Factory | Construction, depreciation, maintenance, output switching |
| Worker | Hiring, firing, assignment, disruption events |
| Production | L0/L1/L2 production, incremental output, yield calculation |
| Inventory | Storage tracking, capacity enforcement, upgrades |
| Marketplace | FIFO queue trading, listing, purchase, instant sell |
| Economy | Dynamic pricing engine, supply/demand multipliers |
| Bank | Loan issuance, installments, early repayment, debt ceiling |
| Shop | Construction on CITY tiles, stocking, auto-consumption, revenue |
| Season | Lifecycle management, reset, countdown, summary generation |
| Events | Natural disasters, economic modifiers, random triggers |
| Happiness | Workforce morale, daily decay, purchasable boosts |
| Notifications | WebSocket real-time delivery, offline queue, broadcasts |
| Admin | Recipe simulation engine, config management, manual triggers |

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Server-authoritative | All mutations happen on the backend; the browser is an untrusted display layer |
| Transactional integrity | Every economic change is atomic via PostgreSQL transactions with append-only wallet ledger |
| Data-driven economy | Commodities, recipes, pricing, and parameters loaded from configuration (not hard-coded) |
| Incremental production | Units produced one-at-a-time during a cycle via BullMQ delayed jobs |
| FIFO marketplace | All goods trade at the global dynamic price with first-in-first-out queue ordering |
| Modular monolith | Tightly coupled game systems benefit from in-process transactions and simpler consistency |

---

## API Endpoints

Full interactive documentation available at `http://localhost:3000/api/docs` (Swagger UI) when running in development.

Key endpoints:

| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/register` | Register new player |
| POST | `/auth/login` | Authenticate |
| GET | `/players/me` | Current player state |
| POST | `/players/me/specialty` | Select season specialty |
| GET | `/map/tiles` | Get viewport tiles |
| POST | `/map/tiles/purchase` | Purchase land tiles |
| POST | `/factories` | Construct a factory |
| POST | `/factories/:id/switch-output` | Switch exclusive output recipe |
| POST | `/production/start` | Start production job |
| POST | `/marketplace/list` | List inventory for sale |
| POST | `/marketplace/buy` | Buy from marketplace |
| POST | `/marketplace/instant-sell` | Instant sell at 90% market price |
| POST | `/bank/loans` | Request a loan |
| POST | `/shops` | Construct a shop |
| GET | `/economy/leaderboard` | Season leaderboard |
| GET | `/season/current` | Current season info |
| POST | `/admin/simulation/run` | Run recipe simulation (admin) |

---

## Testing

The project includes **463 tests** across **21 test files**, covering all game modules.

```bash
# Run all tests
pnpm test

# Run tests for a specific app
pnpm --filter @sea-commodity-tycoon/api test

# Run tests in watch mode (single package)
cd apps/api && npx vitest
```

Test coverage includes:
- Unit tests for all service modules (wallet, production, marketplace, economy, etc.)
- Property-based tests for pure game-rules calculations (fast-check)
- Integration tests for critical transaction flows

---

## Project Structure

```
apps/api/src/
├── admin/              # Admin endpoints & simulation engine
├── auth/               # Authentication (JWT, Google OAuth)
├── bank/               # Loan system
├── common/             # Shared guards, interceptors, decorators
├── config/             # NestJS configuration module
├── database/           # TypeORM connection & config
├── economy/            # Dynamic pricing engine
├── entities/           # TypeORM entity definitions
├── event/              # Natural disasters & economic events
├── factory/            # Factory construction, maintenance, output switching
├── happiness/          # Workforce happiness system
├── health/             # Health check endpoint
├── inventory/          # Storage & inventory management
├── map/                # Map generation & land purchase
├── marketplace/        # FIFO marketplace & instant sell
├── migrations/         # Database migrations
├── notification/       # WebSocket gateway & notifications
├── player/             # Player profiles & specialty
├── production/         # Production jobs & incremental output
├── queue/              # BullMQ queue definitions
├── redis/              # Redis connection module
├── season/             # Season lifecycle & summary
├── shop/               # Shop system & revenue
├── throttle/           # Rate limiting
├── wallet/             # Wallet ledger & transactional integrity
├── worker/             # Worker hiring & management
├── app.module.ts       # Root application module
└── main.ts             # Application bootstrap
```

---

## License

Private
