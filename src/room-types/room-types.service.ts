import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';
import {
  InvalidStateException,
  NotFoundException,
  ValidationException,
} from '../common/errors/app-exception.js';
import { isDuplicateKeyError } from '../common/mongo-errors.js';
import { MAX_RANGE_NIGHTS, parseRange } from '../common/nights.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { RoomType, RoomTypeDocument } from './room-type.schema.js';
import {
  CreateRoomTypeDto,
  RoomTypeResponseDto,
  SetInventoryDto,
  SetInventoryResponseDto,
} from './room-types.dto.js';

@Injectable()
export class RoomTypesService {
  constructor(
    @InjectModel(RoomType.name) private readonly roomTypes: Model<RoomType>,
    @InjectConnection() private readonly connection: Connection,
    private readonly inventory: InventoryService,
  ) {}

  /** Creates the room type and (optionally) seeds its inventory, in one transaction. */
  async create(dto: CreateRoomTypeDto): Promise<RoomTypeResponseDto> {
    const nights = seedNights(dto);

    try {
      const created = await this.connection.transaction(async (session) => {
        const [roomType] = await this.roomTypes.create(
          [{ name: dto.name, totalUnits: dto.totalUnits }],
          { session },
        );
        if (nights.length > 0) {
          await this.inventory.seed(
            roomType._id,
            nights,
            dto.totalUnits,
            session,
          );
        }
        return roomType;
      });
      const response = toResponse(created);
      response.seededNights = nights.length;
      return response;
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        throw new InvalidStateException(
          'A room type with this name already exists',
          { name: dto.name },
        );
      }
      throw err;
    }
  }

  async list(): Promise<RoomTypeResponseDto[]> {
    const docs = await this.roomTypes.find().sort({ createdAt: 1, _id: 1 });
    return docs.map(toResponse);
  }

  /** Throws 404 if the room type doesn't exist. */
  async assertExists(id: string): Promise<void> {
    const exists = await this.roomTypes.exists({ _id: id });
    if (!exists) {
      throw new NotFoundException('Room type not found', { roomTypeId: id });
    }
  }

  async setInventory(
    id: string,
    dto: SetInventoryDto,
  ): Promise<SetInventoryResponseDto> {
    const nights = parseRange(dto.from, dto.to, {
      maxNights: MAX_RANGE_NIGHTS,
    });
    await this.assertExists(id);
    await this.inventory.setTotal(id, nights, dto.total);
    return {
      roomTypeId: id,
      from: dto.from,
      to: dto.to,
      total: dto.total,
      nights: nights.length,
    };
  }
}

function seedNights(dto: CreateRoomTypeDto): string[] {
  const { seedFrom, seedTo } = dto;
  if (seedFrom === undefined && seedTo === undefined) return [];
  if (seedFrom === undefined || seedTo === undefined) {
    throw new ValidationException('Give both seedFrom and seedTo, or neither', {
      seedFrom,
      seedTo,
    });
  }
  return parseRange(seedFrom, seedTo, {
    maxNights: MAX_RANGE_NIGHTS,
    fromField: 'seedFrom',
    toField: 'seedTo',
  });
}

function toResponse(doc: RoomTypeDocument): RoomTypeResponseDto {
  return {
    id: doc._id.toString(),
    name: doc.name,
    totalUnits: doc.totalUnits,
    createdAt: doc.createdAt.toISOString(),
  };
}
