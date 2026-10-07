import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AntiCheatInterceptor } from './anti-cheat.interceptor';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of, throwError, lastValueFrom, firstValueFrom } from 'rxjs';

describe('AntiCheatInterceptor', () => {
  let interceptor: AntiCheatInterceptor;
  let mockLogger: { warn: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    interceptor = new AntiCheatInterceptor();
    mockLogger = { warn: vi.fn() };
    // Replace the logger with our mock
    (interceptor as unknown as { logger: unknown }).logger = mockLogger;
  });

  function createMockContext(overrides: {
    method?: string;
    url?: string;
    user?: { id?: string };
    body?: Record<string, unknown>;
  }): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          method: overrides.method || 'GET',
          url: overrides.url || '/test',
          user: overrides.user || { id: 'player-1' },
          body: overrides.body || {},
          ip: '127.0.0.1',
          socket: { remoteAddress: '127.0.0.1' },
        }),
      }),
      getHandler: vi.fn(),
      getClass: vi.fn(),
    } as unknown as ExecutionContext;
  }

  function createMockCallHandler(response?: unknown): CallHandler {
    return {
      handle: () => of(response || { ok: true }),
    };
  }

  function createErrorCallHandler(error: { status?: number; message?: string }): CallHandler {
    return {
      handle: () => throwError(() => error),
    };
  }

  it('should pass through normal requests without logging', async () => {
    const context = createMockContext({ method: 'GET', url: '/players/me' });
    const handler = createMockCallHandler();

    const value = await firstValueFrom(interceptor.intercept(context, handler));
    expect(value).toEqual({ ok: true });
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('should log state validation failures (403 errors)', async () => {
    const context = createMockContext({
      method: 'POST',
      url: '/factories',
      user: { id: 'player-suspect' },
    });
    const handler = createErrorCallHandler({ status: 403, message: 'Not the owner' });

    await expect(
      firstValueFrom(interceptor.intercept(context, handler)),
    ).rejects.toEqual({ status: 403, message: 'Not the owner' });

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('State validation failure'),
    );
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('player=player-suspect'),
    );
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('status=403'),
    );
  });

  it('should log state validation failures (400 errors)', async () => {
    const context = createMockContext({
      method: 'POST',
      url: '/marketplace/buy',
      user: { id: 'player-broke' },
    });
    const handler = createErrorCallHandler({ status: 400, message: 'Insufficient funds' });

    await expect(
      firstValueFrom(interceptor.intercept(context, handler)),
    ).rejects.toBeDefined();

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('status=400'),
    );
  });

  it('should log suspicious negative quantity values', async () => {
    const context = createMockContext({
      method: 'POST',
      url: '/marketplace/list',
      user: { id: 'player-cheater' },
      body: { quantity: -100, commodityId: 'some-id' },
    });
    const handler = createMockCallHandler();

    await firstValueFrom(interceptor.intercept(context, handler));

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Suspicious value'),
    );
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('negative'),
    );
  });

  it('should log extremely large values', async () => {
    const context = createMockContext({
      method: 'POST',
      url: '/marketplace/buy',
      user: { id: 'player-overflow' },
      body: { quantity: 9_999_999_999 },
    });
    const handler = createMockCallHandler();

    await firstValueFrom(interceptor.intercept(context, handler));

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('extremely large'),
    );
  });

  it('should detect burst patterns from rapid mutations', async () => {
    const playerId = 'burst-player';
    const context = createMockContext({
      method: 'POST',
      url: '/production/start',
      user: { id: playerId },
    });
    const handler = createMockCallHandler();

    // Simulate 16+ rapid requests (above the 15 threshold)
    for (let i = 0; i < 16; i++) {
      await firstValueFrom(interceptor.intercept(context, handler));
    }

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Burst detected'),
    );
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining(`player=${playerId}`),
    );
  });

  it('should not flag burst for GET requests', async () => {
    const context = createMockContext({
      method: 'GET',
      url: '/players/me',
      user: { id: 'reader-player' },
    });
    const handler = createMockCallHandler();

    // Simulate many GET requests
    for (let i = 0; i < 20; i++) {
      await firstValueFrom(interceptor.intercept(context, handler));
    }

    // Should not have logged burst for GET requests
    const burstCalls = mockLogger.warn.mock.calls.filter(
      (call: string[]) => call[0]?.includes('Burst detected'),
    );
    expect(burstCalls).toHaveLength(0);
  });
});
