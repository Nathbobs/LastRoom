import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Connection, Model } from 'mongoose';
import { Types } from 'mongoose';
import { InvalidStateException } from '../common/errors/app-exception.js';
import { isDuplicateKeyError } from '../common/mongo-errors.js';
import { Inventory } from './inventory.schema.js';

export interface NightInventory {
  date: string;
  total: number;
  booked: number;
  available: number;
}

/**
 * Owns the per-night inventory rows. Phase 2: seeding, setting totals, reading.
 * The claim/release logic for bookings (Phase 3) is written by the owner.
 */
@Injectable()
export class InventoryService {
  constructor(
    @InjectModel(Inventory.name) private readonly inventory: Model<Inventory>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /**
   * Creates fresh rows (booked = 0) for a brand-new room type.
   * Runs inside the caller's transaction so a failed seed also undoes the room type.
   */
  async seed(
    roomTypeId: Types.ObjectId,
    nights: string[],
    total: number,
    session: ClientSession,
  ): Promise<void> {
    await this.inventory.insertMany(
      nights.map((date) => ({ roomTypeId, date, total, booked: 0 })),
      { session },
    );
  }

  /**
   * Sets `total` for every night in the range, creating missing rows.
   * All-or-nothing: if ANY night has more units booked than the new total,
   * nothing changes and the blocking nights are reported (409 INVALID_STATE).
   */
  async setTotal(
    roomTypeId: string,
    nights: string[],
    total: number,
  ): Promise<void> {
    const rtId = new Types.ObjectId(roomTypeId);

    // connection.transaction() retries the whole callback on transient errors,
    // e.g. a WriteConflict because a booking touched one of these rows mid-way.
    await this.connection.transaction(async (session) => {
      // 1. Friendly report: find every night that would end with booked > total.
      const blocked = await this.inventory
        .find(
          { roomTypeId: rtId, date: { $in: nights }, booked: { $gt: total } },
          { _id: 0, date: 1, booked: 1 },
          { session },
        )
        .sort({ date: 1 })
        .lean();
      if (blocked.length > 0) {
        throw new InvalidStateException(
          `total ${total} is below the units already booked on ${blocked.length} night(s)`,
          { total, blockedNights: blocked },
        );
      }

      // 2. The guarantee: each update only matches if booked <= total at write
      //    time. If a booking slipped in after step 1, the filter misses, the
      //    upsert tries to INSERT a second row for that night, and the unique
      //    (roomTypeId, date) index rejects it. The transaction aborts: no
      //    night changes.
      try {
        await this.inventory.bulkWrite(
          nights.map((date) => ({
            updateOne: {
              filter: { roomTypeId: rtId, date, booked: { $lte: total } },
              update: { $set: { total }, $setOnInsert: { booked: 0 } },
              upsert: true,
            },
          })),
          { session, ordered: true },
        );
      } catch (err) {
        if (isDuplicateKeyError(err)) {
          throw new InvalidStateException(
            `total ${total} is below the units booked on at least one night (bookings changed during the update)`,
            { total },
          );
        }
        throw err;
      }
    });
  }

  /** Every night in the range, in order. Nights with no row are not sellable: total 0. */
  async findRange(
    roomTypeId: string,
    nights: string[],
  ): Promise<NightInventory[]> {
    const rows = await this.inventory
      .find(
        {
          roomTypeId: new Types.ObjectId(roomTypeId),
          date: { $gte: nights[0], $lte: nights[nights.length - 1] },
        },
        { _id: 0, date: 1, total: 1, booked: 1 },
      )
      .lean();
    const byDate = new Map(rows.map((r) => [r.date, r]));

    return nights.map((date) => {
      const row = byDate.get(date);
      const total = row?.total ?? 0;
      const booked = row?.booked ?? 0;
      return { date, total, booked, available: Math.max(total - booked, 0) };
    });
  }
}
