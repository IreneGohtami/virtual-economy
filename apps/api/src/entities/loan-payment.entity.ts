import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Loan } from './loan.entity';

@Entity('loan_payments')
export class LoanPayment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'loan_id', type: 'uuid' })
  loanId!: string;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  amount!: string;

  @Column({ name: 'principal_portion', type: 'decimal', precision: 15, scale: 2 })
  principalPortion!: string;

  @Column({ name: 'interest_portion', type: 'decimal', precision: 15, scale: 2 })
  interestPortion!: string;

  @Column({ name: 'penalty_amount', type: 'decimal', precision: 15, scale: 2, default: 0 })
  penaltyAmount!: string;

  @Column({ name: 'payment_type', type: 'varchar', length: 20 })
  paymentType!: string;

  @Column({ name: 'paid_at', type: 'timestamptz', default: () => 'NOW()' })
  paidAt!: Date;

  @ManyToOne(() => Loan, (loan) => loan.payments)
  @JoinColumn({ name: 'loan_id' })
  loan!: Loan;
}
