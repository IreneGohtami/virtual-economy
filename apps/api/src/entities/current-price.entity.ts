import {
  Entity,
  Column,
  ManyToOne,
  JoinColumn,
  PrimaryColumn,
} from 'typeorm';
import { Season } from './season.entity';
import { Commodity } from './commodity.entity';

@Entity('current_prices')
export class CurrentPrice {
  @PrimaryColumn({ name: 'season_id', type: 'uuid' })
  seasonId!: string;

  @PrimaryColumn({ name: 'commodity_id', type: 'uuid' })
  commodityId!: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  price!: string;

  @Column({ name: 'supply_multiplier', type: 'decimal', precision: 8, scale: 4, default: 1.0 })
  supplyMultiplier!: string;

  @Column({ name: 'demand_multiplier', type: 'decimal', precision: 8, scale: 4, default: 1.0 })
  demandMultiplier!: string;

  @Column({ name: 'last_updated_at', type: 'timestamptz', default: () => 'NOW()' })
  lastUpdatedAt!: Date;

  @ManyToOne(() => Season)
  @JoinColumn({ name: 'season_id' })
  season!: Season;

  @ManyToOne(() => Commodity)
  @JoinColumn({ name: 'commodity_id' })
  commodity!: Commodity;
}
