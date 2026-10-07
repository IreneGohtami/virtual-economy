import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
} from 'typeorm';
import { RecipeInput } from './recipe-input.entity';

@Entity('commodities')
export class Commodity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'varchar', length: 100, unique: true })
  slug!: string;

  @Column({ type: 'varchar', length: 50 })
  category!: string;

  @Column({ type: 'int', default: 0 })
  level!: number;

  @Column({ name: 'base_price', type: 'decimal', precision: 10, scale: 2 })
  basePrice!: string;

  @Column({ name: 'base_production_time_minutes', type: 'int' })
  baseProductionTimeMinutes!: number;

  @Column({ name: 'base_yield', type: 'int' })
  baseYield!: number;

  @Column({ name: 'storage_size', type: 'int', default: 1 })
  storageSize!: number;

  @Column({ name: 'max_workers', type: 'int', default: 2 })
  maxWorkers!: number;

  @Column({ name: 'terrain_requirement', type: 'varchar', length: 20, nullable: true })
  terrainRequirement!: string | null;

  @Column({ name: 'land_layout', type: 'varchar', length: 10, nullable: true })
  landLayout!: string | null;

  @Column({ name: 'setup_cost', type: 'decimal', precision: 10, scale: 2, nullable: true })
  setupCost!: string | null;

  @Column({ type: 'jsonb', default: '{}' })
  metadata!: Record<string, unknown>;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @OneToMany(() => RecipeInput, (ri) => ri.commodity)
  recipeInputs!: RecipeInput[];
}
