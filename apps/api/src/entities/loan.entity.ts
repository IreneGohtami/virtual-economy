import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { LoanStatus } from '@sea-commodity-tycoon/shared-types';
import { Player } from './player.entity';
import { Season } from './season.entity';
import { LoanPayment } from './loan-payment.entity';

@Entity('loans')
@Index('idx_loans_player_season', ['playerId', 'seasonId'])
@Index('idx_loans_next_installment', ['nextInstallmentAt'])
export class Loan {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'player_id', type: 'uuid' })
  playerId!: string;

  @Column({ name: 'season_id', type: 'uuid' })
  seasonId!: string;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  principal!: string;

  @Column({ name: 'outstanding_balance', type: 'decimal', precision: 15, scale: 2 })
  outstandingBalance!: string;

  @Column({ name: 'interest_rate', type: 'decimal', precision: 5, scale: 4, default: 0.05 })
  interestRate!: string;

  @Column({ name: 'installment_interval_days', type: 'int', default: 5 })
  installmentIntervalDays!: number;

  @Column({ name: 'max_duration_days', type: 'int', default: 20 })
  maxDurationDays!: number;

  @Column({
    type: 'varchar',
    length: 20,
    default: LoanStatus.ACTIVE,
  })
  status!: LoanStatus;

  @Column({ name: 'next_installment_at', type: 'timestamptz' })
  nextInstallmentAt!: Date;

  @Column({ name: 'disbursed_at', type: 'timestamptz', default: () => 'NOW()' })
  disbursedAt!: Date;

  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt!: Date | null;

  @Column({ name: 'late_payment_count', type: 'int', default: 0 })
  latePaymentCount!: number;

  @ManyToOne(() => Player, (player) => player.loans)
  @JoinColumn({ name: 'player_id' })
  player!: Player;

  @ManyToOne(() => Season)
  @JoinColumn({ name: 'season_id' })
  season!: Season;

  @OneToMany(() => LoanPayment, (lp) => lp.loan)
  payments!: LoanPayment[];
}
