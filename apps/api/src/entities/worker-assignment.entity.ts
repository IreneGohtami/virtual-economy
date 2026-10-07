import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { WorkerStatus } from '@sea-commodity-tycoon/shared-types';
import { WorkerProfile } from './worker-profile.entity';
import { Player } from './player.entity';
import { Factory } from './factory.entity';
import { Season } from './season.entity';

@Entity('worker_assignments')
@Index('idx_worker_assignments_player', ['playerId', 'seasonId'])
@Index('idx_worker_assignments_factory', ['factoryId'])
export class WorkerAssignment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'worker_id', type: 'uuid' })
  workerId!: string;

  @Column({ name: 'player_id', type: 'uuid' })
  playerId!: string;

  @Column({ name: 'factory_id', type: 'uuid', nullable: true })
  factoryId!: string | null;

  @Column({ name: 'season_id', type: 'uuid' })
  seasonId!: string;

  @Column({
    type: 'varchar',
    length: 20,
    default: WorkerStatus.WORKING,
  })
  status!: WorkerStatus;

  @Column({ name: 'hired_at', type: 'timestamptz', default: () => 'NOW()' })
  hiredAt!: Date;

  @Column({ name: 'status_changed_at', type: 'timestamptz', nullable: true })
  statusChangedAt!: Date | null;

  @Column({ name: 'disruption_ends_at', type: 'timestamptz', nullable: true })
  disruptionEndsAt!: Date | null;

  @ManyToOne(() => WorkerProfile, (wp) => wp.assignments)
  @JoinColumn({ name: 'worker_id' })
  workerProfile!: WorkerProfile;

  @ManyToOne(() => Player, (player) => player.workerAssignments)
  @JoinColumn({ name: 'player_id' })
  player!: Player;

  @ManyToOne(() => Factory, (factory) => factory.workerAssignments, { nullable: true })
  @JoinColumn({ name: 'factory_id' })
  factory!: Factory | null;

  @ManyToOne(() => Season)
  @JoinColumn({ name: 'season_id' })
  season!: Season;
}
