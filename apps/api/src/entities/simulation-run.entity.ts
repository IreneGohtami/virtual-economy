import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Player } from './player.entity';

@Entity('simulation_runs')
export class SimulationRun {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'operator_id', type: 'uuid' })
  operatorId!: string;

  @Column({ name: 'input_parameters', type: 'jsonb' })
  inputParameters!: Record<string, unknown>;

  @Column({ name: 'output_results', type: 'jsonb', nullable: true })
  outputResults!: Record<string, unknown> | null;

  @Column({ name: 'simulated_days', type: 'int' })
  simulatedDays!: number;

  @Column({ type: 'varchar', length: 20, default: 'RUNNING' })
  status!: string;

  @Column({ name: 'started_at', type: 'timestamptz', default: () => 'NOW()' })
  startedAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @ManyToOne(() => Player)
  @JoinColumn({ name: 'operator_id' })
  operator!: Player;
}
