import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
  Check,
} from 'typeorm';
import { ListingStatus } from '@sea-commodity-tycoon/shared-types';
import { Player } from './player.entity';
import { Season } from './season.entity';
import { Commodity } from './commodity.entity';

@Entity('market_listings')
@Index('idx_market_listings_commodity_fifo', ['commodityId', 'seasonId', 'listedAt'])
@Index('idx_market_listings_player', ['playerId', 'seasonId'])
@Check('"quantity" > 0')
@Check('"remaining_quantity" >= 0')
export class MarketListing {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'player_id', type: 'uuid' })
  playerId!: string;

  @Column({ name: 'season_id', type: 'uuid' })
  seasonId!: string;

  @Column({ name: 'commodity_id', type: 'uuid' })
  commodityId!: string;

  @Column({ type: 'int' })
  quantity!: number;

  @Column({ name: 'remaining_quantity', type: 'int' })
  remainingQuantity!: number;

  @Column({ name: 'listed_at', type: 'timestamptz', default: () => 'NOW()' })
  listedAt!: Date;

  @Column({
    type: 'varchar',
    length: 20,
    default: ListingStatus.ACTIVE,
  })
  status!: ListingStatus;

  @Column({ name: 'filled_at', type: 'timestamptz', nullable: true })
  filledAt!: Date | null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt!: Date | null;

  @ManyToOne(() => Player, (player) => player.marketListings)
  @JoinColumn({ name: 'player_id' })
  player!: Player;

  @ManyToOne(() => Season)
  @JoinColumn({ name: 'season_id' })
  season!: Season;

  @ManyToOne(() => Commodity)
  @JoinColumn({ name: 'commodity_id' })
  commodity!: Commodity;
}
