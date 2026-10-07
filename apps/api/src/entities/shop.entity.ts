import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { ShopType } from '@sea-commodity-tycoon/shared-types';
import { Player } from './player.entity';
import { Season } from './season.entity';
import { MapTile } from './map-tile.entity';
import { ShopInventory } from './shop-inventory.entity';

@Entity('shops')
export class Shop {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'player_id', type: 'uuid' })
  playerId!: string;

  @Column({ name: 'season_id', type: 'uuid' })
  seasonId!: string;

  @Column({ name: 'tile_id', type: 'uuid' })
  tileId!: string;

  @Column({ name: 'shop_type', type: 'varchar', length: 50 })
  shopType!: ShopType;

  @Column({ type: 'int', default: 1 })
  level!: number;

  @Column({ name: 'storage_capacity', type: 'int' })
  storageCapacity!: number;

  @Column({ name: 'demand_rate', type: 'decimal', precision: 10, scale: 2 })
  demandRate!: string;

  @Column({ name: 'constructed_at', type: 'timestamptz', default: () => 'NOW()' })
  constructedAt!: Date;

  @ManyToOne(() => Player, (player) => player.shops)
  @JoinColumn({ name: 'player_id' })
  player!: Player;

  @ManyToOne(() => Season)
  @JoinColumn({ name: 'season_id' })
  season!: Season;

  @ManyToOne(() => MapTile)
  @JoinColumn({ name: 'tile_id' })
  tile!: MapTile;

  @OneToMany(() => ShopInventory, (si) => si.shop)
  shopInventories!: ShopInventory[];
}
