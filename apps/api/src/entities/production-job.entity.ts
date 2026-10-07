import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ProductionJobStatus } from '@sea-commodity-tycoon/shared-types';
import { Player } from './player.entity';
import { Factory } from './factory.entity';
import { Recipe } from './recipe.entity';
import { Commodity } from './commodity.entity';
import { Season } from './season.entity';

@Entity('production_jobs')
@Index('idx_production_jobs_player', ['playerId', 'seasonId'])
@Index('idx_production_jobs_factory', ['factoryId'])
@Index('idx_production_jobs_status', ['status'])
export class ProductionJob {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'player_id', type: 'uuid' })
  playerId!: string;

  @Column({ name: 'factory_id', type: 'uuid' })
  factoryId!: string;

  @Column({ name: 'recipe_id', type: 'uuid', nullable: true })
  recipeId!: string | null;

  @Column({ name: 'commodity_id', type: 'uuid' })
  commodityId!: string;

  @Column({ name: 'season_id', type: 'uuid' })
  seasonId!: string;

  @Column({
    type: 'varchar',
    length: 20,
    default: ProductionJobStatus.ACTIVE,
  })
  status!: ProductionJobStatus;

  @Column({ name: 'base_yield', type: 'int' })
  baseYield!: number;

  @Column({ name: 'final_yield', type: 'int' })
  finalYield!: number;

  @Column({ name: 'units_produced', type: 'int', default: 0 })
  unitsProduced!: number;

  @Column({ name: 'increment_interval_minutes', type: 'int' })
  incrementIntervalMinutes!: number;

  @Column({ name: 'effective_production_time_minutes', type: 'int' })
  effectiveProductionTimeMinutes!: number;

  @Column({ name: 'started_at', type: 'timestamptz', default: () => 'NOW()' })
  startedAt!: Date;

  @Column({ name: 'paused_at', type: 'timestamptz', nullable: true })
  pausedAt!: Date | null;

  @Column({ name: 'completes_at', type: 'timestamptz' })
  completesAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @Column({ name: 'pause_reason', type: 'varchar', length: 50, nullable: true })
  pauseReason!: string | null;

  @Column({ name: 'input_snapshot', type: 'jsonb', nullable: true })
  inputSnapshot!: Record<string, unknown> | null;

  @Column({ name: 'yield_modifiers', type: 'jsonb', default: '{}' })
  yieldModifiers!: Record<string, unknown>;

  @ManyToOne(() => Player)
  @JoinColumn({ name: 'player_id' })
  player!: Player;

  @ManyToOne(() => Factory, (factory) => factory.productionJobs)
  @JoinColumn({ name: 'factory_id' })
  factory!: Factory;

  @ManyToOne(() => Recipe, { nullable: true })
  @JoinColumn({ name: 'recipe_id' })
  recipe!: Recipe | null;

  @ManyToOne(() => Commodity)
  @JoinColumn({ name: 'commodity_id' })
  commodity!: Commodity;

  @ManyToOne(() => Season)
  @JoinColumn({ name: 'season_id' })
  season!: Season;
}
