import { HttpException, HttpStatus } from '@nestjs/common';

export class InsufficientFundsError extends HttpException {
  constructor(
    public readonly currentBalance: number,
    public readonly requiredAmount: number,
  ) {
    super(
      {
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        message: `Insufficient funds: current balance is ${currentBalance.toFixed(0)}, but ${requiredAmount.toFixed(0)} is required`,
        error: 'InsufficientFunds',
        currentBalance,
        requiredAmount,
      },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
