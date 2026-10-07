import {
  Entity,
  Column,
  ManyToOne,
  JoinColumn,
  PrimaryColumn,
} from 'typeorm';
import { Commodity } from './commodity.entity';

@Entity('shop_accepted_commodities')
export class ShopAcceptedCommodity {
  @PrimaryColumn({ name: 'shop_type', type: 'varchar', length: 50 })
  shopType!: string;

  @PrimaryColumn({ name: 'commodity_id', type: 'uuid' })
  commodityId!: string;

  @Column({ name: 'min_types_required', type: 'int', default: 1 })
  minTypesRequired!: number;

  @ManyToOne(() => Commodity)
  @JoinColumn({ name: 'commodity_id' })
  commodity!: Commodity;
}
