import { SetMetadata } from '@nestjs/common';
import { SKIP_THROTTLE_KEY } from '../guards/player-throttler.guard';

/**
 * Decorator to skip rate limiting on specific routes or controllers.
 * Used for admin endpoints that are already protected by IP whitelist.
 */
export const SkipThrottle = () => SetMetadata(SKIP_THROTTLE_KEY, true);
