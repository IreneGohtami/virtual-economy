import { Injectable, ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerException } from '@nestjs/throttler';
import { Reflector } from '@nestjs/core';
import { Logger } from '@nestjs/common';

export const SKIP_THROTTLE_KEY = 'skipThrottle';

/**
 * Custom ThrottlerGuard that uses the authenticated player's ID as the
 * rate-limit key instead of IP address. This ensures per-player fairness
 * and prevents abuse even behind shared IPs / proxies.
 *
 * Skips throttling for admin-guarded routes (IP-whitelisted).
 */
@Injectable()
export class PlayerThrottlerGuard extends ThrottlerGuard {
  private readonly throttleLogger = new Logger('RateLimit');

  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    // Use authenticated player ID if available, fall back to IP
    const user = req.user as { id?: string } | undefined;
    if (user?.id) {
      return user.id;
    }
    // Fallback to IP for unauthenticated endpoints (login, register)
    const request = req as { ip?: string; socket?: { remoteAddress?: string } };
    return request.ip || request.socket?.remoteAddress || 'unknown';
  }

  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    // Skip throttling for routes with AdminGuard (handled by IP whitelist)
    const reflector = this.reflector as Reflector;
    const skipThrottle = reflector.getAllAndOverride<boolean>(SKIP_THROTTLE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skipThrottle) {
      return true;
    }
    return false;
  }

  protected async throwThrottlingException(
    context: ExecutionContext,
  ): Promise<void> {
    const request = context.switchToHttp().getRequest();
    const user = request.user as { id?: string } | undefined;
    const playerId = user?.id || 'unauthenticated';
    const ip = request.ip || request.socket?.remoteAddress || 'unknown';

    this.throttleLogger.warn(
      `Rate limit exceeded | player=${playerId} ip=${ip} path=${request.method} ${request.url}`,
    );

    throw new ThrottlerException('Too many requests. Please slow down.');
  }
}
