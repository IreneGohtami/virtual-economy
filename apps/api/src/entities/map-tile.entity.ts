import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Unique,
  Index,
} from 'typeorm';
import { Player } from './player.entity';
import { Season } from './season.entity';

@Entity('map_tiles')
@Unique(['seasonId', 'x', 'y'])
@Index('idx_map_tiles_season_owner', ['seasonId', 'ownerPlayerId'])
@Index('idx_map_tiles_season_terrain', ['seasonId', 'terrainType'])
@Index('idx_map_tiles_factory', ['factoryId'])
export class MapTile {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'season_id', type: 'uuid' })
  seasonId!: string;

  @Column({ type: 'int' })
  x!: number;

  @Column({ type: 'int' })
  y!: number;

  @Column({ name: 'terrain_type', type: 'varchar', length: 20 })
  terrainType!: string;

  @Column({ name: 'owner_player_id', type: 'uuid', nullable: true })
  ownerPlayerId!: string | null;

  @Column({ name: 'factory_id', type: 'uuid', nullable: true })
  factoryId!: string | null;

  @Column({ name: 'purchased_at', type: 'timestamptz', nullable: true })
  purchasedAt!: Date | null;

  @Column({ name: 'purchase_price', type: 'decimal', precision: 10, scale: 2, nullable: true })
  purchasePrice!: string | null;

  @ManyToOne(() => Season, (season) => season.mapTiles)
  @JoinColumn({ name: 'season_id' })
  season!: Season;

  @ManyToOne(() => Player, { nullable: true })
  @JoinColumn({ name: 'owner_player_id' })
  ownerPlayer!: Player | null;
}
