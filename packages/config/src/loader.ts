import * as fs from 'node:fs';
import * as path from 'node:path';
import { GameConfigSchema } from './schemas.js';
import type { GameConfig } from './types.js';

export class ConfigurationError extends Error {
  constructor(
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

export type ConfigChangeListener = (config: GameConfig) => void;

/**
 * Game configuration loader that validates recipe-config.json against
 * Zod schemas and supports hot-reload on file changes.
 */
export class GameConfigLoader {
  private config: GameConfig | null = null;
  private watcher: fs.FSWatcher | null = null;
  private listeners: Set<ConfigChangeListener> = new Set();
  private configPath: string;

  constructor(configPath?: string) {
    this.configPath =
      configPath ?? path.resolve(process.cwd(), 'recipe-config.json');
  }

  /**
   * Load and validate the configuration file.
   * Throws ConfigurationError if the file cannot be read or validation fails.
   */
  load(): GameConfig {
    const raw = this.readFile();
    const parsed = this.parse(raw);
    this.config = parsed;
    return parsed;
  }

  /**
   * Get the currently loaded configuration.
   * Throws if load() has not been called yet.
   */
  getConfig(): GameConfig {
    if (!this.config) {
      throw new ConfigurationError(
        'Configuration not loaded. Call load() before accessing config.',
      );
    }
    return this.config;
  }

  /**
   * Enable hot-reload: watch the config file for changes and
   * re-validate + update the in-memory config on any modification.
   */
  enableHotReload(): void {
    if (this.watcher) {
      return; // Already watching
    }

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    this.watcher = fs.watch(this.configPath, (eventType) => {
      if (eventType !== 'change') return;

      // Debounce rapid file events (editors often write multiple times)
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        this.reload();
      }, 100);
    });
  }

  /**
   * Disable hot-reload and stop watching the config file.
   */
  disableHotReload(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  /**
   * Register a listener that is called whenever the configuration
   * is successfully reloaded via hot-reload.
   */
  onChange(listener: ConfigChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Attempt to reload the configuration from disk.
   * On validation failure, the previous valid config is preserved
   * and the error is logged to stderr.
   */
  private reload(): void {
    try {
      const raw = this.readFile();
      const parsed = this.parse(raw);
      this.config = parsed;
      this.notifyListeners(parsed);
    } catch (error) {
      // Preserve the last valid config; log but don't crash
      if (error instanceof ConfigurationError) {
        console.error(
          `[config] Hot-reload validation failed: ${error.message}`,
        );
      } else {
        console.error(`[config] Hot-reload error:`, error);
      }
    }
  }

  private readFile(): string {
    try {
      return fs.readFileSync(this.configPath, 'utf-8');
    } catch (error) {
      throw new ConfigurationError(
        `Failed to read configuration file at "${this.configPath}": ${(error as Error).message}`,
      );
    }
  }

  private parse(raw: string): GameConfig {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (error) {
      throw new ConfigurationError(
        `Configuration file is not valid JSON: ${(error as Error).message}`,
      );
    }

    const result = GameConfigSchema.safeParse(json);
    if (!result.success) {
      const issues = result.error.issues
        .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
        .join('\n');
      throw new ConfigurationError(
        `Configuration validation failed:\n${issues}`,
        result.error.issues,
      );
    }

    return result.data;
  }

  private notifyListeners(config: GameConfig): void {
    for (const listener of this.listeners) {
      try {
        listener(config);
      } catch {
        // Don't let listener errors break the reload chain
      }
    }
  }
}
