import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToMany,
} from 'typeorm';
import { SeasonStatus } from '@sea-commodity-tycoon/shared-types';
import { PlayerSeason } from './player-season.entity';
import { MapTile } from './map-tile.entity';
import { GameEvent } from './game-event.entity';

@Entity('seasons')
export class Season {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'starts_at', type: 'timestamptz' })
  startsAt!: Date;

  @Column({ name: 'ends_at', type: 'timestamptz' })
  endsAt!: Date;

  @Column({
    type: 'varchar',
    length: 20,
    default: SeasonStatus.PENDING,
  })
  status!: SeasonStatus;

  @Column({ type: 'jsonb', default: '{}' })
  configuration!: Record<string, unknown>;

  @Column({ name: 'map_seed', type: 'bigint' })
  mapSeed!: string;

  @Column({ type: 'jsonb', nullable: true })
  summary!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @OneToMany(() => PlayerSeason, (ps) => ps.season)
  playerSeasons!: PlayerSeason[];

  @OneToMany(() => MapTile, (tile) => tile.season)
  mapTiles!: MapTile[];

  @OneToMany(() => GameEvent, (event) => event.season)
  gameEvents!: GameEvent[];
}
