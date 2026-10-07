import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Server, Socket } from 'socket.io';
import { NotificationService } from './notification.service';
import { NotificationType } from '@sea-commodity-tycoon/shared-types';

/** Channels players can subscribe to */
export const CHANNELS = {
  GLOBAL_ANNOUNCEMENTS: 'global:announcements',
  PLAYER_NOTIFICATIONS: (playerId: string) => `player:${playerId}:notifications`,
  MARKETPLACE_UPDATES: (commodity: string) => `marketplace:${commodity}:updates`,
  SEASON_EVENTS: 'season:events',
} as const;

/** Heartbeat configuration */
const HEARTBEAT_INTERVAL_MS = 30_000; // 30 seconds
const MAX_MISSED_HEARTBEATS = 3;

export interface SocketData {
  playerId: string;
  email: string;
  lastHeartbeat: number;
  missedHeartbeats: number;
}

function getSocketData(client: Socket): SocketData | undefined {
  return client.data as SocketData | undefined;
}

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
  namespace: '/ws',
  transports: ['websocket', 'polling'],
})
export class NotificationGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(NotificationGateway.name);
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private connectedPlayers = new Map<string, Set<string>>(); // playerId -> Set<socketId>

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly notificationService: NotificationService,
  ) {}

  afterInit(_server: Server): void {
    this.logger.log('WebSocket Gateway initialized');
    this.startHeartbeatMonitor();
  }

  /**
   * Authenticate connection via JWT token in handshake.
   * Token can be in auth.token or query.token.
   */
  async handleConnection(client: Socket): Promise<void> {
    try {
      const token =
        client.handshake.auth?.token ||
        client.handshake.query?.token;

      if (!token) {
        this.logger.warn(`Connection rejected: no token provided (${client.id})`);
        client.disconnect(true);
        return;
      }

      const secret = this.configService.get<string>('jwt.secret');
      const payload = this.jwtService.verify(token as string, { secret });

      if (!payload?.sub) {
        this.logger.warn(`Connection rejected: invalid token (${client.id})`);
        client.disconnect(true);
        return;
      }

      // Attach player data to socket
      const socketData: SocketData = {
        playerId: payload.sub,
        email: payload.email,
        lastHeartbeat: Date.now(),
        missedHeartbeats: 0,
      };
      client.data = socketData;

      // Auto-subscribe to player's personal notification channel
      const playerChannel = CHANNELS.PLAYER_NOTIFICATIONS(payload.sub);
      await client.join(playerChannel);

      // Track connected sockets for this player
      if (!this.connectedPlayers.has(payload.sub)) {
        this.connectedPlayers.set(payload.sub, new Set());
      }
      this.connectedPlayers.get(payload.sub)!.add(client.id);

      this.logger.log(
        `Player ${payload.sub} connected (socket: ${client.id})`,
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(
        `Connection rejected: token verification failed (${client.id}) - ${message}`,
      );
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    const data = getSocketData(client);
    const playerId = data?.playerId;
    if (playerId) {
      const sockets = this.connectedPlayers.get(playerId);
      if (sockets) {
        sockets.delete(client.id);
        if (sockets.size === 0) {
          this.connectedPlayers.delete(playerId);
        }
      }
      this.logger.log(`Player ${playerId} disconnected (socket: ${client.id})`);
    }
  }

  /**
   * Client subscribes to additional channels.
   * Allowed patterns: marketplace:{commodity}:updates, global:announcements, season:events
   */
  @SubscribeMessage('subscribe')
  async handleSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { channels: string[] },
  ): Promise<{ success: boolean; subscribedTo: string[] }> {
    const socketData = getSocketData(client);
    if (!socketData?.playerId) {
      return { success: false, subscribedTo: [] };
    }

    const validChannels = (data.channels || []).filter((ch) =>
      this.isValidChannel(ch),
    );

    for (const channel of validChannels) {
      await client.join(channel);
    }

    this.logger.debug(
      `Player ${socketData.playerId} subscribed to: ${validChannels.join(', ')}`,
    );

    return { success: true, subscribedTo: validChannels };
  }

  /**
   * Client unsubscribes from channels.
   */
  @SubscribeMessage('unsubscribe')
  async handleUnsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { channels: string[] },
  ): Promise<{ success: boolean; unsubscribedFrom: string[] }> {
    const socketData = getSocketData(client);
    if (!socketData?.playerId) {
      return { success: false, unsubscribedFrom: [] };
    }

    const playerChannel = CHANNELS.PLAYER_NOTIFICATIONS(socketData.playerId);
    // Prevent unsubscribing from personal channel
    const channels = (data.channels || []).filter(
      (ch) => ch !== playerChannel,
    );

    for (const channel of channels) {
      await client.leave(channel);
    }

    this.logger.debug(
      `Player ${socketData.playerId} unsubscribed from: ${channels.join(', ')}`,
    );

    return { success: true, unsubscribedFrom: channels };
  }

  /**
   * Client heartbeat to keep connection alive.
   */
  @SubscribeMessage('heartbeat')
  handleHeartbeat(
    @ConnectedSocket() client: Socket,
    @MessageBody() _data: { timestamp: number },
  ): { timestamp: number } {
    const socketData = getSocketData(client);
    if (socketData) {
      socketData.lastHeartbeat = Date.now();
      socketData.missedHeartbeats = 0;
    }
    return { timestamp: Date.now() };
  }

  // ─── Public API for other modules ──────────────────────────────────────────

  /**
   * Send an event to a specific player. If the player is online,
   * delivers via WebSocket. If not, the notification persists for offline fetch.
   * Returns true if WebSocket delivery was successful.
   */
  async sendToPlayer(
    playerId: string,
    event: string,
    payload: Record<string, unknown>,
  ): Promise<boolean> {
    const channel = CHANNELS.PLAYER_NOTIFICATIONS(playerId);
    const sockets = this.connectedPlayers.get(playerId);

    if (sockets && sockets.size > 0) {
      this.server.to(channel).emit(event, payload);
      return true;
    }

    return false;
  }

  /**
   * Create a notification, persist it, and attempt WebSocket delivery.
   * Marks as delivered if the player is currently connected.
   */
  async sendNotification(
    playerId: string,
    seasonId: string,
    type: NotificationType,
    title: string,
    body: string | null,
    priority: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL' = 'NORMAL',
  ): Promise<void> {
    // Persist first
    const notification = await this.notificationService.createNotification({
      playerId,
      seasonId,
      type,
      title,
      body,
      priority,
    });

    // Attempt WebSocket delivery
    const delivered = await this.sendToPlayer(playerId, 'notification', {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      priority: notification.priority,
      createdAt: notification.createdAt,
    });

    if (delivered) {
      await this.notificationService.markAsDelivered([notification.id]);
    }
  }

  /**
   * Broadcast an event to all connected clients (global announcements).
   */
  broadcast(event: string, payload: Record<string, unknown>): void {
    this.server.to(CHANNELS.GLOBAL_ANNOUNCEMENTS).emit(event, payload);
  }

  /**
   * Emit an event to a specific channel (e.g., marketplace updates).
   */
  emitToChannel(channel: string, event: string, payload: Record<string, unknown>): void {
    this.server.to(channel).emit(event, payload);
  }

  /**
   * Check if a player is currently connected.
   */
  isPlayerOnline(playerId: string): boolean {
    const sockets = this.connectedPlayers.get(playerId);
    return sockets !== undefined && sockets.size > 0;
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  /**
   * Validate that a channel name matches an allowed pattern.
   */
  private isValidChannel(channel: string): boolean {
    if (channel === CHANNELS.GLOBAL_ANNOUNCEMENTS) return true;
    if (channel === CHANNELS.SEASON_EVENTS) return true;
    if (channel.startsWith('marketplace:') && channel.endsWith(':updates')) return true;
    // Players cannot subscribe to other players' notification channels
    return false;
  }

  /**
   * Periodically check for dead connections (missed heartbeats).
   */
  private startHeartbeatMonitor(): void {
    this.heartbeatTimer = setInterval(() => {
      if (!this.server) return;

      const now = Date.now();
      const sockets = this.server.sockets?.sockets;
      if (!sockets) return;

      for (const [_socketId, socket] of sockets) {
        const data = getSocketData(socket);
        if (!data?.playerId) continue;

        const elapsed = now - data.lastHeartbeat;
        if (elapsed > HEARTBEAT_INTERVAL_MS) {
          data.missedHeartbeats++;

          if (data.missedHeartbeats >= MAX_MISSED_HEARTBEATS) {
            this.logger.warn(
              `Disconnecting player ${data.playerId} (socket: ${socket.id}) - ${MAX_MISSED_HEARTBEATS} missed heartbeats`,
            );
            socket.disconnect(true);
          }
        }
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  /**
   * Cleanup on module destroy.
   */
  onModuleDestroy(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}
