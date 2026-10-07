import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Unique,
  Check,
} from 'typeorm';
import { Shop } from './shop.entity';
import { Commodity } from './commodity.entity';

@Entity('shop_inventory')
@Unique(['shopId', 'commodityId'])
@Check('"quantity" >= 0')
export class ShopInventory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'shop_id', type: 'uuid' })
  shopId!: string;

  @Column({ name: 'commodity_id', type: 'uuid' })
  commodityId!: string;

  @Column({ type: 'int', default: 0 })
  quantity!: number;

  @ManyToOne(() => Shop, (shop) => shop.shopInventories)
  @JoinColumn({ name: 'shop_id' })
  shop!: Shop;

  @ManyToOne(() => Commodity)
  @JoinColumn({ name: 'commodity_id' })
  commodity!: Commodity;
}
