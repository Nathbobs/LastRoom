import { ValidationException } from './errors/app-exception.js';
import {
  expandNights,
  isNight,
  MAX_RANGE_NIGHTS,
  parseRange,
  parseStay,
} from './nights.js';

describe('isNight', () => {
  it.each(['2026-01-01', '2026-12-31', '2028-02-29', '2000-02-29'])(
    'accepts real date %s',
    (v) => expect(isNight(v)).toBe(true),
  );

  it.each([
    ['2026-02-29', 'not a leap year'],
    ['2100-02-29', 'century, not a leap year'],
    ['2026-02-30', 'Feb 30 (Date.UTC would roll over to Mar 2)'],
    ['2026-13-01', 'month 13'],
    ['2026-00-10', 'month 0'],
    ['2026-04-31', 'April has 30 days'],
    ['2026-1-01', 'not zero-padded'],
    ['2026-01-01T00:00:00Z', 'a timestamp, not a night'],
    ['', 'empty'],
  ])('rejects %s (%s)', (v) => expect(isNight(v)).toBe(false));

  it('rejects non-strings', () => {
    expect(isNight(20260101)).toBe(false);
    expect(isNight(null)).toBe(false);
    expect(isNight(new Date())).toBe(false);
  });
});

describe('expandNights', () => {
  it('excludes the check-out day', () => {
    expect(expandNights('2026-12-24', '2026-12-27')).toEqual([
      '2026-12-24',
      '2026-12-25',
      '2026-12-26',
    ]);
  });

  it('crosses month and year boundaries', () => {
    expect(expandNights('2026-12-31', '2027-01-02')).toEqual([
      '2026-12-31',
      '2027-01-01',
    ]);
  });

  it('includes Feb 29 in a leap year', () => {
    expect(expandNights('2028-02-28', '2028-03-01')).toEqual([
      '2028-02-28',
      '2028-02-29',
    ]);
  });

  it('is not shifted by daylight-saving changes (UTC arithmetic)', () => {
    // Late March / late October are DST switches in many timezones.
    expect(expandNights('2026-03-28', '2026-03-31')).toHaveLength(3);
    expect(expandNights('2026-10-24', '2026-10-27')).toHaveLength(3);
  });

  it('returns nothing for an empty or reversed range', () => {
    expect(expandNights('2026-01-01', '2026-01-01')).toEqual([]);
    expect(expandNights('2026-01-02', '2026-01-01')).toEqual([]);
  });
});

describe('parseStay', () => {
  it('a one-night stay books exactly one night', () => {
    expect(parseStay('2026-12-24', '2026-12-25')).toEqual(['2026-12-24']);
  });

  it('accepts 30 nights', () => {
    expect(parseStay('2026-01-01', '2026-01-31')).toHaveLength(30);
  });

  it('rejects 31 nights', () => {
    expect(() => parseStay('2026-01-01', '2026-02-01')).toThrow(
      /31 nights; the maximum is 30/,
    );
  });

  it('rejects checkIn == checkOut and checkIn after checkOut', () => {
    expect(() => parseStay('2026-12-24', '2026-12-24')).toThrow(
      'checkIn must be before checkOut',
    );
    expect(() => parseStay('2026-12-25', '2026-12-24')).toThrow(
      'checkIn must be before checkOut',
    );
  });

  it('rejects an invalid date, naming the field', () => {
    try {
      parseStay('2026-12-24', '2026-02-30');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationException);
      expect((err as ValidationException).details).toEqual({
        field: 'checkOut',
        value: '2026-02-30',
      });
    }
  });
});

describe('parseRange', () => {
  it(`accepts up to ${MAX_RANGE_NIGHTS} nights for operator ranges`, () => {
    expect(
      parseRange('2027-01-01', '2028-01-02', { maxNights: MAX_RANGE_NIGHTS }),
    ).toHaveLength(366);
    expect(() =>
      parseRange('2027-01-01', '2028-01-03', { maxNights: MAX_RANGE_NIGHTS }),
    ).toThrow(/367 nights/);
  });

  it('uses custom field names in messages', () => {
    expect(() =>
      parseRange('2026-01-02', '2026-01-01', {
        maxNights: 10,
        fromField: 'seedFrom',
        toField: 'seedTo',
      }),
    ).toThrow('seedFrom must be before seedTo');
  });
});
