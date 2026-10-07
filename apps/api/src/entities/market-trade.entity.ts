import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Season } from './season.entity';
import { MarketListing } from './market-listing.entity';
import { Player } from './player.entity';
import { Commodity } from './commodity.entity';

@Entity('market_trades')
@Index('idx_market_trades_season_commodity', ['seasonId', 'commodityId'])
export class MarketTrade {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'season_id', type: 'uuid' })
  seasonId!: string;

  @Column({ name: 'listing_id', type: 'uuid' })
  listingId!: string;

  @Column({ name: 'buyer_id', type: 'uuid' })
  buyerId!: string;

  @Column({ name: 'seller_id', type: 'uuid' })
  sellerId!: string;

  @Column({ name: 'commodity_id', type: 'uuid' })
  commodityId!: string;

  @Column({ type: 'int' })
  quantity!: number;

  @Column({ name: 'price_per_unit', type: 'decimal', precision: 10, scale: 2 })
  pricePerUnit!: string;

  @Column({ name: 'total_price', type: 'decimal', precision: 15, scale: 2 })
  totalPrice!: string;

  @Column({ name: 'traded_at', type: 'timestamptz', default: () => 'NOW()' })
  tradedAt!: Date;

  @ManyToOne(() => Season)
  @JoinColumn({ name: 'season_id' })
  season!: Season;

  @ManyToOne(() => MarketListing)
  @JoinColumn({ name: 'listing_id' })
  listing!: MarketListing;

  @ManyToOne(() => Player)
  @JoinColumn({ name: 'buyer_id' })
  buyer!: Player;

  @ManyToOne(() => Player)
  @JoinColumn({ name: 'seller_id' })
  seller!: Player;

  @ManyToOne(() => Commodity)
  @JoinColumn({ name: 'commodity_id' })
  commodity!: Commodity;
}
