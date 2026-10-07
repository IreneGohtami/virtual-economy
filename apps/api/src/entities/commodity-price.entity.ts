import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Season } from './season.entity';
import { Commodity } from './commodity.entity';

@Entity('commodity_prices')
@Index('idx_commodity_prices_lookup', ['seasonId', 'commodityId', 'recordedAt'])
export class CommodityPrice {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'season_id', type: 'uuid' })
  seasonId!: string;

  @Column({ name: 'commodity_id', type: 'uuid' })
  commodityId!: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  price!: string;

  @Column({ name: 'supply_multiplier', type: 'decimal', precision: 8, scale: 4, default: 1.0 })
  supplyMultiplier!: string;

  @Column({ name: 'demand_multiplier', type: 'decimal', precision: 8, scale: 4, default: 1.0 })
  demandMultiplier!: string;

  @Column({ name: 'supply_metric', type: 'decimal', precision: 15, scale: 2, nullable: true })
  supplyMetric!: string | null;

  @Column({ name: 'demand_metric', type: 'decimal', precision: 15, scale: 2, nullable: true })
  demandMetric!: string | null;

  @Column({ name: 'trade_volume', type: 'int', default: 0 })
  tradeVolume!: number;

  @Column({ name: 'recorded_at', type: 'timestamptz', default: () => 'NOW()' })
  recordedAt!: Date;

  @ManyToOne(() => Season)
  @JoinColumn({ name: 'season_id' })
  season!: Season;

  @ManyToOne(() => Commodity)
  @JoinColumn({ name: 'commodity_id' })
  commodity!: Commodity;
}
