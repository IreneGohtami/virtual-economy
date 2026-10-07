import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { LoanStatus, TransactionType, SeasonStatus } from '@sea-commodity-tycoon/shared-types';
import { Loan } from '../entities/loan.entity';
import { LoanPayment } from '../entities/loan-payment.entity';
import { Season } from '../entities/season.entity';
import { WalletService } from '../wallet/wallet.service';
import { PlayerService } from '../player/player.service';

/** Loan constants */
const INTEREST_RATE = 0.05; // 5% per 5-day period
const INSTALLMENT_INTERVAL_DAYS = 5;
const MAX_DURATION_DAYS = 20;
const NUM_INSTALLMENTS = MAX_DURATION_DAYS / INSTALLMENT_INTERVAL_DAYS; // 4
const MIN_LOAN_AMOUNT = 100;
const MAX_OUTSTANDING_RATIO = 0.5; // 50% of net worth
const LATE_PENALTY_RATE = 0.02; // 2% penalty on missed installment

export interface LoanCapacity {
  netWorth: number;
  maxBorrowingLimit: number;
  totalOutstanding: number;
  availableCapacity: number;
  hasLatePayments: boolean;
}

export interface InstallmentResult {
  loanId: string;
  amountDeducted: number;
  principalPortion: number;
  interestPortion: number;
  penaltyAmount: number;
  remainingBalance: number;
  loanStatus: LoanStatus;
  latePayment: boolean;
}

@Injectable()
export class BankService {
  private readonly logger = new Logger(BankService.name);

  constructor(
    @InjectRepository(Loan)
    private readonly loanRepository: Repository<Loan>,
    @InjectRepository(LoanPayment)
    private readonly loanPaymentRepository: Repository<LoanPayment>,
    @InjectRepository(Season)
    private readonly seasonRepository: Repository<Season>,
    private readonly dataSource: DataSource,
    private readonly walletService: WalletService,
    private readonly playerService: PlayerService,
  ) {}

  /**
   * Request a new loan. Validates borrowing capacity and creates a loan record.
   * Credits the loan amount to the player's wallet.
   */
  async requestLoan(playerId: string, amount: number): Promise<Loan> {
    const season = await this.getActiveSeason();

    // Validate minimum loan amount
    if (amount < MIN_LOAN_AMOUNT) {
      throw new BadRequestException(`Minimum loan amount is ${MIN_LOAN_AMOUNT} coins`);
    }

    // Check for late payments restricting new loans
    const hasLatePayments = await this.hasUnresolvedLatePayments(playerId, season.id);
    if (hasLatePayments) {
      throw new ForbiddenException(
        'Cannot request new loans while you have unresolved late payments. Settle outstanding installments first.',
      );
    }

    // Calculate max borrowing capacity
    const capacity = await this.getMaxBorrowingCapacity(playerId);
    if (amount > capacity.availableCapacity) {
      throw new BadRequestException(
        `Requested amount ${amount} exceeds available borrowing capacity of ${capacity.availableCapacity.toFixed(2)} coins. ` +
          `Total outstanding must not exceed 50% of net worth (${capacity.netWorth.toFixed(2)}).`,
      );
    }

    // Execute within a transaction for atomicity
    return this.dataSource.transaction(async (manager: EntityManager) => {
      // Calculate next installment date
      const now = new Date();
      const nextInstallmentAt = new Date(now);
      nextInstallmentAt.setDate(nextInstallmentAt.getDate() + INSTALLMENT_INTERVAL_DAYS);

      // Create loan record
      const loan = manager.create(Loan, {
        playerId,
        seasonId: season.id,
        principal: amount.toFixed(2),
        outstandingBalance: amount.toFixed(2),
        interestRate: INTEREST_RATE.toFixed(4),
        installmentIntervalDays: INSTALLMENT_INTERVAL_DAYS,
        maxDurationDays: MAX_DURATION_DAYS,
        status: LoanStatus.ACTIVE,
        nextInstallmentAt,
        disbursedAt: now,
        paidAt: null,
        latePaymentCount: 0,
      });

      const savedLoan = await manager.save(Loan, loan);

      // Credit wallet with loan amount
      await this.walletService.executeTransactionWithManager(
        manager,
        playerId,
        season.id,
        TransactionType.LOAN_DISBURSEMENT,
        amount,
        {
          referenceType: 'loan',
          referenceId: savedLoan.id,
          description: `Loan disbursement of ${amount.toFixed(2)} coins`,
        },
      );

      this.logger.log(
        `Loan disbursed: player=${playerId}, amount=${amount.toFixed(2)}, loanId=${savedLoan.id}`,
      );

      return savedLoan;
    });
  }

  /**
   * Process a scheduled installment for a loan.
   * Called by the worker every 5 days per loan.
   *
   * Each installment:
   *   interest_accrued = outstanding_balance × interest_rate
   *   principal_portion = principal / num_installments
   *   installment_amount = principal_portion + interest_accrued
   */
  async processInstallment(loanId: string): Promise<InstallmentResult> {
    return this.dataSource.transaction(async (manager: EntityManager) => {
      // Lock the loan row for update
      const loan = await manager
        .createQueryBuilder(Loan, 'loan')
        .setLock('pessimistic_write')
        .where('loan.id = :loanId', { loanId })
        .getOne();

      if (!loan) {
        throw new NotFoundException(`Loan ${loanId} not found`);
      }

      if (loan.status !== LoanStatus.ACTIVE) {
        throw new BadRequestException(`Loan ${loanId} is not active (status: ${loan.status})`);
      }

      const outstandingBalance = parseFloat(loan.outstandingBalance);
      const principal = parseFloat(loan.principal);
      const interestRate = parseFloat(loan.interestRate);

      // Calculate installment components
      const interestAccrued = outstandingBalance * interestRate;
      const principalPortion = principal / NUM_INSTALLMENTS;
      // Don't pay more principal than is outstanding
      const actualPrincipalPortion = Math.min(principalPortion, outstandingBalance);
      const installmentAmount = actualPrincipalPortion + interestAccrued;

      let penaltyAmount = 0;
      let latePayment = false;

      // Attempt to deduct from player's wallet
      try {
        await this.walletService.executeTransactionWithManager(
          manager,
          loan.playerId,
          loan.seasonId,
          TransactionType.LOAN_REPAYMENT,
          -installmentAmount,
          {
            referenceType: 'loan',
            referenceId: loan.id,
            description: `Loan installment: principal ${actualPrincipalPortion.toFixed(2)} + interest ${interestAccrued.toFixed(2)}`,
          },
        );
      } catch (error: unknown) {
        // Insufficient funds - apply late penalty
        latePayment = true;
        penaltyAmount = outstandingBalance * LATE_PENALTY_RATE;

        loan.latePaymentCount += 1;
        loan.outstandingBalance = (outstandingBalance + penaltyAmount).toFixed(2);

        // Schedule next installment
        const nextInstallmentAt = new Date();
        nextInstallmentAt.setDate(nextInstallmentAt.getDate() + INSTALLMENT_INTERVAL_DAYS);
        loan.nextInstallmentAt = nextInstallmentAt;

        await manager.save(Loan, loan);

        // Record the failed payment with penalty
        const payment = manager.create(LoanPayment, {
          loanId: loan.id,
          amount: '0.00',
          principalPortion: '0.00',
          interestPortion: '0.00',
          penaltyAmount: penaltyAmount.toFixed(2),
          paymentType: 'LATE',
          paidAt: new Date(),
        });
        await manager.save(LoanPayment, payment);

        this.logger.warn(
          `Late payment on loan ${loanId}: penalty=${penaltyAmount.toFixed(2)}, late_count=${loan.latePaymentCount}`,
        );

        return {
          loanId: loan.id,
          amountDeducted: 0,
          principalPortion: 0,
          interestPortion: 0,
          penaltyAmount,
          remainingBalance: parseFloat(loan.outstandingBalance),
          loanStatus: loan.status,
          latePayment: true,
        };
      }

      // Payment successful - update loan balance
      const newBalance = outstandingBalance - actualPrincipalPortion;
      loan.outstandingBalance = newBalance.toFixed(2);

      if (newBalance <= 0.005) {
        // Loan fully paid (account for floating point)
        loan.status = LoanStatus.PAID;
        loan.paidAt = new Date();
        loan.outstandingBalance = '0.00';
      } else {
        // Schedule next installment
        const nextInstallmentAt = new Date();
        nextInstallmentAt.setDate(nextInstallmentAt.getDate() + INSTALLMENT_INTERVAL_DAYS);
        loan.nextInstallmentAt = nextInstallmentAt;
      }

      await manager.save(Loan, loan);

      // Record the payment
      const payment = manager.create(LoanPayment, {
        loanId: loan.id,
        amount: installmentAmount.toFixed(2),
        principalPortion: actualPrincipalPortion.toFixed(2),
        interestPortion: interestAccrued.toFixed(2),
        penaltyAmount: '0.00',
        paymentType: 'INSTALLMENT',
        paidAt: new Date(),
      });
      await manager.save(LoanPayment, payment);

      this.logger.log(
        `Installment processed: loan=${loanId}, amount=${installmentAmount.toFixed(2)}, remaining=${loan.outstandingBalance}`,
      );

      return {
        loanId: loan.id,
        amountDeducted: installmentAmount,
        principalPortion: actualPrincipalPortion,
        interestPortion: interestAccrued,
        penaltyAmount: 0,
        remainingBalance: parseFloat(loan.outstandingBalance),
        loanStatus: loan.status,
        latePayment: false,
      };
    });
  }

  /**
   * Early repayment of a loan (partial or full). No penalty for early repayment.
   */
  async repayEarly(playerId: string, loanId: string, amount: number): Promise<Loan> {
    const season = await this.getActiveSeason();

    return this.dataSource.transaction(async (manager: EntityManager) => {
      // Lock the loan row
      const loan = await manager
        .createQueryBuilder(Loan, 'loan')
        .setLock('pessimistic_write')
        .where('loan.id = :loanId', { loanId })
        .getOne();

      if (!loan) {
        throw new NotFoundException(`Loan ${loanId} not found`);
      }

      if (loan.playerId !== playerId) {
        throw new ForbiddenException('This loan does not belong to you');
      }

      if (loan.status !== LoanStatus.ACTIVE) {
        throw new BadRequestException(`Loan is not active (status: ${loan.status})`);
      }

      const outstandingBalance = parseFloat(loan.outstandingBalance);

      // Cap the repayment at outstanding balance
      const repaymentAmount = Math.min(amount, outstandingBalance);

      if (repaymentAmount <= 0) {
        throw new BadRequestException('Repayment amount must be positive');
      }

      // Debit the player's wallet
      await this.walletService.executeTransactionWithManager(
        manager,
        playerId,
        season.id,
        TransactionType.LOAN_REPAYMENT,
        -repaymentAmount,
        {
          referenceType: 'loan',
          referenceId: loan.id,
          description: `Early loan repayment of ${repaymentAmount.toFixed(2)} coins`,
        },
      );

      // Update loan balance
      const newBalance = outstandingBalance - repaymentAmount;
      loan.outstandingBalance = newBalance.toFixed(2);

      if (newBalance <= 0.005) {
        loan.status = LoanStatus.PAID;
        loan.paidAt = new Date();
        loan.outstandingBalance = '0.00';
      }

      await manager.save(Loan, loan);

      // Record the payment
      const payment = manager.create(LoanPayment, {
        loanId: loan.id,
        amount: repaymentAmount.toFixed(2),
        principalPortion: repaymentAmount.toFixed(2),
        interestPortion: '0.00',
        penaltyAmount: '0.00',
        paymentType: 'EARLY_REPAYMENT',
        paidAt: new Date(),
      });
      await manager.save(LoanPayment, payment);

      this.logger.log(
        `Early repayment: loan=${loanId}, amount=${repaymentAmount.toFixed(2)}, remaining=${loan.outstandingBalance}`,
      );

      return loan;
    });
  }

  /**
   * Calculate max borrowing capacity for a player.
   * Total outstanding ≤ 50% of net worth.
   */
  async getMaxBorrowingCapacity(playerId: string): Promise<LoanCapacity> {
    const season = await this.getActiveSeason();

    const netWorthBreakdown = await this.playerService.getNetWorth(playerId);
    const netWorth = netWorthBreakdown.total;
    const maxBorrowingLimit = netWorth * MAX_OUTSTANDING_RATIO;

    // Get total outstanding balance across all active loans
    const result = await this.loanRepository
      .createQueryBuilder('loan')
      .select('COALESCE(SUM(loan.outstanding_balance), 0)', 'total')
      .where('loan.player_id = :playerId', { playerId })
      .andWhere('loan.season_id = :seasonId', { seasonId: season.id })
      .andWhere('loan.status = :status', { status: LoanStatus.ACTIVE })
      .getRawOne();

    const totalOutstanding = parseFloat(result?.total ?? '0');
    const availableCapacity = Math.max(0, maxBorrowingLimit - totalOutstanding);

    const hasLatePayments = await this.hasUnresolvedLatePayments(playerId, season.id);

    return {
      netWorth,
      maxBorrowingLimit,
      totalOutstanding,
      availableCapacity,
      hasLatePayments,
    };
  }

  /**
   * Get all active loans for a player in the current season.
   */
  async getActiveLoans(playerId: string): Promise<Loan[]> {
    const season = await this.getActiveSeason();

    return this.loanRepository.find({
      where: {
        playerId,
        seasonId: season.id,
        status: LoanStatus.ACTIVE,
      },
      relations: ['payments'],
      order: { disbursedAt: 'DESC' },
    });
  }

  /**
   * Get all loans (including paid) for a player in the current season.
   */
  async getAllLoans(playerId: string): Promise<Loan[]> {
    const season = await this.getActiveSeason();

    return this.loanRepository.find({
      where: {
        playerId,
        seasonId: season.id,
      },
      relations: ['payments'],
      order: { disbursedAt: 'DESC' },
    });
  }

  /**
   * Get the active season ID. Used by controller for consistency.
   */
  async getActiveSeasonId(): Promise<string> {
    const season = await this.getActiveSeason();
    return season.id;
  }

  // --- Private Helpers ---

  /**
   * Check if a player has unresolved late payments that restrict new loans.
   * A player is restricted if any active loan has latePaymentCount > 0.
   */
  private async hasUnresolvedLatePayments(playerId: string, seasonId: string): Promise<boolean> {
    const count = await this.loanRepository
      .createQueryBuilder('loan')
      .where('loan.player_id = :playerId', { playerId })
      .andWhere('loan.season_id = :seasonId', { seasonId })
      .andWhere('loan.status = :status', { status: LoanStatus.ACTIVE })
      .andWhere('loan.late_payment_count > 0')
      .getCount();

    return count > 0;
  }

  private async getActiveSeason(): Promise<Season> {
    const season = await this.seasonRepository.findOne({
      where: { status: SeasonStatus.ACTIVE },
      order: { startsAt: 'DESC' },
    });

    if (!season) {
      throw new NotFoundException('No active season found');
    }

    return season;
  }
}
