import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { Request } from 'express';
import { Player } from '../entities/player.entity';
import { BankService } from './bank.service';
import { RequestLoanDto, RepayLoanDto } from './dto';

@ApiTags('Bank')
@ApiBearerAuth()
@Controller('bank')
export class BankController {
  constructor(private readonly bankService: BankService) {}

  @Post('loans')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Request a new loan' })
  @ApiResponse({ status: 201, description: 'Loan created and funds disbursed' })
  @ApiResponse({ status: 400, description: 'Below minimum amount or exceeds borrowing capacity' })
  @ApiResponse({ status: 403, description: 'Restricted due to unresolved late payments' })
  @ApiResponse({ status: 404, description: 'No active season found' })
  async requestLoan(@Req() req: Request, @Body() dto: RequestLoanDto) {
    const player = req.user as Player;
    const loan = await this.bankService.requestLoan(player.id, dto.amount);
    return { message: 'Loan disbursed successfully', loan };
  }

  @Get('loans')
  @ApiOperation({ summary: 'Get all loans for the current season' })
  @ApiResponse({ status: 200, description: 'List of all loans with payment history' })
  @ApiResponse({ status: 404, description: 'No active season found' })
  async getLoans(@Req() req: Request) {
    const player = req.user as Player;
    const loans = await this.bankService.getAllLoans(player.id);
    return { loans };
  }

  @Post('loans/:id/repay')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Make an early repayment on a loan (partial or full, no penalty)' })
  @ApiParam({ name: 'id', description: 'Loan UUID' })
  @ApiResponse({ status: 200, description: 'Repayment processed successfully' })
  @ApiResponse({ status: 400, description: 'Loan not active or invalid amount' })
  @ApiResponse({ status: 403, description: 'Loan does not belong to this player' })
  @ApiResponse({ status: 404, description: 'Loan not found' })
  @ApiResponse({ status: 422, description: 'Insufficient funds for repayment' })
  async repayLoan(
    @Req() req: Request,
    @Param('id') loanId: string,
    @Body() dto: RepayLoanDto,
  ) {
    const player = req.user as Player;
    const loan = await this.bankService.repayEarly(player.id, loanId, dto.amount);
    return { message: 'Repayment processed successfully', loan };
  }

  @Get('capacity')
  @ApiOperation({ summary: 'Get borrowing capacity (50% of net worth - outstanding debt)' })
  @ApiResponse({ status: 200, description: 'Current borrowing capacity breakdown' })
  @ApiResponse({ status: 404, description: 'No active season or player season record found' })
  async getCapacity(@Req() req: Request) {
    const player = req.user as Player;
    const capacity = await this.bankService.getMaxBorrowingCapacity(player.id);
    return { capacity };
  }
}
