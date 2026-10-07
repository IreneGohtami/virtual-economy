import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import { Request } from 'express';
import { Player } from '../entities/player.entity';
import { WorkerService } from './worker.service';
import { HireWorkerDto, ReassignWorkerDto } from './dto';

@ApiTags('Workers')
@ApiBearerAuth()
@Controller('workers')
export class WorkerController {
  constructor(private readonly workerService: WorkerService) {}

  @Get('available')
  @ApiOperation({ summary: 'List available workers for hire in the current season' })
  @ApiQuery({ name: 'specialty', required: false, type: String })
  @ApiQuery({ name: 'minExperience', required: false, type: Number })
  @ApiQuery({ name: 'maxSalary', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'List of available workers' })
  async getAvailable(
    @Req() req: Request,
    @Query('specialty') specialty?: string,
    @Query('minExperience') minExperience?: string,
    @Query('maxSalary') maxSalary?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    // We need the active season ID - the service fetches it internally
    // but we need to call getAvailableWorkers with the seasonId from the service
    const player = req.user as Player;
    void player; // auth guard ensures player is authenticated

    // Use a helper to get the seasonId for the query
    const workers = await this.workerService.getAvailableWorkers(
      await this.getActiveSeasonId(),
      {
        specialty,
        minExperience: minExperience ? parseInt(minExperience, 10) : undefined,
        maxSalary: maxSalary ? parseFloat(maxSalary) : undefined,
        limit: limit ? parseInt(limit, 10) : undefined,
        offset: offset ? parseInt(offset, 10) : undefined,
      },
    );

    return workers.map((worker) => ({
      id: worker.id,
      name: worker.name,
      age: worker.age,
      gender: worker.gender,
      specialty: worker.specialty,
      salary: Math.round(parseFloat(worker.salary)),
      experienceLevel: worker.experienceLevel,
      commitmentLevel: Math.round(parseFloat(worker.commitmentLevel)),
    }));
  }

  @Post(':id/hire')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Hire a worker and assign to a factory' })
  @ApiParam({ name: 'id', description: 'Worker UUID' })
  @ApiResponse({ status: 201, description: 'Worker hired successfully' })
  @ApiResponse({ status: 400, description: 'Worker unavailable or factory full' })
  @ApiResponse({ status: 404, description: 'Worker or factory not found' })
  async hire(
    @Req() req: Request,
    @Param('id') workerId: string,
    @Body() dto: HireWorkerDto,
  ) {
    const player = req.user as Player;
    const assignment = await this.workerService.hire(player.id, workerId, dto.factoryId);

    return {
      id: assignment.id,
      workerId: assignment.workerId,
      playerId: assignment.playerId,
      factoryId: assignment.factoryId,
      seasonId: assignment.seasonId,
      status: assignment.status,
      hiredAt: assignment.hiredAt,
    };
  }

  @Post(':id/fire')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Fire a worker, settle salary, reduce happiness' })
  @ApiParam({ name: 'id', description: 'Worker UUID' })
  @ApiResponse({ status: 200, description: 'Worker fired successfully' })
  @ApiResponse({ status: 404, description: 'Worker assignment not found' })
  async fire(@Req() req: Request, @Param('id') workerId: string) {
    const player = req.user as Player;
    await this.workerService.fire(player.id, workerId);

    return { message: 'Worker fired successfully' };
  }

  @Post(':id/reassign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reassign a worker to a different factory' })
  @ApiParam({ name: 'id', description: 'Worker UUID' })
  @ApiResponse({ status: 200, description: 'Worker reassigned successfully' })
  @ApiResponse({ status: 400, description: 'Target factory full or same factory' })
  @ApiResponse({ status: 404, description: 'Worker or factory not found' })
  async reassign(
    @Req() req: Request,
    @Param('id') workerId: string,
    @Body() dto: ReassignWorkerDto,
  ) {
    const player = req.user as Player;
    const assignment = await this.workerService.reassign(player.id, workerId, dto.newFactoryId);

    return {
      id: assignment.id,
      workerId: assignment.workerId,
      playerId: assignment.playerId,
      factoryId: assignment.factoryId,
      seasonId: assignment.seasonId,
      status: assignment.status,
      statusChangedAt: assignment.statusChangedAt,
    };
  }

  @Post(':id/unassign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unassign a worker from their factory (becomes idle/unassigned)' })
  @ApiParam({ name: 'id', description: 'Worker UUID' })
  @ApiResponse({ status: 200, description: 'Worker unassigned successfully' })
  @ApiResponse({ status: 404, description: 'Worker assignment not found' })
  async unassign(@Req() req: Request, @Param('id') workerId: string) {
    const player = req.user as Player;
    await this.workerService.unassign(player.id, workerId);
    return { message: 'Worker unassigned successfully' };
  }

  @Get('mine')
  @ApiOperation({ summary: "List all player's hired workers in the current season" })
  @ApiResponse({ status: 200, description: "List of player's workers" })
  async getMyWorkers(@Req() req: Request) {
    const player = req.user as Player;
    const assignments = await this.workerService.getPlayerWorkers(player.id);

    return assignments.map((assignment) => ({
      id: assignment.id,
      workerId: assignment.workerId,
      factoryId: assignment.factoryId,
      status: assignment.status,
      hiredAt: assignment.hiredAt,
      statusChangedAt: assignment.statusChangedAt,
      disruptionEndsAt: assignment.disruptionEndsAt,
      worker: assignment.workerProfile
        ? {
            id: assignment.workerProfile.id,
            name: assignment.workerProfile.name,
            age: assignment.workerProfile.age,
            gender: assignment.workerProfile.gender,
            specialty: assignment.workerProfile.specialty,
            salary: Math.round(parseFloat(assignment.workerProfile.salary)),
            experienceLevel: assignment.workerProfile.experienceLevel,
            commitmentLevel: Math.round(parseFloat(assignment.workerProfile.commitmentLevel)),
          }
        : null,
      factory: assignment.factory
        ? {
            id: assignment.factory.id,
            name: assignment.factory.name,
            category: assignment.factory.category,
            factoryLevel: assignment.factory.factoryLevel,
            isShop: assignment.factory.isShop ?? false,
            status: assignment.factory.status,
          }
        : null,
    }));
  }

  // --- Helper ---

  private async getActiveSeasonId(): Promise<string> {
    return this.workerService.getActiveSeasonId();
  }
}
