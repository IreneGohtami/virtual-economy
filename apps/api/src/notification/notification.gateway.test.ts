import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationGateway, CHANNELS } from './notification.gateway';
import { NotificationService } from './notification.service';
import { NotificationType } from '@sea-commodity-tycoon/shared-types';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Server, Socket } from 'socket.io';

describe('NotificationGateway', () => {
  let gateway: NotificationGateway;
  let mockJwtService: Partial<JwtService>;
  let mockConfigService: Partial<ConfigService>;
  let mockNotificationService: Partial<NotificationService>;
  let mockServer: Partial<Server>;

  const playerId = '11111111-1111-1111-1111-111111111111';
  const seasonId = '22222222-2222-2222-2222-222222222222';

  beforeEach(() => {
    mockJwtService = {
      verify: vi.fn().mockReturnValue({ sub: playerId, email: 'test@example.com' }),
    };

    mockConfigService = {
      get: vi.fn().mockReturnValue('test-secret'),
    };

    mockNotificationService = {
      createNotification: vi.fn().mockResolvedValue({
        id: 'notif-1',
        playerId,
        seasonId,
        type: NotificationType.PRODUCTION_COMPLETE,
        title: 'Test',
        body: 'Test body',
        priority: 'NORMAL',
        read: false,
        delivered: false,
        createdAt: new Date(),
      }),
      markAsDelivered: vi.fn().mockResolvedValue(undefined),
    };

    mockServer = {
      to: vi.fn().mockReturnValue({
        emit: vi.fn(),
      }),
      sockets: {
        sockets: new Map(),
      } as any,
    };

    gateway = new NotificationGateway(
      mockJwtService as JwtService,
      mockConfigService as ConfigService,
      mockNotificationService as NotificationService,
    );
    (gateway as any).server = mockServer;
    (gateway as any).connectedPlayers = new Map();
  });

  describe('handleConnection', () => {
    it('should authenticate and setup player on valid token', async () => {
      const mockClient = {
        id: 'socket-1',
        handshake: { auth: { token: 'valid-token' }, query: {} },
        data: {} as any,
        join: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn(),
      } as unknown as Socket;

      await gateway.handleConnection(mockClient as any);

      expect(mockJwtService.verify).toHaveBeenCalledWith('valid-token', { secret: 'test-secret' });
      expect((mockClient as any).data.playerId).toBe(playerId);
      expect(mockClient.join).toHaveBeenCalledWith(`player:${playerId}:notifications`);
    });

    it('should disconnect client when no token is provided', async () => {
      const mockClient = {
        id: 'socket-2',
        handshake: { auth: {}, query: {} },
        data: {} as any,
        join: vi.fn(),
        disconnect: vi.fn(),
      } as unknown as Socket;

      await gateway.handleConnection(mockClient as any);

      expect(mockClient.disconnect).toHaveBeenCalledWith(true);
    });

    it('should disconnect client when token verification fails', async () => {
      (mockJwtService.verify as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('Invalid token');
      });

      const mockClient = {
        id: 'socket-3',
        handshake: { auth: { token: 'bad-token' }, query: {} },
        data: {} as any,
        join: vi.fn(),
        disconnect: vi.fn(),
      } as unknown as Socket;

      await gateway.handleConnection(mockClient as any);

      expect(mockClient.disconnect).toHaveBeenCalledWith(true);
    });

    it('should use query token if auth token is absent', async () => {
      const mockClient = {
        id: 'socket-4',
        handshake: { auth: {}, query: { token: 'query-token' } },
        data: {} as any,
        join: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn(),
      } as unknown as Socket;

      await gateway.handleConnection(mockClient as any);

      expect(mockJwtService.verify).toHaveBeenCalledWith('query-token', { secret: 'test-secret' });
      expect((mockClient as any).data.playerId).toBe(playerId);
    });
  });

  describe('handleDisconnect', () => {
    it('should remove player socket tracking on disconnect', () => {
      const socketSet = new Set(['socket-1']);
      (gateway as any).connectedPlayers.set(playerId, socketSet);

      const mockClient = {
        id: 'socket-1',
        data: { playerId },
      } as any;

      gateway.handleDisconnect(mockClient);

      expect((gateway as any).connectedPlayers.has(playerId)).toBe(false);
    });

    it('should keep player in map if other sockets remain', () => {
      const socketSet = new Set(['socket-1', 'socket-2']);
      (gateway as any).connectedPlayers.set(playerId, socketSet);

      const mockClient = {
        id: 'socket-1',
        data: { playerId },
      } as any;

      gateway.handleDisconnect(mockClient);

      expect((gateway as any).connectedPlayers.get(playerId)?.size).toBe(1);
      expect((gateway as any).connectedPlayers.get(playerId)?.has('socket-2')).toBe(true);
    });
  });

  describe('handleSubscribe', () => {
    it('should allow subscribing to valid channels', async () => {
      const mockClient = {
        id: 'socket-1',
        data: { playerId },
        join: vi.fn().mockResolvedValue(undefined),
      } as any;

      const result = await gateway.handleSubscribe(mockClient, {
        channels: ['global:announcements', 'marketplace:rice:updates', 'season:events'],
      });

      expect(result.success).toBe(true);
      expect(result.subscribedTo).toHaveLength(3);
      expect(mockClient.join).toHaveBeenCalledTimes(3);
    });

    it('should filter out invalid channel names', async () => {
      const mockClient = {
        id: 'socket-1',
        data: { playerId },
        join: vi.fn().mockResolvedValue(undefined),
      } as any;

      const result = await gateway.handleSubscribe(mockClient, {
        channels: ['global:announcements', 'player:other-id:notifications', 'invalid-channel'],
      });

      expect(result.success).toBe(true);
      expect(result.subscribedTo).toEqual(['global:announcements']);
      expect(mockClient.join).toHaveBeenCalledTimes(1);
    });

    it('should reject if client is not authenticated', async () => {
      const mockClient = {
        id: 'socket-1',
        data: {},
      } as any;

      const result = await gateway.handleSubscribe(mockClient, {
        channels: ['global:announcements'],
      });

      expect(result.success).toBe(false);
    });
  });

  describe('handleUnsubscribe', () => {
    it('should allow unsubscribing from channels', async () => {
      const mockClient = {
        id: 'socket-1',
        data: { playerId },
        leave: vi.fn().mockResolvedValue(undefined),
      } as any;

      const result = await gateway.handleUnsubscribe(mockClient, {
        channels: ['global:announcements', 'marketplace:rice:updates'],
      });

      expect(result.success).toBe(true);
      expect(result.unsubscribedFrom).toHaveLength(2);
      expect(mockClient.leave).toHaveBeenCalledTimes(2);
    });

    it('should prevent unsubscribing from personal notification channel', async () => {
      const mockClient = {
        id: 'socket-1',
        data: { playerId },
        leave: vi.fn().mockResolvedValue(undefined),
      } as any;

      const result = await gateway.handleUnsubscribe(mockClient, {
        channels: [`player:${playerId}:notifications`],
      });

      expect(result.unsubscribedFrom).toHaveLength(0);
      expect(mockClient.leave).not.toHaveBeenCalled();
    });
  });

  describe('handleHeartbeat', () => {
    it('should update lastHeartbeat and reset missedHeartbeats', () => {
      const mockClient = {
        data: { playerId, lastHeartbeat: 0, missedHeartbeats: 2 },
      } as any;

      const before = Date.now();
      const result = gateway.handleHeartbeat(mockClient, { timestamp: before });

      expect(mockClient.data.missedHeartbeats).toBe(0);
      expect(mockClient.data.lastHeartbeat).toBeGreaterThanOrEqual(before);
      expect(result.timestamp).toBeGreaterThanOrEqual(before);
    });
  });

  describe('sendToPlayer', () => {
    it('should emit event to player channel when player is online', async () => {
      const socketSet = new Set(['socket-1']);
      (gateway as any).connectedPlayers.set(playerId, socketSet);
      const mockEmit = vi.fn();
      (mockServer.to as ReturnType<typeof vi.fn>).mockReturnValue({ emit: mockEmit });

      const result = await gateway.sendToPlayer(playerId, 'production.complete', { jobId: 'j1' });

      expect(result).toBe(true);
      expect(mockServer.to).toHaveBeenCalledWith(`player:${playerId}:notifications`);
      expect(mockEmit).toHaveBeenCalledWith('production.complete', { jobId: 'j1' });
    });

    it('should return false when player is not online', async () => {
      const result = await gateway.sendToPlayer('offline-player', 'notification', { data: 'test' });

      expect(result).toBe(false);
    });
  });

  describe('sendNotification', () => {
    it('should persist and deliver notification when player is online', async () => {
      const socketSet = new Set(['socket-1']);
      (gateway as any).connectedPlayers.set(playerId, socketSet);
      const mockEmit = vi.fn();
      (mockServer.to as ReturnType<typeof vi.fn>).mockReturnValue({ emit: mockEmit });

      await gateway.sendNotification(
        playerId,
        seasonId,
        NotificationType.PRODUCTION_COMPLETE,
        'Production Complete',
        'Your rice is ready.',
        'HIGH',
      );

      expect(mockNotificationService.createNotification).toHaveBeenCalledWith({
        playerId,
        seasonId,
        type: NotificationType.PRODUCTION_COMPLETE,
        title: 'Production Complete',
        body: 'Your rice is ready.',
        priority: 'HIGH',
      });
      expect(mockNotificationService.markAsDelivered).toHaveBeenCalledWith(['notif-1']);
    });

    it('should persist but not mark as delivered when player is offline', async () => {
      await gateway.sendNotification(
        playerId,
        seasonId,
        NotificationType.LOAN_PAYMENT_REMINDER,
        'Payment Due',
        'Your loan payment is due tomorrow.',
      );

      expect(mockNotificationService.createNotification).toHaveBeenCalled();
      expect(mockNotificationService.markAsDelivered).not.toHaveBeenCalled();
    });
  });

  describe('broadcast', () => {
    it('should emit event to global announcements channel', () => {
      const mockEmit = vi.fn();
      (mockServer.to as ReturnType<typeof vi.fn>).mockReturnValue({ emit: mockEmit });

      gateway.broadcast('event.started', { eventId: 'e1', type: 'FLOOD' });

      expect(mockServer.to).toHaveBeenCalledWith('global:announcements');
      expect(mockEmit).toHaveBeenCalledWith('event.started', { eventId: 'e1', type: 'FLOOD' });
    });
  });

  describe('isPlayerOnline', () => {
    it('should return true when player has connected sockets', () => {
      (gateway as any).connectedPlayers.set(playerId, new Set(['socket-1']));
      expect(gateway.isPlayerOnline(playerId)).toBe(true);
    });

    it('should return false when player has no connected sockets', () => {
      expect(gateway.isPlayerOnline('unknown-player')).toBe(false);
    });

    it('should return false when player socket set is empty', () => {
      (gateway as any).connectedPlayers.set(playerId, new Set());
      expect(gateway.isPlayerOnline(playerId)).toBe(false);
    });
  });

  describe('CHANNELS', () => {
    it('should generate correct channel names', () => {
      expect(CHANNELS.GLOBAL_ANNOUNCEMENTS).toBe('global:announcements');
      expect(CHANNELS.SEASON_EVENTS).toBe('season:events');
      expect(CHANNELS.PLAYER_NOTIFICATIONS('p1')).toBe('player:p1:notifications');
      expect(CHANNELS.MARKETPLACE_UPDATES('rice')).toBe('marketplace:rice:updates');
    });
  });
});
