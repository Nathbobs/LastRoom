import { isDuplicateKeyError } from './mongo-errors.js';

describe('isDuplicateKeyError', () => {
  it('detects a single-write duplicate key', () => {
    expect(isDuplicateKeyError({ code: 11000 })).toBe(true);
  });

  it('detects a duplicate key inside a bulk write', () => {
    expect(
      isDuplicateKeyError({ code: 65, writeErrors: [{ code: 11000 }] }),
    ).toBe(true);
  });

  it('ignores other errors', () => {
    expect(isDuplicateKeyError({ code: 121 })).toBe(false);
    expect(isDuplicateKeyError(new Error('x'))).toBe(false);
    expect(isDuplicateKeyError(null)).toBe(false);
  });
});
