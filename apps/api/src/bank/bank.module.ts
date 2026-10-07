import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Loan } from '../entities/loan.entity';
import { LoanPayment } from '../entities/loan-payment.entity';
import { Season } from '../entities/season.entity';
import { WalletModule } from '../wallet';
import { PlayerModule } from '../player';
import { BankService } from './bank.service';
import { BankController } from './bank.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Loan, LoanPayment, Season]),
    WalletModule,
    PlayerModule,
  ],
  controllers: [BankController],
  providers: [BankService],
  exports: [BankService],
})
export class BankModule {}
