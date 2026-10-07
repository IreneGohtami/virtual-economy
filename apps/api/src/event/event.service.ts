import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SeasonStatus, EventType, CommodityCategory } from '@sea-commodity-tycoon/shared-types';
import { GameEvent } from '../entities/game-event.entity';
import { Season } from '../entities/season.entity';
import { TriggerEventDto } from './dto';

/** Event status constants (not a separate enum since entity uses string) */
export const EVENT_STATUS = {
  SCHEDULED: 'SCHEDULED',
  ACTIVE: 'ACTIVE',
  ENDED: 'ENDED',
} as const;

/** Predefined event templates with default modifiers */
export const EVENT_TEMPLATES: Record<EventType, {
  name: string;
  description: string;
  affectedCategories: CommodityCategory[];
  productionModifier: number;
  demandModifier: number;
  priceModifier: number;
}> = {
  [EventType.FLOOD]: {
    name: 'Flood',
    description: 'Severe flooding reduces agricultural production by 30%',
    affectedCategories: [CommodityCategory.AGRICULTURE],
    productionModifier: -0.30,
    demandModifier: 0,
    priceModifier: 0,
  },
  [EventType.LIVESTOCK_DISEASE]: {
    name: 'Livestock Disease',
    description: 'A disease outbreak reduces livestock production by 40%',
    affectedCategories: [CommodityCategory.LIVESTOCK],
    productionModifier: -0.40,
    demandModifier: 0,
    priceModifier: 0,
  },
  [EventType.STORM]: {
    name: 'Storm',
    description: 'A severe storm reduces fishery production by 30%',
    affectedCategories: [CommodityCategory.FISHERY],
    productionModifier: -0.30,
    demandModifier: 0,
    priceModifier: 0,
  },
  [EventType.FOREST_FIRE]: {
    name: 'Forest Fire',
    description: 'Forest fires reduce forestry production by 50%',
    affectedCategories: [CommodityCategory.FORESTRY],
    productionModifier: -0.50,
    demandModifier: 0,
    priceModifier: 0,
  },
  [EventType.EXCELLENT_HARVEST]: {
    name: 'Excellent Harvest',
    description: 'Favorable weather boosts agricultural production by 20%',
    affectedCategories: [CommodityCategory.AGRICULTURE],
    productionModifier: 0.20,
    demandModifier: 0,
    priceModifier: 0,
  },
  [EventType.INFRASTRUCTURE_PROGRAM]: {
    name: 'Infrastructure Program',
    description: 'Government program increases demand for metals by 30%',
    affectedCategories: [CommodityCategory.METAL],
    productionModifier: 0,
    demandModifier: 0.30,
    priceModifier: 0,
  },
  [EventType.EV_INCENTIVE]: {
    name: 'EV Incentive',
    description: 'EV subsidies increase demand for metal and energy by 40%',
    affectedCategories: [CommodityCategory.METAL, CommodityCategory.ENERGY],
    productionModifier: 0,
    demandModifier: 0.40,
    priceModifier: 0,
  },
};

/** Cumulative modifiers for a given category from all active events */
export interface CategoryModifiers {
  productionModifier: number;
  demandModifier: number;
  priceModifier: number;
}

/** Sanitized event response */
export interface GameEventResponse {
  id: string;
  seasonId: string;
  eventType: string;
  name: string;
  description: string | null;
  startsAt: Date;
  endsAt: Date;
  affectedCategories: string[];
  productionModifier: number;
  demandModifier: number;
  priceModifier: number;
  status: string;
}

@Injectable()
export class EventService {
  private readonly logger = new Logger(EventService.name);

  constructor(
    @InjectRepository(GameEvent)
    private readonly gameEventRepository: Repository<GameEvent>,
    @InjectRepository(Season)
    private readonly seasonRepository: Repository<Season>,
  ) {}

  /**
   * Trigger a new event (admin action).
   * Creates the event record and sets it to ACTIVE immediately.
   * Logs the event start (WebSocket broadcast will be wired in integration phase).
   */
  async triggerEvent(dto: TriggerEventDto): Promise<GameEventResponse> {
    const season = await this.getActiveSeason();

    const template = EVENT_TEMPLATES[dto.eventType];
    const now = new Date();
    const endsAt = new Date(now.getTime() + dto.durationMinutes * 60 * 1000);

    const event = this.gameEventRepository.create({
      seasonId: season.id,
      eventType: dto.eventType,
      name: dto.name || template.name,
      description: dto.description ?? template.description,
      startsAt: now,
      endsAt,
      affectedCategories: dto.affectedCategories.length > 0
        ? dto.affectedCategories
        : template.affectedCategories,
      productionModifier: (dto.productionModifier ?? template.productionModifier).toFixed(2),
      demandModifier: (dto.demandModifier ?? template.demandModifier).toFixed(2),
      priceModifier: (dto.priceModifier ?? template.priceModifier).toFixed(2),
      status: EVENT_STATUS.ACTIVE,
      metadata: {},
    });

    const saved = await this.gameEventRepository.save(event);

    this.logger.log(
      `Event triggered: ${saved.name} (${saved.eventType}) affecting [${saved.affectedCategories.join(', ')}] ` +
      `until ${saved.endsAt.toISOString()}`,
    );

    // TODO: Broadcast via WebSocket (event.started) to all players
    // This will be wired during the Notification module integration (Task 19.1)

    return this.toResponse(saved);
  }

  /**
   * End an active event. Sets status to ENDED and removes its modifiers from effect.
   */
  async endEvent(eventId: string): Promise<GameEventResponse> {
    const event = await this.gameEventRepository.findOne({
      where: { id: eventId },
    });

    if (!event) {
      throw new NotFoundException(`Event with ID ${eventId} not found`);
    }

    if (event.status === EVENT_STATUS.ENDED) {
      throw new BadRequestException(`Event ${eventId} has already ended`);
    }

    event.status = EVENT_STATUS.ENDED;
    event.endsAt = new Date(); // Mark actual end time
    const saved = await this.gameEventRepository.save(event);

    this.logger.log(
      `Event ended: ${saved.name} (${saved.eventType}) - modifiers removed`,
    );

    // TODO: Broadcast via WebSocket (event.ended) to all players

    return this.toResponse(saved);
  }

  /**
   * Get all currently active events for the active season.
   */
  async getActiveEvents(): Promise<GameEventResponse[]> {
    const season = await this.getActiveSeason();

    const events = await this.gameEventRepository.find({
      where: { seasonId: season.id, status: EVENT_STATUS.ACTIVE },
      order: { startsAt: 'DESC' },
    });

    return events.map((e) => this.toResponse(e));
  }

  /**
   * Get cumulative modifiers for a specific category from all active events.
   * Modifiers are additive: if two events each give -30% production,
   * the total production modifier is -0.60.
   */
  async getActiveModifiers(category: string): Promise<CategoryModifiers> {
    const season = await this.getActiveSeason();

    const events = await this.gameEventRepository
      .createQueryBuilder('event')
      .where('event.season_id = :seasonId', { seasonId: season.id })
      .andWhere('event.status = :status', { status: EVENT_STATUS.ACTIVE })
      .andWhere(':category = ANY(event.affected_categories)', { category })
      .getMany();

    let productionModifier = 0;
    let demandModifier = 0;
    let priceModifier = 0;

    for (const event of events) {
      productionModifier += parseFloat(event.productionModifier ?? '0');
      demandModifier += parseFloat(event.demandModifier ?? '0');
      priceModifier += parseFloat(event.priceModifier ?? '0');
    }

    return { productionModifier, demandModifier, priceModifier };
  }

  /**
   * Get scheduled events (future events not yet active) for the active season.
   */
  async getScheduledEvents(): Promise<GameEventResponse[]> {
    const season = await this.getActiveSeason();

    const events = await this.gameEventRepository.find({
      where: { seasonId: season.id, status: EVENT_STATUS.SCHEDULED },
      order: { startsAt: 'ASC' },
    });

    return events.map((e) => this.toResponse(e));
  }

  /**
   * Get a single event by ID.
   */
  async getEventById(eventId: string): Promise<GameEventResponse> {
    const event = await this.gameEventRepository.findOne({
      where: { id: eventId },
    });

    if (!event) {
      throw new NotFoundException(`Event with ID ${eventId} not found`);
    }

    return this.toResponse(event);
  }

  /**
   * Get the active season or throw.
   */
  private async getActiveSeason(): Promise<Season> {
    const season = await this.seasonRepository.findOne({
      where: { status: SeasonStatus.ACTIVE },
    });

    if (!season) {
      throw new NotFoundException('No active season found');
    }

    return season;
  }

  /**
   * Convert entity to response format.
   */
  private toResponse(event: GameEvent): GameEventResponse {
    return {
      id: event.id,
      seasonId: event.seasonId,
      eventType: event.eventType,
      name: event.name,
      description: event.description,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      affectedCategories: event.affectedCategories,
      productionModifier: parseFloat(event.productionModifier ?? '0'),
      demandModifier: parseFloat(event.demandModifier ?? '0'),
      priceModifier: parseFloat(event.priceModifier ?? '0'),
      status: event.status,
    };
  }
}
