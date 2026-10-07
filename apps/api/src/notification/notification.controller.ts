import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { NotificationService } from './notification.service';
import { NotificationGateway } from './notification.gateway';

@ApiTags('Notification')
@ApiBearerAuth('access-token')
@Controller('notifications')
export class NotificationController {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly notificationGateway: NotificationGateway,
  ) {}

  /**
   * GET /notifications
   * Fetch queued (undelivered) notifications for the current player.
   * Used on reconnection to retrieve notifications that were missed while offline.
   * Marks fetched notifications as delivered.
   */
  @Get()
  @ApiOperation({
    summary: 'Get undelivered notifications (offline queue)',
    description:
      'Returns all notifications that have not been delivered via WebSocket. ' +
      'Call this on reconnection to catch up on missed events. ' +
      'Automatically marks returned notifications as delivered.',
  })
  @ApiQuery({ name: 'unreadOnly', required: false, type: Boolean })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  async getNotifications(
    @Request() req: { user: { id: string } },
    @Query('unreadOnly') unreadOnly?: boolean,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ) {
    const playerId = req.user.id;

    if (unreadOnly) {
      return this.notificationService.getUnread(
        playerId,
        limit ?? 50,
        offset ?? 0,
      );
    }

    // Default: return undelivered notifications and mark them as delivered
    const notifications = await this.notificationService.getUndelivered(playerId);

    if (notifications.length > 0) {
      const ids = notifications.map((n) => n.id);
      await this.notificationService.markAsDelivered(ids);
    }

    return { notifications, total: notifications.length };
  }

  /**
   * POST /notifications/read
   * Mark specific notifications as read.
   */
  @Post('read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Mark notifications as read',
    description: 'Marks the specified notification IDs as read for the current player.',
  })
  async markAsRead(
    @Request() req: { user: { id: string } },
    @Body() body: { ids: string[] },
  ) {
    await this.notificationService.markAsRead(req.user.id, body.ids);
  }
}
