import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GameConfig } from '../entities/game-config.entity';

export interface ConfigUpdateDto {
  value: Record<string, unknown>;
  description?: string;
}

@Injectable()
export class AdminConfigService {
  private readonly logger = new Logger(AdminConfigService.name);

  constructor(
    @InjectRepository(GameConfig)
    private readonly configRepository: Repository<GameConfig>,
  ) {}

  /**
   * Get all game configuration entries.
   */
  async getAll(): Promise<GameConfig[]> {
    return this.configRepository.find({ order: { key: 'ASC' } });
  }

  /**
   * Get a specific configuration by key.
   */
  async getByKey(key: string): Promise<GameConfig> {
    const config = await this.configRepository.findOne({ where: { key } });
    if (!config) {
      throw new NotFoundException(`Config key '${key}' not found`);
    }
    return config;
  }

  /**
   * Upsert a configuration entry.
   */
  async upsert(
    key: string,
    dto: ConfigUpdateDto,
    operatorId: string,
  ): Promise<GameConfig> {
    const existing = await this.configRepository.findOne({ where: { key } });

    if (existing) {
      existing.value = dto.value;
      if (dto.description !== undefined) {
        existing.description = dto.description;
      }
      existing.updatedBy = operatorId;
      existing.updatedAt = new Date();
      const saved = await this.configRepository.save(existing);
      this.logger.log(`Config '${key}' updated by ${operatorId}`);
      return saved;
    }

    const newConfig = this.configRepository.create({
      key,
      value: dto.value,
      description: dto.description ?? null,
      updatedBy: operatorId,
      updatedAt: new Date(),
    });
    const saved = await this.configRepository.save(newConfig);
    this.logger.log(`Config '${key}' created by ${operatorId}`);
    return saved;
  }

  /**
   * Update commodity configuration (base prices, yields, production times).
   */
  async updateCommodityConfig(
    value: Record<string, unknown>,
    operatorId: string,
  ): Promise<GameConfig> {
    return this.upsert(
      'commodities',
      { value, description: 'Commodity base parameters (prices, yields, times)' },
      operatorId,
    );
  }

  /**
   * Update recipe configuration (processing times, inputs, outputs).
   */
  async updateRecipeConfig(
    value: Record<string, unknown>,
    operatorId: string,
  ): Promise<GameConfig> {
    return this.upsert(
      'recipes',
      { value, description: 'Recipe definitions and processing parameters' },
      operatorId,
    );
  }
}
