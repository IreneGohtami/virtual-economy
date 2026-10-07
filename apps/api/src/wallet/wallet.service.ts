import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { TransactionType } from '@sea-commodity-tycoon/shared-types';
import { PlayerSeason } from '../entities/player-season.entity';
import { WalletTransaction } from '../entities/wallet-transaction.entity';
import { InsufficientFundsError } from './errors/insufficient-funds.error';

export interface TransactionReference {
  referenceType?: string;
  referenceId?: string;
  description?: string;
}

export interface TransactionResult {
  transactionId: string;
  balanceAfter: number;
  amount: number;
}

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Execute a wallet transaction with pessimistic row-level locking.
   *
   * @param playerId - The player's UUID
   * @param seasonId - The current season's UUID
   * @param type - The transaction type from TransactionType enum
   * @param amount - Positive for credits, negative for debits
   * @param reference - Optional reference metadata (type, id, description)
   * @returns TransactionResult with the new balance
   * @throws InsufficientFundsError if a debit would result in negative balance
   */
  async executeTransaction(
    playerId: string,
    seasonId: string,
    type: TransactionType,
    amount: number,
    reference?: TransactionReference,
  ): Promise<TransactionResult> {
    return this.dataSource.transaction(async (manager: EntityManager) => {
      return this.executeTransactionWithManager(
        manager,
        playerId,
        seasonId,
        type,
        amount,
        reference,
      );
    });
  }

  /**
   * Execute a wallet transaction within an existing EntityManager transaction.
   * Use this when you need to perform the wallet operation as part of a larger
   * atomic transaction (e.g., purchasing a factory + deducting coins).
   *
   * The caller is responsible for wrapping this in a transaction with
   * pessimistic locking already in place or by using this method which
   * handles locking internally.
   */
  async executeTransactionWithManager(
    manager: EntityManager,
    playerId: string,
    seasonId: string,
    type: TransactionType,
    amount: number,
    reference?: TransactionReference,
  ): Promise<TransactionResult> {
    // 1. Lock player's wallet row with pessimistic write lock
    const playerSeason = await manager
      .createQueryBuilder(PlayerSeason, 'ps')
      .setLock('pessimistic_write')
      .where('ps.player_id = :playerId AND ps.season_id = :seasonId', {
        playerId,
        seasonId,
      })
      .getOne();

    if (!playerSeason) {
      throw new Error(
        `PlayerSeason not found for player ${playerId} in season ${seasonId}`,
      );
    }

    // 2. Calculate new balance
    const currentBalance = parseFloat(playerSeason.coins);
    const newBalance = currentBalance + amount;

    // 3. Validate no negative balance for debits
    if (newBalance < 0) {
      throw new InsufficientFundsError(currentBalance, Math.abs(amount));
    }

    // 4. Update coins
    playerSeason.coins = newBalance.toFixed(2);
    await manager.save(PlayerSeason, playerSeason);

    // 5. Record in wallet ledger
    const walletTransaction = manager.create(WalletTransaction, {
      playerId,
      seasonId,
      transactionType: type,
      amount: amount.toFixed(2),
      balanceAfter: newBalance.toFixed(2),
      referenceType: reference?.referenceType ?? null,
      referenceId: reference?.referenceId ?? null,
      description: reference?.description ?? null,
    });

    const savedTransaction = await manager.save(
      WalletTransaction,
      walletTransaction,
    );

    this.logger.log(
      `Transaction ${type}: player=${playerId}, amount=${amount.toFixed(2)}, balance=${newBalance.toFixed(2)}`,
    );

    return {
      transactionId: savedTransaction.id,
      balanceAfter: newBalance,
      amount,
    };
  }

  /**
   * Get the current balance for a player in a season.
   * Uses a pessimistic read lock to ensure consistency.
   */
  async getBalance(playerId: string, seasonId: string): Promise<number> {
    const playerSeason = await this.dataSource
      .getRepository(PlayerSeason)
      .findOne({
        where: { playerId, seasonId },
      });

    if (!playerSeason) {
      throw new Error(
        `PlayerSeason not found for player ${playerId} in season ${seasonId}`,
      );
    }

    return parseFloat(playerSeason.coins);
  }

  /**
   * Get transaction history for a player in a season.
   */
  async getTransactionHistory(
    playerId: string,
    seasonId: string,
    options?: { limit?: number; offset?: number; type?: TransactionType },
  ): Promise<WalletTransaction[]> {
    const queryBuilder = this.dataSource
      .getRepository(WalletTransaction)
      .createQueryBuilder('wt')
      .where('wt.player_id = :playerId AND wt.season_id = :seasonId', {
        playerId,
        seasonId,
      })
      .orderBy('wt.created_at', 'DESC');

    if (options?.type) {
      queryBuilder.andWhere('wt.transaction_type = :type', {
        type: options.type,
      });
    }

    if (options?.limit !== undefined) {
      queryBuilder.limit(options.limit);
    }

    if (options?.offset !== undefined) {
      queryBuilder.offset(options.offset);
    }

    return queryBuilder.getMany();
  }
}
