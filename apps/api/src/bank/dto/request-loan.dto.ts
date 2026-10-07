import { IsNumber, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RequestLoanDto {
  @ApiProperty({
    description: 'Loan amount in coins (minimum 100)',
    example: 500,
    minimum: 100,
  })
  @IsNumber()
  @Min(100, { message: 'Minimum loan amount is 100 coins' })
  amount!: number;
}
