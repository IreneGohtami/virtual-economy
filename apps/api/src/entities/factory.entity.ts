import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { FactoryStatus } from '@sea-commodity-tycoon/shared-types';
import { Player } from './player.entity';
import { Season } from './season.entity';
import { Commodity } from './commodity.entity';
import { Recipe } from './recipe.entity';
import { WorkerAssignment } from './worker-assignment.entity';
import { ProductionJob } from './production-job.entity';

@Entity('factories')
@Index('idx_factories_player_season', ['playerId', 'seasonId'])
export class Factory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'player_id', type: 'uuid' })
  playerId!: string;

  @Column({ name: 'season_id', type: 'uuid' })
  seasonId!: string;

  @Column({ type: 'varchar', length: 100, default: 'Factory' })
  name!: string;

  @Column({ name: 'commodity_id', type: 'uuid', nullable: true })
  commodityId!: string | null;

  @Column({ name: 'recipe_id', type: 'uuid', nullable: true })
  recipeId!: string | null;

  @Column({ type: 'varchar', length: 50 })
  category!: string;

  @Column({ name: 'factory_level', type: 'int', default: 0 })
  factoryLevel!: number;

  @Column({
    type: 'varchar',
    length: 20,
    default: FactoryStatus.IDLE,
  })
  status!: FactoryStatus;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 100.0 })
  efficiency!: string;

  @Column({ name: 'maintenance_count', type: 'int', default: 0 })
  maintenanceCount!: number;

  @Column({ name: 'setup_cost', type: 'decimal', precision: 10, scale: 2 })
  setupCost!: string;

  @Column({ name: 'last_depreciation_at', type: 'timestamptz', nullable: true })
  lastDepreciationAt!: Date | null;

  @Column({ name: 'fertilizer_boost_active', type: 'boolean', default: false })
  fertilizerBoostActive!: boolean;

  @Column({ name: 'fertilizer_boost_expires_at', type: 'timestamptz', nullable: true })
  fertilizerBoostExpiresAt!: Date | null;

  @Column({ name: 'exclusive_output_slug', type: 'varchar', length: 100, nullable: true })
  exclusiveOutputSlug!: string | null;

  @Column({ name: 'output_switch_cooldown_until', type: 'timestamptz', nullable: true })
  outputSwitchCooldownUntil!: Date | null;

  @Column({ name: 'constructed_at', type: 'timestamptz', default: () => 'NOW()' })
  constructedAt!: Date;

  @Column({ name: 'is_shop', type: 'boolean', default: false })
  isShop!: boolean;

  @ManyToOne(() => Player, (player) => player.factories)
  @JoinColumn({ name: 'player_id' })
  player!: Player;

  @ManyToOne(() => Season)
  @JoinColumn({ name: 'season_id' })
  season!: Season;

  @ManyToOne(() => Commodity, { nullable: true })
  @JoinColumn({ name: 'commodity_id' })
  commodity!: Commodity | null;

  @ManyToOne(() => Recipe, { nullable: true })
  @JoinColumn({ name: 'recipe_id' })
  recipe!: Recipe | null;

  @OneToMany(() => WorkerAssignment, (wa) => wa.factory)
  workerAssignments!: WorkerAssignment[];

  @OneToMany(() => ProductionJob, (pj) => pj.factory)
  productionJobs!: ProductionJob[];
}
