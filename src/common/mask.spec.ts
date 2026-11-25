import { maskEmail } from './mask.js';

describe('maskEmail', () => {
  it.each([
    ['jane.doe@example.com', 'j***@example.com'],
    ['a@b.co', 'a***@b.co'],
    ['  Ada@Example.com ', 'A***@Example.com'],
    // The local part may itself contain @ when quoted; the domain is after the last one.
    ['"x@y"@example.com', '"***@example.com'],
  ])('masks %s as %s', (input, expected) => {
    expect(maskEmail(input)).toBe(expected);
  });

  it.each(['', 'no-at-sign', '@example.com', 'jane@'])(
    'fully masks a malformed value (%s)',
    (input) => {
      expect(maskEmail(input)).toBe('***');
    },
  );

  it('never contains the local part beyond its first character', () => {
    expect(maskEmail('secretname@example.com')).not.toContain('secretname');
  });
});
