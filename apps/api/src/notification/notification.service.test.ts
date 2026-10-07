import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationService } from './notification.service';
import { NotificationType } from '@sea-commodity-tycoon/shared-types';
import { Repository, In } from 'typeorm';
import { Notification } from '../entities/notification.entity';

describe('NotificationService', () => {
  let service: NotificationService;
  let mockNotificationRepository: Partial<Repository<Notification>>;

  const playerId = '11111111-1111-1111-1111-111111111111';
  const seasonId = '22222222-2222-2222-2222-222222222222';

  const createMockNotification = (overrides: Partial<Notification> = {}): Notification => ({
    id: '33333333-3333-3333-3333-333333333333',
    playerId,
    seasonId,
    type: NotificationType.PRODUCTION_COMPLETE,
    title: 'Production Complete',
    body: 'Your rice production has finished.',
    priority: 'NORMAL',
    read: false,
    delivered: false,
    createdAt: new Date('2024-01-15T10:00:00Z'),
    player: {} as any,
    season: {} as any,
    ...overrides,
  });

  beforeEach(() => {
    mockNotificationRepository = {
      create: vi.fn().mockImplementation((data) => ({
        id: '33333333-3333-3333-3333-333333333333',
        createdAt: new Date('2024-01-15T10:00:00Z'),
        ...data,
      })),
      save: vi.fn().mockImplementation((data) =>
        Promise.resolve({
          id: '33333333-3333-3333-3333-333333333333',
          createdAt: new Date('2024-01-15T10:00:00Z'),
          ...data,
        }),
      ),
      find: vi.fn().mockResolvedValue([]),
      findAndCount: vi.fn().mockResolvedValue([[], 0]),
      update: vi.fn().mockResolvedValue({ affected: 1 }),
    };

    service = new NotificationService(
      mockNotificationRepository as Repository<Notification>,
    );
  });

  describe('createNotification', () => {
    it('should persist a new notification with correct fields', async () => {
      const result = await service.createNotification({
        playerId,
        seasonId,
        type: NotificationType.PRODUCTION_COMPLETE,
        title: 'Production Complete',
        body: 'Your rice production has finished.',
        priority: 'HIGH',
      });

      expect(mockNotificationRepository.create).toHaveBeenCalledWith({
        playerId,
        seasonId,
        type: NotificationType.PRODUCTION_COMPLETE,
        title: 'Production Complete',
        body: 'Your rice production has finished.',
        priority: 'HIGH',
        read: false,
        delivered: false,
      });
      expect(mockNotificationRepository.save).toHaveBeenCalled();
      expect(result.id).toBe('33333333-3333-3333-3333-333333333333');
    });

    it('should default priority to NORMAL when not specified', async () => {
      await service.createNotification({
        playerId,
        seasonId,
        type: NotificationType.MARKETPLACE_SALE,
        title: 'Item Sold',
      });

      expect(mockNotificationRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ priority: 'NORMAL' }),
      );
    });

    it('should set body to null when not provided', async () => {
      await service.createNotification({
        playerId,
        seasonId,
        type: NotificationType.EVENT_STARTED,
        title: 'Event Started',
      });

      expect(mockNotificationRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ body: null }),
      );
    });
  });

  describe('getUndelivered', () => {
    it('should query for undelivered notifications ordered by creation time', async () => {
      const notifications = [
        createMockNotification({ id: 'n1', delivered: false }),
        createMockNotification({ id: 'n2', delivered: false }),
      ];
      (mockNotificationRepository.find as ReturnType<typeof vi.fn>).mockResolvedValue(notifications);

      const result = await service.getUndelivered(playerId);

      expect(mockNotificationRepository.find).toHaveBeenCalledWith({
        where: { playerId, delivered: false },
        order: { createdAt: 'ASC' },
      });
      expect(result).toHaveLength(2);
    });

    it('should return empty array when no undelivered notifications exist', async () => {
      (mockNotificationRepository.find as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await service.getUndelivered(playerId);

      expect(result).toHaveLength(0);
    });
  });

  describe('getUnread', () => {
    it('should return unread notifications with pagination', async () => {
      const notifications = [createMockNotification()];
      (mockNotificationRepository.findAndCount as ReturnType<typeof vi.fn>).mockResolvedValue([
        notifications,
        1,
      ]);

      const result = await service.getUnread(playerId, 10, 0);

      expect(mockNotificationRepository.findAndCount).toHaveBeenCalledWith({
        where: { playerId, read: false },
        order: { createdAt: 'DESC' },
        take: 10,
        skip: 0,
      });
      expect(result.notifications).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('should use default limit and offset', async () => {
      (mockNotificationRepository.findAndCount as ReturnType<typeof vi.fn>).mockResolvedValue([[], 0]);

      await service.getUnread(playerId);

      expect(mockNotificationRepository.findAndCount).toHaveBeenCalledWith({
        where: { playerId, read: false },
        order: { createdAt: 'DESC' },
        take: 50,
        skip: 0,
      });
    });
  });

  describe('markAsDelivered', () => {
    it('should update the delivered flag for specified IDs', async () => {
      const ids = ['n1', 'n2', 'n3'];

      await service.markAsDelivered(ids);

      expect(mockNotificationRepository.update).toHaveBeenCalledWith(
        { id: In(ids) },
        { delivered: true },
      );
    });

    it('should not issue update when ids array is empty', async () => {
      await service.markAsDelivered([]);

      expect(mockNotificationRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('markAsRead', () => {
    it('should update read flag only for the specified player', async () => {
      const ids = ['n1', 'n2'];

      await service.markAsRead(playerId, ids);

      expect(mockNotificationRepository.update).toHaveBeenCalledWith(
        { id: In(ids), playerId },
        { read: true },
      );
    });

    it('should not issue update when ids array is empty', async () => {
      await service.markAsRead(playerId, []);

      expect(mockNotificationRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('getAll', () => {
    it('should return all notifications for a player with pagination', async () => {
      const notifications = [createMockNotification()];
      (mockNotificationRepository.findAndCount as ReturnType<typeof vi.fn>).mockResolvedValue([
        notifications,
        15,
      ]);

      const result = await service.getAll(playerId, 10, 5);

      expect(mockNotificationRepository.findAndCount).toHaveBeenCalledWith({
        where: { playerId },
        order: { createdAt: 'DESC' },
        take: 10,
        skip: 5,
      });
      expect(result.notifications).toHaveLength(1);
      expect(result.total).toBe(15);
    });
  });
});
