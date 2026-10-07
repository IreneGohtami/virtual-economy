import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WalletService } from './wallet.service';
import { InsufficientFundsError } from './errors/insufficient-funds.error';
import { TransactionType } from '@sea-commodity-tycoon/shared-types';
import { DataSource, EntityManager, SelectQueryBuilder } from 'typeorm';
import { PlayerSeason } from '../entities/player-season.entity';
import { WalletTransaction } from '../entities/wallet-transaction.entity';

describe('WalletService', () => {
  let walletService: WalletService;
  let mockDataSource: Partial<DataSource>;
  let mockManager: Partial<EntityManager>;
  let mockQueryBuilder: Partial<SelectQueryBuilder<PlayerSeason>>;

  const playerId = '11111111-1111-1111-1111-111111111111';
  const seasonId = '22222222-2222-2222-2222-222222222222';

  beforeEach(() => {
    mockQueryBuilder = {
      setLock: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      getOne: vi.fn(),
    };

    mockManager = {
      createQueryBuilder: vi.fn().mockReturnValue(mockQueryBuilder),
      save: vi.fn().mockImplementation((_entity, data) => ({
        ...data,
        id: '33333333-3333-3333-3333-333333333333',
      })),
      create: vi.fn().mockImplementation((_entity, data) => data),
    };

    mockDataSource = {
      transaction: vi.fn().mockImplementation(async (cb: (manager: EntityManager) => Promise<unknown>) => {
        return cb(mockManager as EntityManager);
      }),
      getRepository: vi.fn().mockReturnValue({
        findOne: vi.fn(),
        createQueryBuilder: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnThis(),
          andWhere: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          offset: vi.fn().mockReturnThis(),
          getMany: vi.fn().mockResolvedValue([]),
        }),
      }),
    };

    walletService = new WalletService(mockDataSource as DataSource);
  });

  describe('executeTransaction', () => {
    it('should credit coins and record a wallet transaction', async () => {
      const playerSeason = {
        id: 'ps-1',
        playerId,
        seasonId,
        coins: '1000.00',
      } as PlayerSeason;

      (mockQueryBuilder.getOne as ReturnType<typeof vi.fn>).mockResolvedValue(playerSeason);

      const result = await walletService.executeTransaction(
        playerId,
        seasonId,
        TransactionType.MARKETPLACE_SALE,
        150,
        { referenceType: 'trade', referenceId: 'trade-1', description: 'Sold 10 rice' },
      );

      expect(result.balanceAfter).toBe(1150);
      expect(result.amount).toBe(150);
      expect(result.transactionId).toBe('33333333-3333-3333-3333-333333333333');

      // Verify the player season was saved with new balance
      expect(mockManager.save).toHaveBeenCalledWith(
        PlayerSeason,
        expect.objectContaining({ coins: '1150.00' }),
      );

      // Verify wallet transaction was recorded
      expect(mockManager.create).toHaveBeenCalledWith(
        WalletTransaction,
        expect.objectContaining({
          playerId,
          seasonId,
          transactionType: TransactionType.MARKETPLACE_SALE,
          amount: '150.00',
          balanceAfter: '1150.00',
          referenceType: 'trade',
          referenceId: 'trade-1',
          description: 'Sold 10 rice',
        }),
      );
    });

    it('should debit coins and record a wallet transaction', async () => {
      const playerSeason = {
        id: 'ps-1',
        playerId,
        seasonId,
        coins: '1000.00',
      } as PlayerSeason;

      (mockQueryBuilder.getOne as ReturnType<typeof vi.fn>).mockResolvedValue(playerSeason);

      const result = await walletService.executeTransaction(
        playerId,
        seasonId,
        TransactionType.FACTORY_PURCHASE,
        -300,
        { referenceType: 'factory', referenceId: 'factory-1' },
      );

      expect(result.balanceAfter).toBe(700);
      expect(result.amount).toBe(-300);

      expect(mockManager.save).toHaveBeenCalledWith(
        PlayerSeason,
        expect.objectContaining({ coins: '700.00' }),
      );

      expect(mockManager.create).toHaveBeenCalledWith(
        WalletTransaction,
        expect.objectContaining({
          transactionType: TransactionType.FACTORY_PURCHASE,
          amount: '-300.00',
          balanceAfter: '700.00',
        }),
      );
    });

    it('should throw InsufficientFundsError when debit exceeds balance', async () => {
      const playerSeason = {
        id: 'ps-1',
        playerId,
        seasonId,
        coins: '200.00',
      } as PlayerSeason;

      (mockQueryBuilder.getOne as ReturnType<typeof vi.fn>).mockResolvedValue(playerSeason);

      await expect(
        walletService.executeTransaction(
          playerId,
          seasonId,
          TransactionType.FACTORY_PURCHASE,
          -500,
        ),
      ).rejects.toThrow(InsufficientFundsError);

      // Ensure no save was called
      expect(mockManager.save).not.toHaveBeenCalled();
    });

    it('should throw InsufficientFundsError with correct balance and amount', async () => {
      const playerSeason = {
        id: 'ps-1',
        playerId,
        seasonId,
        coins: '75.50',
      } as PlayerSeason;

      (mockQueryBuilder.getOne as ReturnType<typeof vi.fn>).mockResolvedValue(playerSeason);

      try {
        await walletService.executeTransaction(
          playerId,
          seasonId,
          TransactionType.LAND_PURCHASE,
          -100,
        );
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(InsufficientFundsError);
        const insufficientFundsError = error as InsufficientFundsError;
        expect(insufficientFundsError.currentBalance).toBe(75.50);
        expect(insufficientFundsError.requiredAmount).toBe(100);
      }
    });

    it('should allow a debit that exactly zeroes the balance', async () => {
      const playerSeason = {
        id: 'ps-1',
        playerId,
        seasonId,
        coins: '500.00',
      } as PlayerSeason;

      (mockQueryBuilder.getOne as ReturnType<typeof vi.fn>).mockResolvedValue(playerSeason);

      const result = await walletService.executeTransaction(
        playerId,
        seasonId,
        TransactionType.LOAN_REPAYMENT,
        -500,
      );

      expect(result.balanceAfter).toBe(0);

      expect(mockManager.save).toHaveBeenCalledWith(
        PlayerSeason,
        expect.objectContaining({ coins: '0.00' }),
      );
    });

    it('should throw an error if PlayerSeason not found', async () => {
      (mockQueryBuilder.getOne as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(
        walletService.executeTransaction(
          playerId,
          seasonId,
          TransactionType.SHOP_REVENUE,
          50,
        ),
      ).rejects.toThrow('PlayerSeason not found');
    });

    it('should use pessimistic write lock', async () => {
      const playerSeason = {
        id: 'ps-1',
        playerId,
        seasonId,
        coins: '1000.00',
      } as PlayerSeason;

      (mockQueryBuilder.getOne as ReturnType<typeof vi.fn>).mockResolvedValue(playerSeason);

      await walletService.executeTransaction(
        playerId,
        seasonId,
        TransactionType.WORKER_WAGE,
        -8,
      );

      expect(mockManager.createQueryBuilder).toHaveBeenCalledWith(PlayerSeason, 'ps');
      expect(mockQueryBuilder.setLock).toHaveBeenCalledWith('pessimistic_write');
    });

    it('should handle all transaction types', async () => {
      const playerSeason = {
        id: 'ps-1',
        playerId,
        seasonId,
        coins: '10000.00',
      } as PlayerSeason;

      (mockQueryBuilder.getOne as ReturnType<typeof vi.fn>).mockResolvedValue(playerSeason);

      const allTypes = Object.values(TransactionType);
      for (const type of allTypes) {
        // Reset coins for each iteration
        playerSeason.coins = '10000.00';

        const result = await walletService.executeTransaction(
          playerId,
          seasonId,
          type,
          -10,
        );

        expect(result.balanceAfter).toBe(9990);
      }
    });

    it('should set null reference fields when no reference provided', async () => {
      const playerSeason = {
        id: 'ps-1',
        playerId,
        seasonId,
        coins: '1000.00',
      } as PlayerSeason;

      (mockQueryBuilder.getOne as ReturnType<typeof vi.fn>).mockResolvedValue(playerSeason);

      await walletService.executeTransaction(
        playerId,
        seasonId,
        TransactionType.HAPPINESS_BOOST,
        -50,
      );

      expect(mockManager.create).toHaveBeenCalledWith(
        WalletTransaction,
        expect.objectContaining({
          referenceType: null,
          referenceId: null,
          description: null,
        }),
      );
    });
  });

  describe('executeTransactionWithManager', () => {
    it('should work with an externally provided manager', async () => {
      const playerSeason = {
        id: 'ps-1',
        playerId,
        seasonId,
        coins: '1000.00',
      } as PlayerSeason;

      (mockQueryBuilder.getOne as ReturnType<typeof vi.fn>).mockResolvedValue(playerSeason);

      const result = await walletService.executeTransactionWithManager(
        mockManager as EntityManager,
        playerId,
        seasonId,
        TransactionType.INSTANT_SELL,
        90,
        { description: 'Instant sold 10 coal at 90% market price' },
      );

      expect(result.balanceAfter).toBe(1090);
      expect(result.amount).toBe(90);
    });
  });

  describe('getBalance', () => {
    it('should return the current balance', async () => {
      const playerSeason = {
        id: 'ps-1',
        playerId,
        seasonId,
        coins: '1234.56',
      } as PlayerSeason;

      const mockRepo = {
        findOne: vi.fn().mockResolvedValue(playerSeason),
      };
      (mockDataSource.getRepository as ReturnType<typeof vi.fn>).mockReturnValue(mockRepo);

      const balance = await walletService.getBalance(playerId, seasonId);
      expect(balance).toBe(1234.56);
    });

    it('should throw if player season not found', async () => {
      const mockRepo = {
        findOne: vi.fn().mockResolvedValue(null),
      };
      (mockDataSource.getRepository as ReturnType<typeof vi.fn>).mockReturnValue(mockRepo);

      await expect(
        walletService.getBalance(playerId, seasonId),
      ).rejects.toThrow('PlayerSeason not found');
    });
  });

  describe('getTransactionHistory', () => {
    it('should return transactions ordered by date descending', async () => {
      const mockTransactions = [
        { id: 't1', amount: '100.00', createdAt: new Date() },
        { id: 't2', amount: '-50.00', createdAt: new Date() },
      ];

      const mockQB = {
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        offset: vi.fn().mockReturnThis(),
        getMany: vi.fn().mockResolvedValue(mockTransactions),
      };

      const mockRepo = {
        createQueryBuilder: vi.fn().mockReturnValue(mockQB),
      };
      (mockDataSource.getRepository as ReturnType<typeof vi.fn>).mockReturnValue(mockRepo);

      const result = await walletService.getTransactionHistory(playerId, seasonId, {
        limit: 10,
        offset: 0,
        type: TransactionType.MARKETPLACE_SALE,
      });

      expect(result).toHaveLength(2);
      expect(mockQB.orderBy).toHaveBeenCalledWith('wt.created_at', 'DESC');
      expect(mockQB.andWhere).toHaveBeenCalledWith('wt.transaction_type = :type', {
        type: TransactionType.MARKETPLACE_SALE,
      });
      expect(mockQB.limit).toHaveBeenCalledWith(10);
      expect(mockQB.offset).toHaveBeenCalledWith(0);
    });
  });
});
