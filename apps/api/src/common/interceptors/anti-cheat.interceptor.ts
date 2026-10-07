import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request } from 'express';

/**
 * AntiCheatInterceptor logs suspicious request patterns for investigation.
 *
 * Detects:
 * - Rapid sequential requests from same player to mutation endpoints
 * - Requests with unusual or impossible field values
 * - State inconsistency responses (403/400 indicating ownership/fund issues)
 *
 * This interceptor does NOT block requests — it only logs for post-hoc analysis.
 * Actual enforcement is handled by per-service validation and the rate limiter.
 */
@Injectable()
export class AntiCheatInterceptor implements NestInterceptor {
  private readonly logger = new Logger('AntiCheat');

  /**
   * Track recent request timestamps per player for burst detection.
   * Key: playerId, Value: array of timestamps (last 10 requests)
   */
  private readonly recentRequests = new Map<string, number[]>();

  private readonly BURST_WINDOW_MS = 5_000; // 5 seconds
  private readonly BURST_THRESHOLD = 15; // >15 requests in 5s is suspicious

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const user = (request as unknown as Record<string, unknown>).user as
      | { id?: string }
      | undefined;
    const playerId = user?.id || 'unauthenticated';
    const { method, url, body } = request;

    // Track burst patterns for mutation endpoints
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
      this.trackBurst(playerId, url);
    }

    // Log suspicious body values (negative amounts, impossibly large quantities)
    if (body && typeof body === 'object') {
      this.checkSuspiciousValues(playerId, url, body as Record<string, unknown>);
    }

    return next.handle().pipe(
      tap({
        error: (err: { status?: number; message?: string }) => {
          // Log state inconsistency errors (ownership/funds/state validation failures)
          if (err.status === 403 || err.status === 400) {
            this.logger.warn(
              `State validation failure | player=${playerId} ` +
                `endpoint=${method} ${url} status=${err.status} ` +
                `message=${err.message}`,
            );
          }
        },
      }),
    );
  }

  private trackBurst(playerId: string, url: string): void {
    const now = Date.now();
    const timestamps = this.recentRequests.get(playerId) || [];

    // Keep only timestamps within the window
    const recent = timestamps.filter((t) => now - t < this.BURST_WINDOW_MS);
    recent.push(now);

    // Only keep last 30 entries to prevent memory bloat
    if (recent.length > 30) {
      recent.splice(0, recent.length - 30);
    }

    this.recentRequests.set(playerId, recent);

    if (recent.length > this.BURST_THRESHOLD) {
      this.logger.warn(
        `Burst detected | player=${playerId} count=${recent.length} ` +
          `window=${this.BURST_WINDOW_MS}ms lastEndpoint=${url}`,
      );
    }

    // Periodic cleanup of stale entries (every ~100 calls)
    if (Math.random() < 0.01) {
      this.cleanupStaleEntries(now);
    }
  }

  private checkSuspiciousValues(
    playerId: string,
    url: string,
    body: Record<string, unknown>,
  ): void {
    // Check for negative quantities or amounts
    for (const [key, value] of Object.entries(body)) {
      if (typeof value === 'number') {
        if (
          (key.includes('quantity') || key.includes('amount')) &&
          value < 0
        ) {
          this.logger.warn(
            `Suspicious value | player=${playerId} endpoint=${url} ` +
              `field=${key} value=${value} (negative)`,
          );
        }
        // Check for impossibly large values
        if (value > 1_000_000_000) {
          this.logger.warn(
            `Suspicious value | player=${playerId} endpoint=${url} ` +
              `field=${key} value=${value} (extremely large)`,
          );
        }
      }
    }
  }

  private cleanupStaleEntries(now: number): void {
    for (const [playerId, timestamps] of this.recentRequests.entries()) {
      const recent = timestamps.filter(
        (t) => now - t < this.BURST_WINDOW_MS * 2,
      );
      if (recent.length === 0) {
        this.recentRequests.delete(playerId);
      } else {
        this.recentRequests.set(playerId, recent);
      }
    }
  }
}
