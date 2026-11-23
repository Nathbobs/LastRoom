import { registerDecorator, ValidationOptions } from 'class-validator';
import { isNight } from './nights.js';

/** DTO field must be a real calendar date in YYYY-MM-DD format. */
export function IsNight(options?: ValidationOptions): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isNight',
      target: target.constructor,
      propertyName: String(propertyName),
      options: {
        message: `${String(propertyName)} must be a real date in YYYY-MM-DD format`,
        ...options,
      },
      validator: { validate: (value: unknown) => isNight(value) },
    });
  };
}
