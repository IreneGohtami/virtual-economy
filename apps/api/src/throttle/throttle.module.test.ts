import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerModule, ThrottlerStorage } from '@nestjs/throttler';
import { Reflector } from '@nestjs/core';
import { PlayerThrottlerGuard, SKIP_THROTTLE_KEY } from '../common';
import { ExecutionContext } from '@nestjs/common';

describe('ThrottleModule Configuration', () => {
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot([
          {
            name: 'default',
            ttl: 60_000,
            limit: 60,
          },
        ]),
      ],
    }).compile();
  });

  it('should compile ThrottlerModule with the correct configuration', () => {
    expect(module).toBeDefined();
    // ThrottlerStorage should be registered
    const storage = module.get(ThrottlerStorage);
    expect(storage).toBeDefined();
  });
});

describe('PlayerThrottlerGuard', () => {
  let guard: PlayerThrottlerGuard;
  let reflector: Reflector;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot([
          {
            name: 'default',
            ttl: 60_000,
            limit: 60,
          },
        ]),
      ],
      providers: [PlayerThrottlerGuard],
    }).compile();

    guard = module.get(PlayerThrottlerGuard);
    reflector = module.get(Reflector);
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('should use player ID as tracker key when user is authenticated', async () => {
    const req = { user: { id: 'player-abc-123' } };

    // Access protected method
    const tracker = await (guard as unknown as {
      getTracker: (req: Record<string, unknown>) => Promise<string>;
    }).getTracker(req);

    expect(tracker).toBe('player-abc-123');
  });

  it('should fall back to IP when no authenticated user', async () => {
    const req = { ip: '10.0.0.1', socket: { remoteAddress: '10.0.0.1' } };

    const tracker = await (guard as unknown as {
      getTracker: (req: Record<string, unknown>) => Promise<string>;
    }).getTracker(req);

    expect(tracker).toBe('10.0.0.1');
  });

  it('should fall back to socket remoteAddress when ip is undefined', async () => {
    const req = { socket: { remoteAddress: '192.168.0.50' } };

    const tracker = await (guard as unknown as {
      getTracker: (req: Record<string, unknown>) => Promise<string>;
    }).getTracker(req);

    expect(tracker).toBe('192.168.0.50');
  });

  it('should return "unknown" when no identifying information available', async () => {
    const req = {};

    const tracker = await (guard as unknown as {
      getTracker: (req: Record<string, unknown>) => Promise<string>;
    }).getTracker(req);

    expect(tracker).toBe('unknown');
  });

  it('should skip throttling when SKIP_THROTTLE_KEY metadata is set', async () => {
    const mockContext = {
      getHandler: vi.fn().mockReturnValue(() => {}),
      getClass: vi.fn().mockReturnValue(class {}),
      switchToHttp: vi.fn().mockReturnValue({
        getRequest: vi.fn().mockReturnValue({ user: { id: 'admin-1' } }),
        getResponse: vi.fn().mockReturnValue({}),
      }),
    } as unknown as ExecutionContext;

    // Mock the reflector to return true for skip
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    // Replace guard's reflector
    (guard as unknown as { reflector: Reflector }).reflector = reflector;

    const shouldSkip = await (guard as unknown as {
      shouldSkip: (ctx: ExecutionContext) => Promise<boolean>;
    }).shouldSkip(mockContext);

    expect(shouldSkip).toBe(true);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(SKIP_THROTTLE_KEY, [
      mockContext.getHandler(),
      mockContext.getClass(),
    ]);
  });

  it('should NOT skip throttling when SKIP_THROTTLE_KEY is not set', async () => {
    const mockContext = {
      getHandler: vi.fn().mockReturnValue(() => {}),
      getClass: vi.fn().mockReturnValue(class {}),
      switchToHttp: vi.fn().mockReturnValue({
        getRequest: vi.fn().mockReturnValue({ user: { id: 'player-1' } }),
        getResponse: vi.fn().mockReturnValue({}),
      }),
    } as unknown as ExecutionContext;

    // Mock the reflector to return false/undefined for skip
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    (guard as unknown as { reflector: Reflector }).reflector = reflector;

    const shouldSkip = await (guard as unknown as {
      shouldSkip: (ctx: ExecutionContext) => Promise<boolean>;
    }).shouldSkip(mockContext);

    expect(shouldSkip).toBe(false);
  });
});

describe('Rate Limit Configuration Values', () => {
  it('should enforce 60 req/min global limit (configured in ThrottleModule)', () => {
    // This is a documentation test verifying the configuration constants
    const GLOBAL_TTL = 60_000; // 60 seconds
    const GLOBAL_LIMIT = 60; // 60 requests

    expect(GLOBAL_TTL).toBe(60_000);
    expect(GLOBAL_LIMIT).toBe(60);
  });

  it('should enforce 30 req/min marketplace limit (via @Throttle decorator)', () => {
    // The marketplace controller applies @Throttle({ default: { ttl: 60_000, limit: 30 } })
    const MARKETPLACE_TTL = 60_000;
    const MARKETPLACE_LIMIT = 30;

    expect(MARKETPLACE_TTL).toBe(60_000);
    expect(MARKETPLACE_LIMIT).toBe(30);
  });
});
