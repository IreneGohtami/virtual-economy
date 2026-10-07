import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1700000000000 implements MigrationInterface {
  name = 'InitialSchema1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ============================================================
    // CORE ENTITIES
    // ============================================================

    await queryRunner.query(`
      CREATE TABLE seasons (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        starts_at TIMESTAMPTZ NOT NULL,
        ends_at TIMESTAMPTZ NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        configuration JSONB NOT NULL DEFAULT '{}',
        map_seed BIGINT NOT NULL,
        summary JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE players (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        auth_provider VARCHAR(20) NOT NULL,
        auth_provider_id VARCHAR(255),
        display_name VARCHAR(50) UNIQUE NOT NULL,
        avatar_config JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE player_seasons (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        player_id UUID NOT NULL REFERENCES players(id),
        season_id UUID NOT NULL REFERENCES seasons(id),
        specialty VARCHAR(50),
        coins DECIMAL(15, 2) NOT NULL DEFAULT 1000.00,
        storage_capacity INT NOT NULL DEFAULT 500,
        workforce_happiness DECIMAL(5, 2) NOT NULL DEFAULT 80.00,
        last_happiness_decay_at TIMESTAMPTZ,
        inactivity_reminder_sent BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(player_id, season_id)
      )
    `);

    await queryRunner.query(`CREATE INDEX idx_player_seasons_player ON player_seasons(player_id)`);
    await queryRunner.query(`CREATE INDEX idx_player_seasons_season ON player_seasons(season_id)`);

    // ============================================================
    // MAP & LAND
    // ============================================================

    await queryRunner.query(`
      CREATE TABLE map_tiles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        season_id UUID NOT NULL REFERENCES seasons(id),
        x INT NOT NULL,
        y INT NOT NULL,
        terrain_type VARCHAR(20) NOT NULL,
        owner_player_id UUID REFERENCES players(id),
        factory_id UUID,
        purchased_at TIMESTAMPTZ,
        purchase_price DECIMAL(10, 2),
        UNIQUE(season_id, x, y)
      )
    `);

    await queryRunner.query(`CREATE INDEX idx_map_tiles_season_owner ON map_tiles(season_id, owner_player_id)`);
    await queryRunner.query(`CREATE INDEX idx_map_tiles_season_terrain ON map_tiles(season_id, terrain_type)`);
    await queryRunner.query(`CREATE INDEX idx_map_tiles_factory ON map_tiles(factory_id)`);

    // ============================================================
    // COMMODITIES & RECIPES
    // ============================================================

    await queryRunner.query(`
      CREATE TABLE commodities (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(100) NOT NULL,
        slug VARCHAR(100) UNIQUE NOT NULL,
        category VARCHAR(50) NOT NULL,
        level INT NOT NULL DEFAULT 0,
        base_price DECIMAL(10, 2) NOT NULL,
        base_production_time_minutes INT NOT NULL,
        base_yield INT NOT NULL,
        storage_size INT NOT NULL DEFAULT 1,
        max_workers INT NOT NULL DEFAULT 2,
        terrain_requirement VARCHAR(20),
        land_layout VARCHAR(10),
        setup_cost DECIMAL(10, 2),
        metadata JSONB NOT NULL DEFAULT '{}',
        active BOOLEAN NOT NULL DEFAULT TRUE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE recipes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(100) NOT NULL,
        slug VARCHAR(100) UNIQUE NOT NULL,
        processing_time_minutes INT NOT NULL,
        worker_requirement INT NOT NULL DEFAULT 1,
        output_commodity_id UUID NOT NULL REFERENCES commodities(id),
        output_quantity INT NOT NULL DEFAULT 1,
        factory_category VARCHAR(50) NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}',
        active BOOLEAN NOT NULL DEFAULT TRUE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE recipe_inputs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
        commodity_id UUID NOT NULL REFERENCES commodities(id),
        quantity INT NOT NULL DEFAULT 1
      )
    `);

    await queryRunner.query(`CREATE INDEX idx_recipe_inputs_recipe ON recipe_inputs(recipe_id)`);

    // ============================================================
    // FACTORIES
    // ============================================================

    await queryRunner.query(`
      CREATE TABLE factories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        player_id UUID NOT NULL REFERENCES players(id),
        season_id UUID NOT NULL REFERENCES seasons(id),
        commodity_id UUID REFERENCES commodities(id),
        recipe_id UUID REFERENCES recipes(id),
        category VARCHAR(50) NOT NULL,
        factory_level INT NOT NULL DEFAULT 0,
        status VARCHAR(20) NOT NULL DEFAULT 'IDLE',
        efficiency DECIMAL(5, 2) NOT NULL DEFAULT 100.00,
        maintenance_count INT NOT NULL DEFAULT 0,
        setup_cost DECIMAL(10, 2) NOT NULL,
        last_depreciation_at TIMESTAMPTZ,
        fertilizer_boost_active BOOLEAN NOT NULL DEFAULT FALSE,
        fertilizer_boost_expires_at TIMESTAMPTZ,
        exclusive_output_slug VARCHAR(100),
        output_switch_cooldown_until TIMESTAMPTZ,
        constructed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`CREATE INDEX idx_factories_player_season ON factories(player_id, season_id)`);

    // Add FK from map_tiles.factory_id to factories.id (deferred since factories table is created after map_tiles)
    await queryRunner.query(`ALTER TABLE map_tiles ADD CONSTRAINT fk_map_tiles_factory FOREIGN KEY (factory_id) REFERENCES factories(id)`);

    // ============================================================
    // WORKERS
    // ============================================================

    await queryRunner.query(`
      CREATE TABLE worker_profiles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(100) NOT NULL,
        age INT NOT NULL,
        gender VARCHAR(10) NOT NULL,
        specialty VARCHAR(50) NOT NULL,
        salary DECIMAL(10, 2) NOT NULL,
        experience_level INT NOT NULL CHECK (experience_level BETWEEN 1 AND 5),
        commitment_level DECIMAL(5, 2) NOT NULL CHECK (commitment_level BETWEEN 70 AND 100),
        season_id UUID NOT NULL REFERENCES seasons(id),
        unlocked BOOLEAN NOT NULL DEFAULT FALSE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE worker_assignments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        worker_id UUID NOT NULL REFERENCES worker_profiles(id),
        player_id UUID NOT NULL REFERENCES players(id),
        factory_id UUID REFERENCES factories(id),
        season_id UUID NOT NULL REFERENCES seasons(id),
        status VARCHAR(20) NOT NULL DEFAULT 'WORKING',
        hired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        status_changed_at TIMESTAMPTZ,
        disruption_ends_at TIMESTAMPTZ
      )
    `);

    await queryRunner.query(`CREATE INDEX idx_worker_assignments_player ON worker_assignments(player_id, season_id)`);
    await queryRunner.query(`CREATE INDEX idx_worker_assignments_factory ON worker_assignments(factory_id)`);

    // ============================================================
    // PRODUCTION
    // ============================================================

    await queryRunner.query(`
      CREATE TABLE production_jobs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        player_id UUID NOT NULL REFERENCES players(id),
        factory_id UUID NOT NULL REFERENCES factories(id),
        recipe_id UUID REFERENCES recipes(id),
        commodity_id UUID NOT NULL REFERENCES commodities(id),
        season_id UUID NOT NULL REFERENCES seasons(id),
        status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
        base_yield INT NOT NULL,
        final_yield INT NOT NULL,
        units_produced INT NOT NULL DEFAULT 0,
        increment_interval_minutes INT NOT NULL,
        effective_production_time_minutes INT NOT NULL,
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        paused_at TIMESTAMPTZ,
        completes_at TIMESTAMPTZ NOT NULL,
        completed_at TIMESTAMPTZ,
        pause_reason VARCHAR(50),
        input_snapshot JSONB,
        yield_modifiers JSONB NOT NULL DEFAULT '{}'
      )
    `);

    await queryRunner.query(`CREATE INDEX idx_production_jobs_player ON production_jobs(player_id, season_id)`);
    await queryRunner.query(`CREATE INDEX idx_production_jobs_factory ON production_jobs(factory_id)`);
    await queryRunner.query(`CREATE INDEX idx_production_jobs_status ON production_jobs(status)`);

    // ============================================================
    // INVENTORY
    // ============================================================

    await queryRunner.query(`
      CREATE TABLE inventory (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        player_id UUID NOT NULL REFERENCES players(id),
        season_id UUID NOT NULL REFERENCES seasons(id),
        commodity_id UUID NOT NULL REFERENCES commodities(id),
        quantity INT NOT NULL DEFAULT 0 CHECK (quantity >= 0),
        UNIQUE(player_id, season_id, commodity_id)
      )
    `);

    await queryRunner.query(`CREATE INDEX idx_inventory_player_season ON inventory(player_id, season_id)`);

    // ============================================================
    // MARKETPLACE
    // ============================================================

    await queryRunner.query(`
      CREATE TABLE market_listings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        player_id UUID NOT NULL REFERENCES players(id),
        season_id UUID NOT NULL REFERENCES seasons(id),
        commodity_id UUID NOT NULL REFERENCES commodities(id),
        quantity INT NOT NULL CHECK (quantity > 0),
        remaining_quantity INT NOT NULL CHECK (remaining_quantity >= 0),
        listed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
        filled_at TIMESTAMPTZ,
        cancelled_at TIMESTAMPTZ
      )
    `);

    await queryRunner.query(`CREATE INDEX idx_market_listings_commodity_fifo ON market_listings(commodity_id, season_id, listed_at) WHERE status = 'ACTIVE'`);
    await queryRunner.query(`CREATE INDEX idx_market_listings_player ON market_listings(player_id, season_id)`);

    await queryRunner.query(`
      CREATE TABLE market_trades (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        season_id UUID NOT NULL REFERENCES seasons(id),
        listing_id UUID NOT NULL REFERENCES market_listings(id),
        buyer_id UUID NOT NULL REFERENCES players(id),
        seller_id UUID NOT NULL REFERENCES players(id),
        commodity_id UUID NOT NULL REFERENCES commodities(id),
        quantity INT NOT NULL,
        price_per_unit DECIMAL(10, 2) NOT NULL,
        total_price DECIMAL(15, 2) NOT NULL,
        traded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`CREATE INDEX idx_market_trades_season_commodity ON market_trades(season_id, commodity_id)`);

    // ============================================================
    // PRICING
    // ============================================================

    await queryRunner.query(`
      CREATE TABLE commodity_prices (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        season_id UUID NOT NULL REFERENCES seasons(id),
        commodity_id UUID NOT NULL REFERENCES commodities(id),
        price DECIMAL(10, 2) NOT NULL,
        supply_multiplier DECIMAL(8, 4) NOT NULL DEFAULT 1.0000,
        demand_multiplier DECIMAL(8, 4) NOT NULL DEFAULT 1.0000,
        supply_metric DECIMAL(15, 2),
        demand_metric DECIMAL(15, 2),
        trade_volume INT NOT NULL DEFAULT 0,
        recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`CREATE INDEX idx_commodity_prices_lookup ON commodity_prices(season_id, commodity_id, recorded_at DESC)`);

    await queryRunner.query(`
      CREATE TABLE current_prices (
        season_id UUID NOT NULL REFERENCES seasons(id),
        commodity_id UUID NOT NULL REFERENCES commodities(id),
        price DECIMAL(10, 2) NOT NULL,
        supply_multiplier DECIMAL(8, 4) NOT NULL DEFAULT 1.0000,
        demand_multiplier DECIMAL(8, 4) NOT NULL DEFAULT 1.0000,
        last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (season_id, commodity_id)
      )
    `);

    // ============================================================
    // BANK & LOANS
    // ============================================================

    await queryRunner.query(`
      CREATE TABLE loans (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        player_id UUID NOT NULL REFERENCES players(id),
        season_id UUID NOT NULL REFERENCES seasons(id),
        principal DECIMAL(15, 2) NOT NULL,
        outstanding_balance DECIMAL(15, 2) NOT NULL,
        interest_rate DECIMAL(5, 4) NOT NULL DEFAULT 0.0500,
        installment_interval_days INT NOT NULL DEFAULT 5,
        max_duration_days INT NOT NULL DEFAULT 20,
        status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
        next_installment_at TIMESTAMPTZ NOT NULL,
        disbursed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        paid_at TIMESTAMPTZ,
        late_payment_count INT NOT NULL DEFAULT 0
      )
    `);

    await queryRunner.query(`CREATE INDEX idx_loans_player_season ON loans(player_id, season_id)`);
    await queryRunner.query(`CREATE INDEX idx_loans_next_installment ON loans(next_installment_at) WHERE status = 'ACTIVE'`);

    await queryRunner.query(`
      CREATE TABLE loan_payments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        loan_id UUID NOT NULL REFERENCES loans(id),
        amount DECIMAL(15, 2) NOT NULL,
        principal_portion DECIMAL(15, 2) NOT NULL,
        interest_portion DECIMAL(15, 2) NOT NULL,
        penalty_amount DECIMAL(15, 2) NOT NULL DEFAULT 0,
        payment_type VARCHAR(20) NOT NULL,
        paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // ============================================================
    // SHOPS
    // ============================================================

    await queryRunner.query(`
      CREATE TABLE shops (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        player_id UUID NOT NULL REFERENCES players(id),
        season_id UUID NOT NULL REFERENCES seasons(id),
        tile_id UUID NOT NULL REFERENCES map_tiles(id),
        shop_type VARCHAR(50) NOT NULL,
        level INT NOT NULL DEFAULT 1,
        storage_capacity INT NOT NULL,
        demand_rate DECIMAL(10, 2) NOT NULL,
        constructed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE shop_inventory (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        shop_id UUID NOT NULL REFERENCES shops(id),
        commodity_id UUID NOT NULL REFERENCES commodities(id),
        quantity INT NOT NULL DEFAULT 0 CHECK (quantity >= 0),
        UNIQUE(shop_id, commodity_id)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE shop_accepted_commodities (
        shop_type VARCHAR(50) NOT NULL,
        commodity_id UUID NOT NULL REFERENCES commodities(id),
        min_types_required INT NOT NULL DEFAULT 1,
        PRIMARY KEY (shop_type, commodity_id)
      )
    `);

    // ============================================================
    // EVENTS
    // ============================================================

    await queryRunner.query(`
      CREATE TABLE game_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        season_id UUID NOT NULL REFERENCES seasons(id),
        event_type VARCHAR(50) NOT NULL,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        starts_at TIMESTAMPTZ NOT NULL,
        ends_at TIMESTAMPTZ NOT NULL,
        affected_categories TEXT[] NOT NULL DEFAULT '{}',
        production_modifier DECIMAL(5, 2) DEFAULT 0,
        demand_modifier DECIMAL(5, 2) DEFAULT 0,
        price_modifier DECIMAL(5, 2) DEFAULT 0,
        status VARCHAR(20) NOT NULL DEFAULT 'SCHEDULED',
        metadata JSONB NOT NULL DEFAULT '{}'
      )
    `);

    await queryRunner.query(`CREATE INDEX idx_game_events_season_status ON game_events(season_id, status)`);

    // ============================================================
    // WALLET LEDGER
    // ============================================================

    await queryRunner.query(`
      CREATE TABLE wallet_transactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        player_id UUID NOT NULL REFERENCES players(id),
        season_id UUID NOT NULL REFERENCES seasons(id),
        transaction_type VARCHAR(50) NOT NULL,
        amount DECIMAL(15, 2) NOT NULL,
        balance_after DECIMAL(15, 2) NOT NULL,
        reference_type VARCHAR(50),
        reference_id UUID,
        description TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`CREATE INDEX idx_wallet_transactions_player_season ON wallet_transactions(player_id, season_id, created_at DESC)`);

    // ============================================================
    // NOTIFICATIONS
    // ============================================================

    await queryRunner.query(`
      CREATE TABLE notifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        player_id UUID NOT NULL REFERENCES players(id),
        season_id UUID NOT NULL REFERENCES seasons(id),
        type VARCHAR(50) NOT NULL,
        title VARCHAR(200) NOT NULL,
        body TEXT,
        priority VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
        read BOOLEAN NOT NULL DEFAULT FALSE,
        delivered BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`CREATE INDEX idx_notifications_player_unread ON notifications(player_id, season_id, created_at DESC) WHERE read = FALSE`);

    // ============================================================
    // SIMULATION (Admin)
    // ============================================================

    await queryRunner.query(`
      CREATE TABLE simulation_runs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        operator_id UUID NOT NULL REFERENCES players(id),
        input_parameters JSONB NOT NULL,
        output_results JSONB,
        simulated_days INT NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'RUNNING',
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      )
    `);

    // ============================================================
    // CONFIGURATION
    // ============================================================

    await queryRunner.query(`
      CREATE TABLE game_config (
        key VARCHAR(100) PRIMARY KEY,
        value JSONB NOT NULL,
        description TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_by UUID REFERENCES players(id)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS game_config CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS simulation_runs CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS notifications CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS wallet_transactions CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS game_events CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS shop_accepted_commodities CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS shop_inventory CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS shops CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS loan_payments CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS loans CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS current_prices CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS commodity_prices CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS market_trades CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS market_listings CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS inventory CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS production_jobs CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS worker_assignments CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS worker_profiles CASCADE`);
    await queryRunner.query(`ALTER TABLE map_tiles DROP CONSTRAINT IF EXISTS fk_map_tiles_factory`);
    await queryRunner.query(`DROP TABLE IF EXISTS factories CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS recipe_inputs CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS recipes CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS commodities CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS map_tiles CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS player_seasons CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS players CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS seasons CASCADE`);
  }
}
