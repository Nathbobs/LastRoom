import { ValidationException } from '../common/errors/app-exception.js';
import {
  BookingCancelledDataDto,
  BookingCreatedDataDto,
  parseEventData,
} from './channels.dto.js';

const created = {
  externalId: 'CHA-1',
  roomTypeId: '6750f1c2a1b2c3d4e5f60718',
  checkIn: '2026-12-24',
  checkOut: '2026-12-26',
  guest: { name: ' Ada ', email: 'ada@example.com' },
};

describe('parseEventData', () => {
  it('returns a typed instance, trims like the API DTOs and drops unknown fields', () => {
    const data = parseEventData(BookingCreatedDataDto, {
      ...created,
      channelRate: 120, // unknown to us: ignored, not an error
    });
    expect(data).toBeInstanceOf(BookingCreatedDataDto);
    expect(data.guest.name).toBe('Ada');
    expect(data).not.toHaveProperty('channelRate');
  });

  it('reports every bad field with a data.* path', () => {
    try {
      parseEventData(BookingCreatedDataDto, {
        ...created,
        externalId: 'has spaces',
        checkIn: '2026-02-30',
        guest: { name: 'Ada', email: 'nope' },
      });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationException);
      const fields = (
        (err as ValidationException).details.fields as { field: string }[]
      )
        .map((f) => f.field)
        .sort();
      expect(fields).toEqual([
        'data.checkIn',
        'data.externalId',
        'data.guest.email',
      ]);
    }
  });

  it('a cancel only needs externalId', () => {
    expect(
      parseEventData(BookingCancelledDataDto, { externalId: 'CHA-1' }),
    ).toEqual({
      externalId: 'CHA-1',
    });
    expect(() => parseEventData(BookingCancelledDataDto, {})).toThrow(
      ValidationException,
    );
  });
});
