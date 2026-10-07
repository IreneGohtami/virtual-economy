import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Notification } from '../entities/notification.entity';
import { NotificationType } from '@sea-commodity-tycoon/shared-types';

export interface CreateNotificationDto {
  playerId: string;
  seasonId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
  ) {}

  /**
   * Create and persist a notification. Returns the saved entity.
   * The caller (gateway) is responsible for attempting WebSocket delivery
   * and marking as delivered if successful.
   */
  async createNotification(dto: CreateNotificationDto): Promise<Notification> {
    const notification = this.notificationRepository.create({
      playerId: dto.playerId,
      seasonId: dto.seasonId,
      type: dto.type,
      title: dto.title,
      body: dto.body ?? null,
      priority: dto.priority ?? 'NORMAL',
      read: false,
      delivered: false,
    });

    const saved = await this.notificationRepository.save(notification);
    this.logger.debug(
      `Notification created: ${saved.id} [${dto.type}] for player ${dto.playerId}`,
    );
    return saved;
  }

  /**
   * Get all undelivered notifications for a player (offline queue).
   * Used by REST endpoint on reconnection.
   */
  async getUndelivered(playerId: string): Promise<Notification[]> {
    return this.notificationRepository.find({
      where: { playerId, delivered: false },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Get unread notifications for a player, optionally paginated.
   */
  async getUnread(
    playerId: string,
    limit = 50,
    offset = 0,
  ): Promise<{ notifications: Notification[]; total: number }> {
    const [notifications, total] = await this.notificationRepository.findAndCount({
      where: { playerId, read: false },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    return { notifications, total };
  }

  /**
   * Mark notifications as delivered (after successful WebSocket push or REST fetch).
   */
  async markAsDelivered(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.notificationRepository.update(
      { id: In(ids) },
      { delivered: true },
    );
  }

  /**
   * Mark notifications as read by the player.
   */
  async markAsRead(playerId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.notificationRepository.update(
      { id: In(ids), playerId },
      { read: true },
    );
  }

  /**
   * Get all notifications for a player (for history view), paginated.
   */
  async getAll(
    playerId: string,
    limit = 50,
    offset = 0,
  ): Promise<{ notifications: Notification[]; total: number }> {
    const [notifications, total] = await this.notificationRepository.findAndCount({
      where: { playerId },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    return { notifications, total };
  }
}
