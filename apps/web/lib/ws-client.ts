import { io, Socket } from 'socket.io-client';
import { getTokens } from './api-client';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:3000';
const HEARTBEAT_INTERVAL = 30_000; // 30 seconds
const RECONNECT_DELAY_MAX = 10_000;

type EventHandler = (data: unknown) => void;

class WebSocketClient {
  private socket: Socket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Map<string, Set<EventHandler>>();
  private connected = false;

  connect(): void {
    if (this.socket?.connected) return;

    const { accessToken } = getTokens();
    if (!accessToken) return;

    this.socket = io(WS_URL, {
      path: '/ws',
      auth: { token: accessToken },
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: RECONNECT_DELAY_MAX,
    });

    this.socket.on('connect', () => {
      this.connected = true;
      this.startHeartbeat();
      this.fetchOfflineNotifications();
    });

    this.socket.on('disconnect', () => {
      this.connected = false;
      this.stopHeartbeat();
    });

    this.socket.on('connect_error', (err) => {
      console.error('[WS] Connection error:', err.message);
    });

    // Re-register all listeners on the new socket
    for (const [event, handlers] of this.listeners.entries()) {
      for (const handler of handlers) {
        this.socket.on(event, handler);
      }
    }
  }

  disconnect(): void {
    this.stopHeartbeat();
    this.socket?.disconnect();
    this.socket = null;
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  on(event: string, handler: EventHandler): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);

    if (this.socket) {
      this.socket.on(event, handler);
    }

    // Return unsubscribe function
    return () => {
      this.listeners.get(event)?.delete(handler);
      this.socket?.off(event, handler);
    };
  }

  emit(event: string, data?: unknown): void {
    if (this.socket?.connected) {
      this.socket.emit(event, data);
    }
  }

  subscribe(channel: string): void {
    this.emit('subscribe', { channel });
  }

  unsubscribe(channel: string): void {
    this.emit('unsubscribe', { channel });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.emit('heartbeat', { timestamp: Date.now() });
    }, HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private async fetchOfflineNotifications(): Promise<void> {
    try {
      const { apiRequest } = await import('./api-client');
      const notifications = await apiRequest<unknown[]>('/notifications');
      if (notifications.length > 0) {
        const handlers = this.listeners.get('notification.batch');
        if (handlers) {
          for (const handler of handlers) {
            handler(notifications);
          }
        }
      }
    } catch {
      // Silently ignore - notifications will arrive via WS
    }
  }
}

// Singleton instance
export const wsClient = new WebSocketClient();
