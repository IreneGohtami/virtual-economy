import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlayerService } from './player.service';
import { NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { LoanStatus, SeasonStatus } from '@sea-commodity-tycoon/shared-types';
import { ObjectLiteral, Repository } from 'typeorm';
import { Player } from '../entities/player.entity';
import { PlayerSeason } from '../entities/player-season.entity';
import { Season } from '../entities/season.entity';
import { MapTile } from '../entities/map-tile.entity';
import { Factory } from '../entities/factory.entity';
import { Inventory } from '../entities/inventory.entity';
import { CurrentPrice } from '../entities/current-price.entity';
import { Loan } from '../entities/loan.entity';

type MockRepository<T extends ObjectLiteral> = Partial<Record<keyof Repository<T>, ReturnType<typeof vi.fn>>>;

describe('PlayerService', () => {
  let service: PlayerService;
  let playerRepo: MockRepository<Player>;
  let playerSeasonRepo: MockRepository<PlayerSeason>;
  let seasonRepo: MockRepository<Season>;
  let mapTileRepo: MockRepository<MapTile>;
  let factoryRepo: MockRepository<Factory>;
  let inventoryRepo: MockRepository<Inventory>;
  let currentPriceRepo: MockRepository<CurrentPrice>;
  let loanRepo: MockRepository<Loan>;

  const playerId = '11111111-1111-1111-1111-111111111111';
  const seasonId = '22222222-2222-2222-2222-222222222222';

  const mockSeason: Partial<Season> = {
    id: seasonId,
    status: SeasonStatus.ACTIVE,
    startsAt: new Date('2024-01-01'),
    endsAt: new Date('2024-01-31'),
  };

  const mockPlayer: Partial<Player> = {
    id: playerId,
    email: 'test@example.com',
    displayName: 'TestPlayer',
    avatarConfig: { skin: 'light' },
    createdAt: new Date('2024-01-01'),
    lastActiveAt: new Date('2024-01-15'),
  };

  const mockPlayerSeason: Partial<PlayerSeason> = {
    id: 'ps-1',
    playerId,
    seasonId,
    specialty: null,
    coins: '1000.00',
    storageCapacity: 500,
    workforceHappiness: '80.00',
  };

  beforeEach(() => {
    playerRepo = {
      findOneBy: vi.fn(),
      save: vi.fn().mockImplementation((entity) => Promise.resolve(entity)),
      update: vi.fn().mockResolvedValue({ affected: 1 }),
    };

    playerSeasonRepo = {
      findOne: vi.fn(),
      save: vi.fn().mockImplementation((entity) => Promise.resolve(entity)),
      create: vi.fn().mockImplementation((data) => data),
      update: vi.fn().mockResolvedValue({ affected: 1 }),
    };

    seasonRepo = {
      findOne: vi.fn(),
    };

    mapTileRepo = {
      createQueryBuilder: vi.fn(),
    };

    factoryRepo = {
      createQueryBuilder: vi.fn(),
    };

    inventoryRepo = {
      find: vi.fn(),
    };

    currentPriceRepo = {
      createQueryBuilder: vi.fn(),
    };

    loanRepo = {
      createQueryBuilder: vi.fn(),
    };

    service = new PlayerService(
      playerRepo as unknown as Repository<Player>,
      playerSeasonRepo as unknown as Repository<PlayerSeason>,
      seasonRepo as unknown as Repository<Season>,
      mapTileRepo as unknown as Repository<MapTile>,
      factoryRepo as unknown as Repository<Factory>,
      inventoryRepo as unknown as Repository<Inventory>,
      currentPriceRepo as unknown as Repository<CurrentPrice>,
      loanRepo as unknown as Repository<Loan>,
    );
  });

  describe('updateProfile', () => {
    it('should update display name', async () => {
      playerRepo.findOneBy!.mockResolvedValueOnce({ ...mockPlayer }); // find player
      playerRepo.findOneBy!.mockResolvedValueOnce(null); // no duplicate name

      const result = await service.updateProfile(playerId, { displayName: 'NewName' });

      expect(result.displayName).toBe('NewName');
      expect(playerRepo.save).toHaveBeenCalled();
    });

    it('should update avatar config', async () => {
      playerRepo.findOneBy!.mockResolvedValueOnce({ ...mockPlayer });

      const newAvatar = { skin: 'dark', hair: 'black' };
      const result = await service.updateProfile(playerId, { avatarConfig: newAvatar });

      expect(result.avatarConfig).toEqual(newAvatar);
      expect(playerRepo.save).toHaveBeenCalled();
    });

    it('should throw ConflictException if display name is taken', async () => {
      playerRepo.findOneBy!.mockResolvedValueOnce({ ...mockPlayer }); // find player
      playerRepo.findOneBy!.mockResolvedValueOnce({ id: 'other-id', displayName: 'TakenName' }); // duplicate

      await expect(
        service.updateProfile(playerId, { displayName: 'TakenName' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should not check uniqueness if display name unchanged', async () => {
      playerRepo.findOneBy!.mockResolvedValueOnce({ ...mockPlayer });
      playerRepo.findOneBy!.mockResolvedValueOnce(null); // even if called, returns null

      const result = await service.updateProfile(playerId, { displayName: 'TestPlayer' });

      expect(result.displayName).toBe('TestPlayer');
    });

    it('should throw NotFoundException if player does not exist', async () => {
      playerRepo.findOneBy!.mockResolvedValue(null);

      await expect(
        service.updateProfile(playerId, { displayName: 'Test' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('selectSpecialty', () => {
    it('should set specialty for the current season', async () => {
      seasonRepo.findOne!.mockResolvedValue(mockSeason);
      playerSeasonRepo.findOne!.mockResolvedValue({ ...mockPlayerSeason });

      const result = await service.selectSpecialty(playerId, {
        commodity: 'rice',
      });

      expect(result.specialty).toBe('rice');
      expect(playerSeasonRepo.save).toHaveBeenCalled();
    });

    it('should create PlayerSeason if it does not exist', async () => {
      seasonRepo.findOne!.mockResolvedValue(mockSeason);
      playerSeasonRepo.findOne!.mockResolvedValue(null);
      playerSeasonRepo.create!.mockReturnValue({
        playerId,
        seasonId,
        specialty: null,
        coins: '1000.00',
        storageCapacity: 500,
        workforceHappiness: '80.00',
      });
      playerSeasonRepo.save!.mockImplementation((entity: Record<string, unknown>) =>
        Promise.resolve({ ...entity, id: 'new-ps-id' }),
      );

      const result = await service.selectSpecialty(playerId, {
        commodity: 'crude-oil',
      });

      expect(result.specialty).toBe('crude-oil');
    });

    it('should throw BadRequestException if specialty already selected', async () => {
      seasonRepo.findOne!.mockResolvedValue(mockSeason);
      playerSeasonRepo.findOne!.mockResolvedValue({
        ...mockPlayerSeason,
        specialty: 'iron-ore',
      });

      await expect(
        service.selectSpecialty(playerId, { commodity: 'rice' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if no active season', async () => {
      seasonRepo.findOne!.mockResolvedValue(null);

      await expect(
        service.selectSpecialty(playerId, { commodity: 'fish' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getPlayerState', () => {
    it('should return player, season, and playerSeason data', async () => {
      playerRepo.findOneBy!.mockResolvedValue(mockPlayer);
      seasonRepo.findOne!.mockResolvedValue(mockSeason);
      playerSeasonRepo.findOne!.mockResolvedValue(mockPlayerSeason);

      const result = await service.getPlayerState(playerId);

      expect(result.player.id).toBe(playerId);
      expect(result.season?.id).toBe(seasonId);
      expect(result.playerSeason?.coins).toBe('1000.00');
    });

    it('should return null season and playerSeason when no active season', async () => {
      playerRepo.findOneBy!.mockResolvedValue(mockPlayer);
      seasonRepo.findOne!.mockResolvedValue(null);

      const result = await service.getPlayerState(playerId);

      expect(result.player.id).toBe(playerId);
      expect(result.season).toBeNull();
      expect(result.playerSeason).toBeNull();
    });

    it('should throw NotFoundException if player not found', async () => {
      playerRepo.findOneBy!.mockResolvedValue(null);

      await expect(service.getPlayerState(playerId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getNetWorth', () => {
    beforeEach(() => {
      seasonRepo.findOne!.mockResolvedValue(mockSeason);
      playerSeasonRepo.findOne!.mockResolvedValue(mockPlayerSeason);
    });

    it('should calculate net worth correctly with all components', async () => {
      // Land value
      const mockLandQB = {
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getRawOne: vi.fn().mockResolvedValue({ total: '250.00' }),
      };
      mapTileRepo.createQueryBuilder!.mockReturnValue(mockLandQB);

      // Factory value
      const mockFactoryQB = {
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getRawOne: vi.fn().mockResolvedValue({ total: '800.00' }),
      };
      factoryRepo.createQueryBuilder!.mockReturnValue(mockFactoryQB);

      // Inventory
      inventoryRepo.find!.mockResolvedValue([
        { commodityId: 'c1', quantity: 10 },
        { commodityId: 'c2', quantity: 5 },
      ]);
      const mockPriceQB = {
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getMany: vi.fn().mockResolvedValue([
          { commodityId: 'c1', price: '20.00' },
          { commodityId: 'c2', price: '50.00' },
        ]),
      };
      currentPriceRepo.createQueryBuilder!.mockReturnValue(mockPriceQB);

      // Loans
      const mockLoanQB = {
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getRawOne: vi.fn().mockResolvedValue({ total: '300.00' }),
      };
      loanRepo.createQueryBuilder!.mockReturnValue(mockLoanQB);

      const result = await service.getNetWorth(playerId);

      expect(result.cash).toBe(1000);
      expect(result.landValue).toBe(250);
      expect(result.factoryValue).toBe(800);
      expect(result.inventoryMarketValue).toBe(450); // 10*20 + 5*50
      expect(result.outstandingDebt).toBe(300);
      expect(result.total).toBe(2200); // 1000 + 250 + 800 + 450 - 300
    });

    it('should handle zero values gracefully', async () => {
      const mockQB = {
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getRawOne: vi.fn().mockResolvedValue({ total: '0' }),
      };
      mapTileRepo.createQueryBuilder!.mockReturnValue(mockQB);
      factoryRepo.createQueryBuilder!.mockReturnValue(mockQB);
      inventoryRepo.find!.mockResolvedValue([]);
      loanRepo.createQueryBuilder!.mockReturnValue(mockQB);

      const result = await service.getNetWorth(playerId);

      expect(result.cash).toBe(1000);
      expect(result.landValue).toBe(0);
      expect(result.factoryValue).toBe(0);
      expect(result.inventoryMarketValue).toBe(0);
      expect(result.outstandingDebt).toBe(0);
      expect(result.total).toBe(1000);
    });

    it('should throw NotFoundException if no active season', async () => {
      seasonRepo.findOne!.mockResolvedValue(null);

      await expect(service.getNetWorth(playerId)).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException if player season not found', async () => {
      playerSeasonRepo.findOne!.mockResolvedValue(null);

      await expect(service.getNetWorth(playerId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateLastActiveAt', () => {
    it('should update last active timestamp', async () => {
      seasonRepo.findOne!.mockResolvedValue(mockSeason);

      await service.updateLastActiveAt(playerId);

      expect(playerRepo.update).toHaveBeenCalledWith(playerId, {
        lastActiveAt: expect.any(Date),
      });
    });

    it('should clear inactivity reminder flag', async () => {
      seasonRepo.findOne!.mockResolvedValue(mockSeason);

      await service.updateLastActiveAt(playerId);

      expect(playerSeasonRepo.update).toHaveBeenCalledWith(
        { playerId, seasonId },
        { inactivityReminderSent: false },
      );
    });

    it('should not clear inactivity flag if no active season', async () => {
      seasonRepo.findOne!.mockResolvedValue(null);

      await service.updateLastActiveAt(playerId);

      expect(playerRepo.update).toHaveBeenCalled();
      expect(playerSeasonRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('getDashboard', () => {
    it('should return full dashboard with net worth when season active', async () => {
      playerRepo.findOneBy!.mockResolvedValue({ ...mockPlayer });
      seasonRepo.findOne!.mockResolvedValue(mockSeason);
      playerSeasonRepo.findOne!.mockResolvedValue({ ...mockPlayerSeason });

      // Mock getNetWorth dependencies
      const mockQB = {
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getRawOne: vi.fn().mockResolvedValue({ total: '0' }),
      };
      mapTileRepo.createQueryBuilder!.mockReturnValue(mockQB);
      factoryRepo.createQueryBuilder!.mockReturnValue(mockQB);
      inventoryRepo.find!.mockResolvedValue([]);
      loanRepo.createQueryBuilder!.mockReturnValue(mockQB);

      const result = await service.getDashboard(playerId);

      expect(result.player.id).toBe(playerId);
      expect(result.player.displayName).toBe('TestPlayer');
      expect(result.season).not.toBeNull();
      expect(result.season?.coins).toBe(1000);
      expect(result.netWorth).not.toBeNull();
      expect(result.netWorth?.total).toBe(1000);
    });

    it('should return null season and netWorth when no active season', async () => {
      playerRepo.findOneBy!.mockResolvedValue(mockPlayer);
      seasonRepo.findOne!.mockResolvedValue(null);

      const result = await service.getDashboard(playerId);

      expect(result.player.id).toBe(playerId);
      expect(result.season).toBeNull();
      expect(result.netWorth).toBeNull();
    });
  });
});
