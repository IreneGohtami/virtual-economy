import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BankService } from './bank.service';
import { LoanStatus, TransactionType, SeasonStatus } from '@sea-commodity-tycoon/shared-types';
import { DataSource, EntityManager, Repository, SelectQueryBuilder } from 'typeorm';
import { Loan } from '../entities/loan.entity';
import { LoanPayment } from '../entities/loan-payment.entity';
import { Season } from '../entities/season.entity';
import { WalletService } from '../wallet/wallet.service';
import { PlayerService, NetWorthBreakdown } from '../player/player.service';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InsufficientFundsError } from '../wallet/errors/insufficient-funds.error';

describe('BankService', () => {
  let bankService: BankService;
  let mockLoanRepository: Partial<Repository<Loan>>;
  let mockLoanPaymentRepository: Partial<Repository<LoanPayment>>;
  let mockSeasonRepository: Partial<Repository<Season>>;
  let mockDataSource: Partial<DataSource>;
  let mockWalletService: Partial<WalletService>;
  let mockPlayerService: Partial<PlayerService>;
  let mockManager: Partial<EntityManager>;
  let mockLoanQueryBuilder: Partial<SelectQueryBuilder<Loan>>;

  const playerId = '11111111-1111-1111-1111-111111111111';
  const seasonId = '22222222-2222-2222-2222-222222222222';
  const loanId = '33333333-3333-3333-3333-333333333333';

  const activeSeason: Partial<Season> = {
    id: seasonId,
    status: SeasonStatus.ACTIVE,
    startsAt: new Date('2024-01-01'),
    endsAt: new Date('2024-01-31'),
  };

  beforeEach(() => {
    mockLoanQueryBuilder = {
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      setLock: vi.fn().mockReturnThis(),
      getOne: vi.fn().mockResolvedValue(null),
      getCount: vi.fn().mockResolvedValue(0),
      getRawOne: vi.fn().mockResolvedValue({ total: '0' }),
    };

    mockLoanRepository = {
      createQueryBuilder: vi.fn().mockReturnValue(mockLoanQueryBuilder),
      find: vi.fn().mockResolvedValue([]),
    };

    mockLoanPaymentRepository = {
      create: vi.fn().mockImplementation((data) => data),
      save: vi.fn().mockImplementation((data) => Promise.resolve({ id: 'payment-1', ...data })),
    };

    mockSeasonRepository = {
      findOne: vi.fn().mockResolvedValue(activeSeason),
    };

    mockManager = {
      createQueryBuilder: vi.fn().mockReturnValue(mockLoanQueryBuilder),
      create: vi.fn().mockImplementation((_entity, data) => data),
      save: vi.fn().mockImplementation((_entity, data) => {
        if (_entity === Loan) {
          return Promise.resolve({ id: loanId, ...data });
        }
        return Promise.resolve({ id: 'payment-1', ...data });
      }),
    };

    mockDataSource = {
      transaction: vi.fn().mockImplementation(async (cb: (manager: EntityManager) => Promise<unknown>) => {
        return cb(mockManager as EntityManager);
      }),
    };

    mockWalletService = {
      executeTransaction: vi.fn().mockResolvedValue({
        transactionId: 'tx-1',
        balanceAfter: 1500,
        amount: 500,
      }),
      executeTransactionWithManager: vi.fn().mockResolvedValue({
        transactionId: 'tx-1',
        balanceAfter: 1500,
        amount: 500,
      }),
    };

    mockPlayerService = {
      getNetWorth: vi.fn().mockResolvedValue({
        cash: 1000,
        landValue: 500,
        factoryValue: 300,
        inventoryMarketValue: 200,
        outstandingDebt: 0,
        total: 2000,
      } satisfies NetWorthBreakdown),
    };

    bankService = new BankService(
      mockLoanRepository as Repository<Loan>,
      mockLoanPaymentRepository as Repository<LoanPayment>,
      mockSeasonRepository as Repository<Season>,
      mockDataSource as DataSource,
      mockWalletService as WalletService,
      mockPlayerService as PlayerService,
    );
  });

  describe('requestLoan', () => {
    it('should create a loan and disburse funds', async () => {
      const loan = await bankService.requestLoan(playerId, 500);

      expect(loan.id).toBe(loanId);
      expect(loan.playerId).toBe(playerId);
      expect(loan.seasonId).toBe(seasonId);
      expect(loan.principal).toBe('500.00');
      expect(loan.outstandingBalance).toBe('500.00');
      expect(loan.status).toBe(LoanStatus.ACTIVE);

      // Verify wallet was credited
      expect(mockWalletService.executeTransactionWithManager).toHaveBeenCalledWith(
        mockManager,
        playerId,
        seasonId,
        TransactionType.LOAN_DISBURSEMENT,
        500,
        expect.objectContaining({
          referenceType: 'loan',
          referenceId: loanId,
        }),
      );
    });

    it('should reject loans below minimum amount (100)', async () => {
      await expect(bankService.requestLoan(playerId, 50)).rejects.toThrow(BadRequestException);
      await expect(bankService.requestLoan(playerId, 99)).rejects.toThrow(BadRequestException);
    });

    it('should reject loans exceeding borrowing capacity (50% of net worth)', async () => {
      // Net worth = 2000, max outstanding = 1000, currently 0 outstanding
      // Requesting 1100 should fail
      await expect(bankService.requestLoan(playerId, 1100)).rejects.toThrow(BadRequestException);
    });

    it('should allow loan up to exact capacity', async () => {
      // Net worth = 2000, 50% = 1000, no outstanding
      const loan = await bankService.requestLoan(playerId, 1000);
      expect(loan.principal).toBe('1000.00');
    });

    it('should account for existing outstanding debt in capacity calculation', async () => {
      // Already has 800 outstanding
      (mockLoanQueryBuilder.getRawOne as ReturnType<typeof vi.fn>).mockResolvedValue({ total: '800' });

      // Net worth = 2000, max = 1000, outstanding = 800, available = 200
      await expect(bankService.requestLoan(playerId, 300)).rejects.toThrow(BadRequestException);

      // But 200 should work
      const loan = await bankService.requestLoan(playerId, 200);
      expect(loan.principal).toBe('200.00');
    });

    it('should restrict new loans when player has late payments', async () => {
      (mockLoanQueryBuilder.getCount as ReturnType<typeof vi.fn>).mockResolvedValue(1);

      await expect(bankService.requestLoan(playerId, 200)).rejects.toThrow(ForbiddenException);
    });

    it('should set next installment at 5 days from now', async () => {
      const before = new Date();
      const loan = await bankService.requestLoan(playerId, 500);

      const nextInstallment = new Date(loan.nextInstallmentAt);
      const expectedMin = new Date(before);
      expectedMin.setDate(expectedMin.getDate() + 5);

      // Allow small timing difference (within 1 second)
      expect(nextInstallment.getTime()).toBeGreaterThanOrEqual(expectedMin.getTime() - 1000);
      expect(nextInstallment.getTime()).toBeLessThanOrEqual(expectedMin.getTime() + 1000);
    });

    it('should throw NotFoundException if no active season', async () => {
      (mockSeasonRepository.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(bankService.requestLoan(playerId, 500)).rejects.toThrow(NotFoundException);
    });
  });

  describe('processInstallment', () => {
    const activeLoan: Partial<Loan> = {
      id: loanId,
      playerId,
      seasonId,
      principal: '1000.00',
      outstandingBalance: '1000.00',
      interestRate: '0.0500',
      installmentIntervalDays: 5,
      maxDurationDays: 20,
      status: LoanStatus.ACTIVE,
      latePaymentCount: 0,
      nextInstallmentAt: new Date(),
    };

    it('should process an installment correctly', async () => {
      (mockLoanQueryBuilder.getOne as ReturnType<typeof vi.fn>).mockResolvedValue({ ...activeLoan });

      const result = await bankService.processInstallment(loanId);

      // interest = 1000 * 0.05 = 50
      // principal_portion = 1000 / 4 = 250
      // total = 300
      expect(result.principalPortion).toBe(250);
      expect(result.interestPortion).toBe(50);
      expect(result.amountDeducted).toBe(300);
      expect(result.remainingBalance).toBe(750);
      expect(result.latePayment).toBe(false);

      // Verify wallet debit
      expect(mockWalletService.executeTransactionWithManager).toHaveBeenCalledWith(
        mockManager,
        playerId,
        seasonId,
        TransactionType.LOAN_REPAYMENT,
        -300,
        expect.objectContaining({ referenceType: 'loan', referenceId: loanId }),
      );
    });

    it('should mark loan as PAID when balance reaches zero', async () => {
      // Last installment: outstanding = 250
      const lastInstallmentLoan = {
        ...activeLoan,
        outstandingBalance: '250.00',
      };
      (mockLoanQueryBuilder.getOne as ReturnType<typeof vi.fn>).mockResolvedValue({ ...lastInstallmentLoan });

      const result = await bankService.processInstallment(loanId);

      // interest = 250 * 0.05 = 12.5
      // principal_portion = min(250, 1000/4=250) = 250
      // total = 262.5
      expect(result.principalPortion).toBe(250);
      expect(result.interestPortion).toBe(12.5);
      expect(result.remainingBalance).toBe(0);
      expect(result.loanStatus).toBe(LoanStatus.PAID);

      // Verify loan saved with PAID status
      expect(mockManager.save).toHaveBeenCalledWith(
        Loan,
        expect.objectContaining({
          status: LoanStatus.PAID,
          outstandingBalance: '0.00',
        }),
      );
    });

    it('should handle insufficient funds with late penalty', async () => {
      (mockLoanQueryBuilder.getOne as ReturnType<typeof vi.fn>).mockResolvedValue({ ...activeLoan });

      // Wallet service throws InsufficientFundsError
      (mockWalletService.executeTransactionWithManager as ReturnType<typeof vi.fn>)
        .mockRejectedValue(new InsufficientFundsError(100, 300));

      const result = await bankService.processInstallment(loanId);

      // 2% penalty on outstanding balance of 1000 = 20
      expect(result.latePayment).toBe(true);
      expect(result.penaltyAmount).toBe(20);
      expect(result.amountDeducted).toBe(0);
      expect(result.remainingBalance).toBe(1020); // 1000 + 20 penalty

      // Verify penalty payment recorded
      expect(mockManager.create).toHaveBeenCalledWith(
        LoanPayment,
        expect.objectContaining({
          paymentType: 'LATE',
          penaltyAmount: '20.00',
          amount: '0.00',
        }),
      );
    });

    it('should increment late payment count on insufficient funds', async () => {
      const loanWithLatePay = { ...activeLoan, latePaymentCount: 1 };
      (mockLoanQueryBuilder.getOne as ReturnType<typeof vi.fn>).mockResolvedValue({ ...loanWithLatePay });

      (mockWalletService.executeTransactionWithManager as ReturnType<typeof vi.fn>)
        .mockRejectedValue(new InsufficientFundsError(50, 300));

      await bankService.processInstallment(loanId);

      expect(mockManager.save).toHaveBeenCalledWith(
        Loan,
        expect.objectContaining({
          latePaymentCount: 2,
        }),
      );
    });

    it('should throw NotFoundException for non-existent loan', async () => {
      (mockLoanQueryBuilder.getOne as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(bankService.processInstallment('bad-id')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for non-active loan', async () => {
      (mockLoanQueryBuilder.getOne as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...activeLoan,
        status: LoanStatus.PAID,
      });

      await expect(bankService.processInstallment(loanId)).rejects.toThrow(BadRequestException);
    });

    it('should cap principal portion at outstanding balance when less than scheduled', async () => {
      // Outstanding is 100, but principal/4 = 250 → should cap at 100
      const lowBalanceLoan = {
        ...activeLoan,
        outstandingBalance: '100.00',
      };
      (mockLoanQueryBuilder.getOne as ReturnType<typeof vi.fn>).mockResolvedValue({ ...lowBalanceLoan });

      const result = await bankService.processInstallment(loanId);

      // interest = 100 * 0.05 = 5
      // principal_portion = min(250, 100) = 100
      // total = 105
      expect(result.principalPortion).toBe(100);
      expect(result.interestPortion).toBe(5);
      expect(result.amountDeducted).toBe(105);
      expect(result.remainingBalance).toBe(0);
      expect(result.loanStatus).toBe(LoanStatus.PAID);
    });
  });

  describe('repayEarly', () => {
    const activeLoan: Partial<Loan> = {
      id: loanId,
      playerId,
      seasonId,
      principal: '1000.00',
      outstandingBalance: '750.00',
      interestRate: '0.0500',
      status: LoanStatus.ACTIVE,
      latePaymentCount: 0,
    };

    it('should process partial early repayment without penalty', async () => {
      (mockLoanQueryBuilder.getOne as ReturnType<typeof vi.fn>).mockResolvedValue({ ...activeLoan });

      const loan = await bankService.repayEarly(playerId, loanId, 200);

      expect(loan.outstandingBalance).toBe('550.00');
      expect(loan.status).toBe(LoanStatus.ACTIVE);

      // Verify wallet debit
      expect(mockWalletService.executeTransactionWithManager).toHaveBeenCalledWith(
        mockManager,
        playerId,
        seasonId,
        TransactionType.LOAN_REPAYMENT,
        -200,
        expect.objectContaining({ referenceType: 'loan', referenceId: loanId }),
      );

      // Verify payment record
      expect(mockManager.create).toHaveBeenCalledWith(
        LoanPayment,
        expect.objectContaining({
          paymentType: 'EARLY_REPAYMENT',
          principalPortion: '200.00',
          interestPortion: '0.00',
          penaltyAmount: '0.00',
        }),
      );
    });

    it('should fully repay loan and set status to PAID', async () => {
      (mockLoanQueryBuilder.getOne as ReturnType<typeof vi.fn>).mockResolvedValue({ ...activeLoan });

      const loan = await bankService.repayEarly(playerId, loanId, 750);

      expect(loan.outstandingBalance).toBe('0.00');
      expect(loan.status).toBe(LoanStatus.PAID);
      expect(loan.paidAt).toBeInstanceOf(Date);
    });

    it('should cap repayment at outstanding balance', async () => {
      (mockLoanQueryBuilder.getOne as ReturnType<typeof vi.fn>).mockResolvedValue({ ...activeLoan });

      // Trying to repay 2000, but only 750 outstanding
      const loan = await bankService.repayEarly(playerId, loanId, 2000);

      expect(loan.outstandingBalance).toBe('0.00');
      expect(loan.status).toBe(LoanStatus.PAID);

      // Should have only debited 750
      expect(mockWalletService.executeTransactionWithManager).toHaveBeenCalledWith(
        expect.anything(),
        playerId,
        seasonId,
        TransactionType.LOAN_REPAYMENT,
        -750,
        expect.anything(),
      );
    });

    it('should throw ForbiddenException if loan belongs to another player', async () => {
      (mockLoanQueryBuilder.getOne as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...activeLoan,
        playerId: 'other-player-id',
      });

      await expect(
        bankService.repayEarly(playerId, loanId, 200),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException if loan is already paid', async () => {
      (mockLoanQueryBuilder.getOne as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...activeLoan,
        status: LoanStatus.PAID,
      });

      await expect(
        bankService.repayEarly(playerId, loanId, 200),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if loan does not exist', async () => {
      (mockLoanQueryBuilder.getOne as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(
        bankService.repayEarly(playerId, loanId, 200),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getMaxBorrowingCapacity', () => {
    it('should calculate capacity as 50% of net worth minus outstanding', async () => {
      // Net worth = 2000, outstanding = 300
      (mockLoanQueryBuilder.getRawOne as ReturnType<typeof vi.fn>).mockResolvedValue({ total: '300' });

      const capacity = await bankService.getMaxBorrowingCapacity(playerId);

      expect(capacity.netWorth).toBe(2000);
      expect(capacity.maxBorrowingLimit).toBe(1000); // 50% of 2000
      expect(capacity.totalOutstanding).toBe(300);
      expect(capacity.availableCapacity).toBe(700); // 1000 - 300
    });

    it('should return 0 available when outstanding exceeds limit', async () => {
      // Net worth = 2000, but outstanding = 1200 (somehow got there)
      (mockLoanQueryBuilder.getRawOne as ReturnType<typeof vi.fn>).mockResolvedValue({ total: '1200' });

      const capacity = await bankService.getMaxBorrowingCapacity(playerId);

      expect(capacity.availableCapacity).toBe(0);
    });

    it('should indicate late payment status', async () => {
      (mockLoanQueryBuilder.getCount as ReturnType<typeof vi.fn>).mockResolvedValue(1);

      const capacity = await bankService.getMaxBorrowingCapacity(playerId);

      expect(capacity.hasLatePayments).toBe(true);
    });

    it('should return full capacity when no outstanding loans', async () => {
      const capacity = await bankService.getMaxBorrowingCapacity(playerId);

      expect(capacity.totalOutstanding).toBe(0);
      expect(capacity.availableCapacity).toBe(1000);
      expect(capacity.hasLatePayments).toBe(false);
    });
  });

  describe('getActiveLoans', () => {
    it('should return active loans for the current season', async () => {
      const mockLoans = [
        { id: 'loan-1', status: LoanStatus.ACTIVE, principal: '500.00' },
        { id: 'loan-2', status: LoanStatus.ACTIVE, principal: '300.00' },
      ];
      (mockLoanRepository.find as ReturnType<typeof vi.fn>).mockResolvedValue(mockLoans);

      const loans = await bankService.getActiveLoans(playerId);

      expect(loans).toHaveLength(2);
      expect(mockLoanRepository.find).toHaveBeenCalledWith({
        where: {
          playerId,
          seasonId,
          status: LoanStatus.ACTIVE,
        },
        relations: ['payments'],
        order: { disbursedAt: 'DESC' },
      });
    });
  });

  describe('getAllLoans', () => {
    it('should return all loans including paid ones', async () => {
      const mockLoans = [
        { id: 'loan-1', status: LoanStatus.ACTIVE, principal: '500.00' },
        { id: 'loan-2', status: LoanStatus.PAID, principal: '300.00' },
      ];
      (mockLoanRepository.find as ReturnType<typeof vi.fn>).mockResolvedValue(mockLoans);

      const loans = await bankService.getAllLoans(playerId);

      expect(loans).toHaveLength(2);
      expect(mockLoanRepository.find).toHaveBeenCalledWith({
        where: {
          playerId,
          seasonId,
        },
        relations: ['payments'],
        order: { disbursedAt: 'DESC' },
      });
    });
  });
});
