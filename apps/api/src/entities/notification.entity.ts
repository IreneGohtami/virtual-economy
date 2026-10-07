import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Player } from './player.entity';
import { Season } from './season.entity';

@Entity('notifications')
@Index('idx_notifications_player_unread', ['playerId', 'seasonId', 'createdAt'])
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'player_id', type: 'uuid' })
  playerId!: string;

  @Column({ name: 'season_id', type: 'uuid' })
  seasonId!: string;

  @Column({ type: 'varchar', length: 50 })
  type!: string;

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  body!: string | null;

  @Column({ type: 'varchar', length: 20, default: 'NORMAL' })
  priority!: string;

  @Column({ type: 'boolean', default: false })
  read!: boolean;

  @Column({ type: 'boolean', default: false })
  delivered!: boolean;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'NOW()' })
  createdAt!: Date;

  @ManyToOne(() => Player, (player) => player.notifications)
  @JoinColumn({ name: 'player_id' })
  player!: Player;

  @ManyToOne(() => Season)
  @JoinColumn({ name: 'season_id' })
  season!: Season;
}
