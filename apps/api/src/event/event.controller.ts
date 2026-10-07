import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { EventService } from './event.service';
import { TriggerEventDto } from './dto';

@ApiTags('Events')
@ApiBearerAuth()
@Controller('events')
export class EventController {
  constructor(private readonly eventService: EventService) {}

  @Post('trigger')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Trigger a game event (admin)' })
  @ApiResponse({ status: 201, description: 'Event triggered successfully' })
  @ApiResponse({ status: 404, description: 'No active season found' })
  async triggerEvent(@Body() dto: TriggerEventDto) {
    const event = await this.eventService.triggerEvent(dto);
    return event;
  }

  @Get('active')
  @ApiOperation({ summary: 'Get all currently active events' })
  @ApiResponse({ status: 200, description: 'List of active events' })
  @ApiResponse({ status: 404, description: 'No active season found' })
  async getActiveEvents() {
    const events = await this.eventService.getActiveEvents();
    return { events };
  }

  @Get('scheduled')
  @ApiOperation({ summary: 'Get all scheduled (upcoming) events' })
  @ApiResponse({ status: 200, description: 'List of scheduled events' })
  @ApiResponse({ status: 404, description: 'No active season found' })
  async getScheduledEvents() {
    const events = await this.eventService.getScheduledEvents();
    return { events };
  }

  @Get('modifiers')
  @ApiOperation({ summary: 'Get cumulative active modifiers for a category' })
  @ApiQuery({ name: 'category', description: 'Commodity category to get modifiers for', example: 'AGRICULTURE' })
  @ApiResponse({ status: 200, description: 'Cumulative modifiers from active events' })
  @ApiResponse({ status: 404, description: 'No active season found' })
  async getActiveModifiers(@Query('category') category: string) {
    const modifiers = await this.eventService.getActiveModifiers(category);
    return { category, ...modifiers };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get event details by ID' })
  @ApiParam({ name: 'id', description: 'Event UUID' })
  @ApiResponse({ status: 200, description: 'Event details' })
  @ApiResponse({ status: 404, description: 'Event not found' })
  async getEvent(@Param('id') id: string) {
    return this.eventService.getEventById(id);
  }

  @Post(':id/end')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'End an active event (admin)' })
  @ApiParam({ name: 'id', description: 'Event UUID to end' })
  @ApiResponse({ status: 200, description: 'Event ended successfully' })
  @ApiResponse({ status: 400, description: 'Event already ended' })
  @ApiResponse({ status: 404, description: 'Event not found' })
  async endEvent(@Param('id') id: string) {
    return this.eventService.endEvent(id);
  }
}
