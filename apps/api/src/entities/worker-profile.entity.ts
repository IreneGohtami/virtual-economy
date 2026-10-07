import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { Season } from './season.entity';
import { WorkerAssignment } from './worker-assignment.entity';

@Entity('worker_profiles')
export class WorkerProfile {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'int' })
  age!: number;

  @Column({ type: 'varchar', length: 10 })
  gender!: string;

  @Column({ type: 'varchar', length: 50 })
  specialty!: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  salary!: string;

  @Column({ name: 'experience_level', type: 'int' })
  experienceLevel!: number;

  @Column({ name: 'commitment_level', type: 'decimal', precision: 5, scale: 2 })
  commitmentLevel!: string;

  @Column({ name: 'season_id', type: 'uuid' })
  seasonId!: string;

  @Column({ type: 'boolean', default: false })
  unlocked!: boolean;

  @ManyToOne(() => Season)
  @JoinColumn({ name: 'season_id' })
  season!: Season;

  @OneToMany(() => WorkerAssignment, (wa) => wa.workerProfile)
  assignments!: WorkerAssignment[];
}
