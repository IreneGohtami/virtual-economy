import { IsNumber, IsPositive } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RepayLoanDto {
  @ApiProperty({
    description: 'Amount to repay (partial or full early repayment)',
    example: 200,
  })
  @IsNumber()
  @IsPositive({ message: 'Repayment amount must be positive' })
  amount!: number;
}
