import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Unique,
  Index,
  Check,
} from 'typeorm';
import { Player } from './player.entity';
import { Season } from './season.entity';
import { Commodity } from './commodity.entity';

@Entity('inventory')
@Unique(['playerId', 'seasonId', 'commodityId'])
@Index('idx_inventory_player_season', ['playerId', 'seasonId'])
@Check('"quantity" >= 0')
export class Inventory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'player_id', type: 'uuid' })
  playerId!: string;

  @Column({ name: 'season_id', type: 'uuid' })
  seasonId!: string;

  @Column({ name: 'commodity_id', type: 'uuid' })
  commodityId!: string;

  @Column({ type: 'int', default: 0 })
  quantity!: number;

  @ManyToOne(() => Player, (player) => player.inventories)
  @JoinColumn({ name: 'player_id' })
  player!: Player;

  @ManyToOne(() => Season)
  @JoinColumn({ name: 'season_id' })
  season!: Season;

  @ManyToOne(() => Commodity)
  @JoinColumn({ name: 'commodity_id' })
  commodity!: Commodity;
}
