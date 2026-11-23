import {
  InvalidStateException,
  ValidationException,
} from '../common/errors/app-exception.js';
import {
  assertSameRequest,
  isSameRequest,
  parseIdempotencyKey,
  StayRequest,
} from './idempotency.js';

const base: StayRequest = {
  roomTypeId: '6750f1c2a1b2c3d4e5f60718',
  checkIn: '2026-12-24',
  checkOut: '2026-12-26',
  guest: { name: 'Ada', email: 'ada@example.com' },
};

describe('parseIdempotencyKey', () => {
  it('is optional', () => {
    expect(parseIdempotencyKey(undefined)).toBeUndefined();
  });

  it('accepts visible ASCII up to 255 chars', () => {
    expect(parseIdempotencyKey('a1b2-C3_d4.e5:f6')).toBe('a1b2-C3_d4.e5:f6');
    expect(parseIdempotencyKey('k'.repeat(255))).toHaveLength(255);
  });

  it.each(['', 'has space', 'k'.repeat(256), 'tab\there', 'ünicode'])(
    'rejects %j with 400',
    (key) => {
      expect(() => parseIdempotencyKey(key)).toThrow(ValidationException);
    },
  );
});

describe('isSameRequest / assertSameRequest', () => {
  it('ignores what the database normalises (email case, name/email whitespace, id case)', () => {
    expect(
      isSameRequest(base, {
        ...base,
        roomTypeId: base.roomTypeId.toUpperCase(),
        guest: { name: ' Ada ', email: 'ADA@Example.com ' },
      }),
    ).toBe(true);
  });

  it.each([
    ['roomTypeId', { roomTypeId: '6750f1c2a1b2c3d4e5f60719' }],
    ['checkIn', { checkIn: '2026-12-23' }],
    ['checkOut', { checkOut: '2026-12-27' }],
    ['guest', { guest: { name: 'Bo', email: 'ada@example.com' } }],
  ])('a different %s is a different request (409)', (_field, change) => {
    const other = { ...base, ...change };
    expect(isSameRequest(base, other)).toBe(false);
    expect(() => assertSameRequest(other, base)).toThrow(InvalidStateException);
  });
});
