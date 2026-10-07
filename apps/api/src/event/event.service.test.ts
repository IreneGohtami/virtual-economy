import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventService, EVENT_STATUS, EVENT_TEMPLATES } from './event.service';
import { SeasonStatus, EventType, CommodityCategory } from '@sea-commodity-tycoon/shared-types';
import { Repository } from 'typeorm';
import { GameEvent } from '../entities/game-event.entity';
import { Season } from '../entities/season.entity';
import { TriggerEventDto } from './dto';

describe('EventService', () => {
  let service: EventService;
  let mockGameEventRepository: Partial<Repository<GameEvent>>;
  let mockSeasonRepository: Partial<Repository<Season>>;

  const seasonId = 'season-1111-1111-1111-111111111111';
  const eventId = 'event-2222-2222-2222-222222222222';

  const mockActiveSeason: Partial<Season> = {
    id: seasonId,
    status: SeasonStatus.ACTIVE,
    startsAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
    endsAt: new Date(Date.now() + 25 * 24 * 60 * 60 * 1000),
  };

  const makeEvent = (overrides: Partial<GameEvent> = {}): GameEvent => ({
    id: eventId,
    seasonId,
    eventType: EventType.FLOOD,
    name: 'Flood',
    description: 'Severe flooding',
    startsAt: new Date(),
    endsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    affectedCategories: [CommodityCategory.AGRICULTURE],
    productionModifier: '-0.30',
    demandModifier: '0.00',
    priceModifier: '0.00',
    status: EVENT_STATUS.ACTIVE,
    metadata: {},
    season: mockActiveSeason as Season,
    ...overrides,
  });

  beforeEach(() => {
    mockGameEventRepository = {
      find: vi.fn().mockResolvedValue([]),
      findOne: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation((data) => ({ id: eventId, ...data })),
      save: vi.fn().mockImplementation((data) => Promise.resolve(data)),
      createQueryBuilder: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getMany: vi.fn().mockResolvedValue([]),
      }),
    };

    mockSeasonRepository = {
      findOne: vi.fn().mockResolvedValue(mockActiveSeason),
    };

    service = new EventService(
      mockGameEventRepository as Repository<GameEvent>,
      mockSeasonRepository as Repository<Season>,
    );
  });

  describe('triggerEvent', () => {
    it('should create and activate an event with provided modifiers', async () => {
      const dto: TriggerEventDto = {
        eventType: EventType.FLOOD,
        name: 'Monsoon Flooding',
        description: 'Heavy monsoon rains',
        durationMinutes: 1440,
        affectedCategories: [CommodityCategory.AGRICULTURE],
        productionModifier: -0.30,
        demandModifier: 0,
        priceModifier: 0,
      };

      const result = await service.triggerEvent(dto);

      expect(mockGameEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          seasonId,
          eventType: EventType.FLOOD,
          name: 'Monsoon Flooding',
          description: 'Heavy monsoon rains',
          affectedCategories: [CommodityCategory.AGRICULTURE],
          productionModifier: '-0.30',
          demandModifier: '0.00',
          priceModifier: '0.00',
          status: EVENT_STATUS.ACTIVE,
        }),
      );
      expect(mockGameEventRepository.save).toHaveBeenCalled();
      expect(result.eventType).toBe(EventType.FLOOD);
      expect(result.status).toBe(EVENT_STATUS.ACTIVE);
      expect(result.productionModifier).toBe(-0.30);
    });

    it('should use template defaults when optional fields are not provided', async () => {
      const dto: TriggerEventDto = {
        eventType: EventType.LIVESTOCK_DISEASE,
        name: 'Livestock Disease',
        durationMinutes: 720,
        affectedCategories: [CommodityCategory.LIVESTOCK],
      };

      await service.triggerEvent(dto);

      expect(mockGameEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          productionModifier: '-0.40',
          demandModifier: '0.00',
          priceModifier: '0.00',
        }),
      );
    });

    it('should use template affectedCategories when empty array is provided', async () => {
      const dto: TriggerEventDto = {
        eventType: EventType.EV_INCENTIVE,
        name: 'EV Incentive Program',
        durationMinutes: 2880,
        affectedCategories: [],
        demandModifier: 0.40,
      };

      await service.triggerEvent(dto);

      expect(mockGameEventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          affectedCategories: [CommodityCategory.METAL, CommodityCategory.ENERGY],
          demandModifier: '0.40',
        }),
      );
    });

    it('should set endsAt based on durationMinutes from now', async () => {
      const dto: TriggerEventDto = {
        eventType: EventType.STORM,
        name: 'Tropical Storm',
        durationMinutes: 60,
        affectedCategories: [CommodityCategory.FISHERY],
        productionModifier: -0.30,
      };

      await service.triggerEvent(dto);

      const createCall = (mockGameEventRepository.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const startsAt = new Date(createCall.startsAt).getTime();
      const endsAt = new Date(createCall.endsAt).getTime();
      const diffMinutes = (endsAt - startsAt) / (60 * 1000);

      expect(diffMinutes).toBe(60);
    });

    it('should throw NotFoundException when no active season', async () => {
      mockSeasonRepository.findOne = vi.fn().mockResolvedValue(null);

      const dto: TriggerEventDto = {
        eventType: EventType.FLOOD,
        name: 'Flood',
        durationMinutes: 1440,
        affectedCategories: [CommodityCategory.AGRICULTURE],
      };

      await expect(service.triggerEvent(dto)).rejects.toThrow('No active season found');
    });
  });

  describe('endEvent', () => {
    it('should set event status to ENDED', async () => {
      const event = makeEvent();
      mockGameEventRepository.findOne = vi.fn().mockResolvedValue(event);

      const result = await service.endEvent(eventId);

      expect(event.status).toBe(EVENT_STATUS.ENDED);
      expect(mockGameEventRepository.save).toHaveBeenCalledWith(event);
      expect(result.status).toBe(EVENT_STATUS.ENDED);
    });

    it('should update endsAt to current time', async () => {
      const event = makeEvent();
      const originalEndsAt = event.endsAt;
      mockGameEventRepository.findOne = vi.fn().mockResolvedValue(event);

      await service.endEvent(eventId);

      // endsAt should be updated to approximately now (within 1 second)
      expect(event.endsAt.getTime()).toBeGreaterThanOrEqual(Date.now() - 1000);
      expect(event.endsAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    });

    it('should throw NotFoundException for non-existent event', async () => {
      mockGameEventRepository.findOne = vi.fn().mockResolvedValue(null);

      await expect(service.endEvent('non-existent')).rejects.toThrow(
        'Event with ID non-existent not found',
      );
    });

    it('should throw BadRequestException if event already ended', async () => {
      const event = makeEvent({ status: EVENT_STATUS.ENDED });
      mockGameEventRepository.findOne = vi.fn().mockResolvedValue(event);

      await expect(service.endEvent(eventId)).rejects.toThrow(
        `Event ${eventId} has already ended`,
      );
    });
  });

  describe('getActiveEvents', () => {
    it('should return all active events for the current season', async () => {
      const events = [makeEvent(), makeEvent({ id: 'event-2', eventType: EventType.STORM })];
      mockGameEventRepository.find = vi.fn().mockResolvedValue(events);

      const result = await service.getActiveEvents();

      expect(mockGameEventRepository.find).toHaveBeenCalledWith({
        where: { seasonId, status: EVENT_STATUS.ACTIVE },
        order: { startsAt: 'DESC' },
      });
      expect(result).toHaveLength(2);
    });

    it('should return empty array when no active events', async () => {
      mockGameEventRepository.find = vi.fn().mockResolvedValue([]);

      const result = await service.getActiveEvents();

      expect(result).toEqual([]);
    });

    it('should throw NotFoundException when no active season', async () => {
      mockSeasonRepository.findOne = vi.fn().mockResolvedValue(null);

      await expect(service.getActiveEvents()).rejects.toThrow('No active season found');
    });
  });

  describe('getActiveModifiers', () => {
    it('should return zero modifiers when no active events affect category', async () => {
      const result = await service.getActiveModifiers(CommodityCategory.AGRICULTURE);

      expect(result).toEqual({
        productionModifier: 0,
        demandModifier: 0,
        priceModifier: 0,
      });
    });

    it('should sum modifiers from multiple events affecting the same category', async () => {
      const qbMock = {
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getMany: vi.fn().mockResolvedValue([
          makeEvent({ productionModifier: '-0.30', demandModifier: '0.00', priceModifier: '0.10' }),
          makeEvent({ id: 'event-3', productionModifier: '-0.20', demandModifier: '0.15', priceModifier: '0.00' }),
        ]),
      };
      mockGameEventRepository.createQueryBuilder = vi.fn().mockReturnValue(qbMock);

      const result = await service.getActiveModifiers(CommodityCategory.AGRICULTURE);

      expect(result.productionModifier).toBeCloseTo(-0.50);
      expect(result.demandModifier).toBeCloseTo(0.15);
      expect(result.priceModifier).toBeCloseTo(0.10);
    });

    it('should query with the category parameter', async () => {
      const qbMock = {
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getMany: vi.fn().mockResolvedValue([]),
      };
      mockGameEventRepository.createQueryBuilder = vi.fn().mockReturnValue(qbMock);

      await service.getActiveModifiers(CommodityCategory.METAL);

      expect(qbMock.where).toHaveBeenCalledWith(
        'event.season_id = :seasonId',
        { seasonId },
      );
      expect(qbMock.andWhere).toHaveBeenCalledWith(
        'event.status = :status',
        { status: EVENT_STATUS.ACTIVE },
      );
      expect(qbMock.andWhere).toHaveBeenCalledWith(
        ':category = ANY(event.affected_categories)',
        { category: CommodityCategory.METAL },
      );
    });
  });

  describe('getScheduledEvents', () => {
    it('should return scheduled events ordered by startsAt ascending', async () => {
      const scheduled = [
        makeEvent({ status: EVENT_STATUS.SCHEDULED, startsAt: new Date(Date.now() + 60000) }),
        makeEvent({ id: 'event-4', status: EVENT_STATUS.SCHEDULED, startsAt: new Date(Date.now() + 120000) }),
      ];
      mockGameEventRepository.find = vi.fn().mockResolvedValue(scheduled);

      const result = await service.getScheduledEvents();

      expect(mockGameEventRepository.find).toHaveBeenCalledWith({
        where: { seasonId, status: EVENT_STATUS.SCHEDULED },
        order: { startsAt: 'ASC' },
      });
      expect(result).toHaveLength(2);
    });
  });

  describe('getEventById', () => {
    it('should return event details', async () => {
      const event = makeEvent();
      mockGameEventRepository.findOne = vi.fn().mockResolvedValue(event);

      const result = await service.getEventById(eventId);

      expect(result.id).toBe(eventId);
      expect(result.eventType).toBe(EventType.FLOOD);
      expect(result.productionModifier).toBe(-0.30);
      expect(result.demandModifier).toBe(0);
      expect(result.priceModifier).toBe(0);
    });

    it('should throw NotFoundException for non-existent event', async () => {
      mockGameEventRepository.findOne = vi.fn().mockResolvedValue(null);

      await expect(service.getEventById('missing')).rejects.toThrow(
        'Event with ID missing not found',
      );
    });
  });

  describe('EVENT_TEMPLATES', () => {
    it('should have templates for all EventType values', () => {
      const allTypes = Object.values(EventType);
      for (const type of allTypes) {
        expect(EVENT_TEMPLATES[type]).toBeDefined();
        expect(EVENT_TEMPLATES[type].name).toBeTruthy();
        expect(EVENT_TEMPLATES[type].affectedCategories.length).toBeGreaterThan(0);
      }
    });

    it('FLOOD should reduce agriculture production by 30%', () => {
      const template = EVENT_TEMPLATES[EventType.FLOOD];
      expect(template.affectedCategories).toEqual([CommodityCategory.AGRICULTURE]);
      expect(template.productionModifier).toBe(-0.30);
    });

    it('LIVESTOCK_DISEASE should reduce livestock production by 40%', () => {
      const template = EVENT_TEMPLATES[EventType.LIVESTOCK_DISEASE];
      expect(template.affectedCategories).toEqual([CommodityCategory.LIVESTOCK]);
      expect(template.productionModifier).toBe(-0.40);
    });

    it('STORM should reduce fishery production by 30%', () => {
      const template = EVENT_TEMPLATES[EventType.STORM];
      expect(template.affectedCategories).toEqual([CommodityCategory.FISHERY]);
      expect(template.productionModifier).toBe(-0.30);
    });

    it('FOREST_FIRE should reduce forestry production by 50%', () => {
      const template = EVENT_TEMPLATES[EventType.FOREST_FIRE];
      expect(template.affectedCategories).toEqual([CommodityCategory.FORESTRY]);
      expect(template.productionModifier).toBe(-0.50);
    });

    it('EXCELLENT_HARVEST should boost agriculture production by 20%', () => {
      const template = EVENT_TEMPLATES[EventType.EXCELLENT_HARVEST];
      expect(template.affectedCategories).toEqual([CommodityCategory.AGRICULTURE]);
      expect(template.productionModifier).toBe(0.20);
    });

    it('INFRASTRUCTURE_PROGRAM should boost metal demand by 30%', () => {
      const template = EVENT_TEMPLATES[EventType.INFRASTRUCTURE_PROGRAM];
      expect(template.affectedCategories).toEqual([CommodityCategory.METAL]);
      expect(template.demandModifier).toBe(0.30);
    });

    it('EV_INCENTIVE should boost metal and energy demand by 40%', () => {
      const template = EVENT_TEMPLATES[EventType.EV_INCENTIVE];
      expect(template.affectedCategories).toEqual([CommodityCategory.METAL, CommodityCategory.ENERGY]);
      expect(template.demandModifier).toBe(0.40);
    });
  });
});
