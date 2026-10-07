import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
  Index,
} from 'typeorm';
import { Player } from './player.entity';
import { Season } from './season.entity';

@Entity('player_seasons')
@Unique(['playerId', 'seasonId'])
@Index('idx_player_seasons_player', ['playerId'])
@Index('idx_player_seasons_season', ['seasonId'])
export class PlayerSeason {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'player_id', type: 'uuid' })
  playerId!: string;

  @Column({ name: 'season_id', type: 'uuid' })
  seasonId!: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  specialty!: string | null;

  @Column({ type: 'decimal', precision: 15, scale: 2, default: 1000.0 })
  coins!: string;

  @Column({ name: 'storage_capacity', type: 'int', default: 500 })
  storageCapacity!: number;

  @Column({ name: 'workforce_happiness', type: 'decimal', precision: 5, scale: 2, default: 80.0 })
  workforceHappiness!: string;

  @Column({ name: 'last_happiness_decay_at', type: 'timestamptz', nullable: true })
  lastHappinessDecayAt!: Date | null;

  @Column({ name: 'inactivity_reminder_sent', type: 'boolean', default: false })
  inactivityReminderSent!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne(() => Player, (player) => player.playerSeasons)
  @JoinColumn({ name: 'player_id' })
  player!: Player;

  @ManyToOne(() => Season, (season) => season.playerSeasons)
  @JoinColumn({ name: 'season_id' })
  season!: Season;
}
