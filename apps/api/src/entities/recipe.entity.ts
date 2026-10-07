import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { Commodity } from './commodity.entity';
import { RecipeInput } from './recipe-input.entity';

@Entity('recipes')
export class Recipe {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'varchar', length: 100, unique: true })
  slug!: string;

  @Column({ name: 'processing_time_minutes', type: 'int' })
  processingTimeMinutes!: number;

  @Column({ name: 'worker_requirement', type: 'int', default: 1 })
  workerRequirement!: number;

  @Column({ name: 'output_commodity_id', type: 'uuid' })
  outputCommodityId!: string;

  @Column({ name: 'output_quantity', type: 'int', default: 1 })
  outputQuantity!: number;

  @Column({ name: 'factory_category', type: 'varchar', length: 50 })
  factoryCategory!: string;

  @Column({ type: 'jsonb', default: '{}' })
  metadata!: Record<string, unknown>;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @ManyToOne(() => Commodity)
  @JoinColumn({ name: 'output_commodity_id' })
  outputCommodity!: Commodity;

  @OneToMany(() => RecipeInput, (ri) => ri.recipe)
  inputs!: RecipeInput[];
}
