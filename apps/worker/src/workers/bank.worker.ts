import { Worker, Job, ConnectionOptions } from 'bullmq';
import { QUEUE_NAMES, getRetryPolicy } from '../queues';
import { DeadLetterQueueHandler } from '../dlq';
import { getPool } from '../database';

const QUEUE = QUEUE_NAMES.BANK;
const retryPolicy = getRetryPolicy(QUEUE);

/** Interest rate per 5-day period */
const INTEREST_RATE = 0.05;

/** Number of scheduled installments per loan (20 days / 5-day interval) */
const NUM_INSTALLMENTS = 4;

/** Late payment penalty rate applied to outstanding balance */
const LATE_PENALTY_RATE = 0.02;

/** Installment interval in days */
const INSTALLMENT_INTERVAL_DAYS = 5;

/**
 * Bank worker handles:
 * - loan.installment — processes scheduled loan payments
 *
 * Requirements: 11.4, 11.6
 */
export function createBankWorker(
  connection: ConnectionOptions,
  concurrency: number,
  dlqHandler: DeadLetterQueueHandler,
): Worker {
  const worker = new Worker(
    QUEUE,
    async (job: Job) => {
      console.log(`[${QUEUE}] Processing job ${job.name} (id: ${job.id})`);

      switch (job.name) {
        case 'loan.installment':
          await processLoanInstallments();
          break;
        default:
          console.warn(`[${QUEUE}] Unknown job name: ${job.name}`);
      }
    },
    {
      connection,
      concurrency,
      autorun: false,
    },
  );

  worker.on('failed', async (job, error) => {
    if (job && job.attemptsMade >= retryPolicy.attempts) {
      await dlqHandler.moveToDeadLetter(job, error);
    }
  });

  return worker;
}

interface ActiveLoan {
  id: string;
  player_id: string;
  season_id: string;
  principal: string;
  outstanding_balance: string;
  interest_rate: string;
  late_payment_count: number;
}

/**
 * Processes all active loans where the next installment is due (nextInstallmentAt <= now).
 *
 * For each loan:
 * 1. Calculate interest = outstanding_balance × interest_rate
 * 2. Calculate principal_portion = principal / NUM_INSTALLMENTS (capped at outstanding)
 * 3. Attempt deduction from player wallet
 * 4. On insufficient funds: apply 2% late penalty, increment latePaymentCount
 * 5. Record LoanPayment. Update nextInstallmentAt. Mark PAID if balance = 0.
 */
async function processLoanInstallments(): Promise<void> {
  const pool = getPool();

  // Find all active loans where next_installment_at <= now
  const loansResult = await pool.query<ActiveLoan>(
    `SELECT id, player_id, season_id, principal, outstanding_balance, interest_rate, late_payment_count
     FROM loans
     WHERE status = 'ACTIVE' AND next_installment_at <= NOW()`,
  );

  if (loansResult.rows.length === 0) {
    console.log(`[${QUEUE}] No loans due for installment processing`);
    return;
  }

  console.log(`[${QUEUE}] Processing installments for ${loansResult.rows.length} loans`);

  let successCount = 0;
  let lateCount = 0;
  let paidOffCount = 0;

  for (const loan of loansResult.rows) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Lock the loan row for update
      const lockedLoanResult = await client.query<ActiveLoan>(
        `SELECT id, player_id, season_id, principal, outstanding_balance, interest_rate, late_payment_count
         FROM loans
         WHERE id = $1 AND status = 'ACTIVE'
         FOR UPDATE`,
        [loan.id],
      );

      if (lockedLoanResult.rows.length === 0) {
        // Loan was paid or status changed since initial query
        await client.query('ROLLBACK');
        continue;
      }

      const lockedLoan = lockedLoanResult.rows[0];
      const outstandingBalance = parseFloat(lockedLoan.outstanding_balance);
      const principal = parseFloat(lockedLoan.principal);
      const interestRate = parseFloat(lockedLoan.interest_rate);

      // Calculate installment components
      const interestAccrued = outstandingBalance * interestRate;
      const principalPortion = Math.min(principal / NUM_INSTALLMENTS, outstandingBalance);
      const installmentAmount = principalPortion + interestAccrued;

      // Lock player's wallet row and check balance
      const walletResult = await client.query<{ id: string; coins: string }>(
        `SELECT id, coins FROM player_seasons
         WHERE player_id = $1 AND season_id = $2
         FOR UPDATE`,
        [lockedLoan.player_id, lockedLoan.season_id],
      );

      if (walletResult.rows.length === 0) {
        await client.query('ROLLBACK');
        continue;
      }

      const currentCoins = parseFloat(walletResult.rows[0].coins);

      if (currentCoins < installmentAmount) {
        // Insufficient funds — apply late penalty
        const penaltyAmount = outstandingBalance * LATE_PENALTY_RATE;
        const newOutstanding = outstandingBalance + penaltyAmount;
        const newLateCount = lockedLoan.late_payment_count + 1;

        // Update loan with penalty and next installment date
        const nextInstallmentAt = new Date();
        nextInstallmentAt.setDate(nextInstallmentAt.getDate() + INSTALLMENT_INTERVAL_DAYS);

        await client.query(
          `UPDATE loans
           SET outstanding_balance = $1,
               late_payment_count = $2,
               next_installment_at = $3
           WHERE id = $4`,
          [newOutstanding.toFixed(2), newLateCount, nextInstallmentAt.toISOString(), loan.id],
        );

        // Record the failed payment
        await client.query(
          `INSERT INTO loan_payments (id, loan_id, amount, principal_portion, interest_portion, penalty_amount, payment_type, paid_at)
           VALUES (gen_random_uuid(), $1, '0.00', '0.00', '0.00', $2, 'LATE', NOW())`,
          [loan.id, penaltyAmount.toFixed(2)],
        );

        await client.query('COMMIT');
        lateCount++;

        console.warn(
          `[${QUEUE}] Late payment: loan=${loan.id}, player=${lockedLoan.player_id}, penalty=${penaltyAmount.toFixed(2)}, late_count=${newLateCount}`,
        );
      } else {
        // Successful payment — deduct from wallet
        const newBalance = currentCoins - installmentAmount;

        await client.query(
          `UPDATE player_seasons SET coins = $1 WHERE id = $2`,
          [newBalance.toFixed(2), walletResult.rows[0].id],
        );

        // Record wallet transaction
        await client.query(
          `INSERT INTO wallet_transactions (id, player_id, season_id, type, amount, balance_after, reference_type, reference_id, description, created_at)
           VALUES (gen_random_uuid(), $1, $2, 'LOAN_REPAYMENT', $3, $4, 'loan', $5, $6, NOW())`,
          [
            lockedLoan.player_id,
            lockedLoan.season_id,
            (-installmentAmount).toFixed(2),
            newBalance.toFixed(2),
            loan.id,
            `Loan installment: principal ${principalPortion.toFixed(2)} + interest ${interestAccrued.toFixed(2)}`,
          ],
        );

        // Update loan balance
        const newOutstanding = outstandingBalance - principalPortion;

        if (newOutstanding <= 0.005) {
          // Loan fully paid off
          await client.query(
            `UPDATE loans
             SET outstanding_balance = '0.00',
                 status = 'PAID',
                 paid_at = NOW()
             WHERE id = $1`,
            [loan.id],
          );
          paidOffCount++;
        } else {
          // Schedule next installment
          const nextInstallmentAt = new Date();
          nextInstallmentAt.setDate(nextInstallmentAt.getDate() + INSTALLMENT_INTERVAL_DAYS);

          await client.query(
            `UPDATE loans
             SET outstanding_balance = $1,
                 next_installment_at = $2
             WHERE id = $3`,
            [newOutstanding.toFixed(2), nextInstallmentAt.toISOString(), loan.id],
          );
        }

        // Record the payment
        await client.query(
          `INSERT INTO loan_payments (id, loan_id, amount, principal_portion, interest_portion, penalty_amount, payment_type, paid_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, '0.00', 'INSTALLMENT', NOW())`,
          [loan.id, installmentAmount.toFixed(2), principalPortion.toFixed(2), interestAccrued.toFixed(2)],
        );

        await client.query('COMMIT');
        successCount++;

        console.log(
          `[${QUEUE}] Installment processed: loan=${loan.id}, amount=${installmentAmount.toFixed(2)}, remaining=${newOutstanding <= 0.005 ? '0.00' : newOutstanding.toFixed(2)}`,
        );
      }
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`[${QUEUE}] Error processing installment for loan=${loan.id}:`, err);
    } finally {
      client.release();
    }
  }

  console.log(
    `[${QUEUE}] Loan installment processing complete: ${successCount} successful, ${lateCount} late, ${paidOffCount} paid off`,
  );
}
