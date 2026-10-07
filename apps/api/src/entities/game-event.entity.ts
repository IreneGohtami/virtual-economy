import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Season } from './season.entity';

@Entity('game_events')
@Index('idx_game_events_season_status', ['seasonId', 'status'])
export class GameEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'season_id', type: 'uuid' })
  seasonId!: string;

  @Column({ name: 'event_type', type: 'varchar', length: 50 })
  eventType!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'starts_at', type: 'timestamptz' })
  startsAt!: Date;

  @Column({ name: 'ends_at', type: 'timestamptz' })
  endsAt!: Date;

  @Column({ name: 'affected_categories', type: 'text', array: true, default: '{}' })
  affectedCategories!: string[];

  @Column({ name: 'production_modifier', type: 'decimal', precision: 5, scale: 2, nullable: true, default: 0 })
  productionModifier!: string | null;

  @Column({ name: 'demand_modifier', type: 'decimal', precision: 5, scale: 2, nullable: true, default: 0 })
  demandModifier!: string | null;

  @Column({ name: 'price_modifier', type: 'decimal', precision: 5, scale: 2, nullable: true, default: 0 })
  priceModifier!: string | null;

  @Column({
    type: 'varchar',
    length: 20,
    default: 'SCHEDULED',
  })
  status!: string;

  @Column({ type: 'jsonb', default: '{}' })
  metadata!: Record<string, unknown>;

  @ManyToOne(() => Season, (season) => season.gameEvents)
  @JoinColumn({ name: 'season_id' })
  season!: Season;
}
