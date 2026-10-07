import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

/**
 * AdminGuard enforces role-based access with optional IP-whitelist.
 *
 * In development mode (NODE_ENV=development), the guard is bypassed
 * to allow easy local testing of admin endpoints.
 *
 * In production:
 * 1. Request IP checked against ADMIN_IP_WHITELIST
 * 2. User's role must be 'admin' (from JWT payload)
 */
@Injectable()
export class AdminGuard implements CanActivate {
  private readonly logger = new Logger(AdminGuard.name);
  private readonly ipWhitelist: string[];
  private readonly isDev: boolean;

  constructor(private readonly configService: ConfigService) {
    const whitelist = this.configService.get<string>('ADMIN_IP_WHITELIST', '');
    this.ipWhitelist = whitelist
      ? whitelist.split(',').map((ip) => ip.trim())
      : [];
    this.isDev = this.configService.get<string>('NODE_ENV', 'development') === 'development';
  }

  canActivate(context: ExecutionContext): boolean {
    // Skip auth in development mode — any authenticated user can access admin
    if (this.isDev) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const clientIp = request.ip || request.socket.remoteAddress || '';

    // IP whitelist check (if configured)
    if (this.ipWhitelist.length > 0) {
      const isAllowed = this.ipWhitelist.some(
        (allowed) => clientIp === allowed || clientIp.endsWith(allowed),
      );
      if (!isAllowed) {
        this.logger.warn(`Admin access denied for IP: ${clientIp}`);
        throw new ForbiddenException('Access denied: IP not whitelisted');
      }
    }

    // Role check from JWT user payload
    const user = (request as unknown as Record<string, unknown>).user as
      | { role?: string }
      | undefined;
    if (!user || user.role !== 'admin') {
      this.logger.warn(
        `Admin access denied: insufficient role for user`,
      );
      throw new ForbiddenException('Access denied: admin role required');
    }

    return true;
  }
}
