import { ArgumentMetadata } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsOptional, IsString, ValidateNested } from 'class-validator';
import { ValidationException } from './errors/app-exception.js';
import { IsNight } from './is-night.decorator.js';
import { createValidationPipe } from './validation.js';

class Inner {
  @IsString()
  name: string;
}

class Sample {
  @IsNight()
  checkIn: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => Inner)
  guest?: Inner;
}

const meta: ArgumentMetadata = { type: 'body', metatype: Sample };

async function validate(value: unknown): Promise<unknown> {
  return createValidationPipe().transform(value, meta);
}

async function errorOf(value: unknown): Promise<ValidationException> {
  try {
    await validate(value);
  } catch (err) {
    return err as ValidationException;
  }
  throw new Error('expected validation to fail');
}

describe('createValidationPipe + @IsNight', () => {
  it('accepts a valid body', async () => {
    await expect(validate({ checkIn: '2026-12-24' })).resolves.toBeInstanceOf(
      Sample,
    );
  });

  it('rejects an impossible date with VALIDATION_ERROR and a field list', async () => {
    const err = await errorOf({ checkIn: '2026-02-30' });
    expect(err).toBeInstanceOf(ValidationException);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.details).toEqual({
      fields: [
        {
          field: 'checkIn',
          errors: ['checkIn must be a real date in YYYY-MM-DD format'],
        },
      ],
    });
  });

  it('flattens nested errors to dotted paths', async () => {
    const err = await errorOf({ checkIn: '2026-12-24', guest: { name: 42 } });
    expect(err.details).toEqual({
      fields: [{ field: 'guest.name', errors: ['name must be a string'] }],
    });
  });

  it('rejects unknown fields instead of silently keeping them', async () => {
    const err = await errorOf({ checkIn: '2026-12-24', isAdmin: true });
    expect(err.details).toEqual({
      fields: [
        { field: 'isAdmin', errors: ['property isAdmin should not exist'] },
      ],
    });
  });
});
