import { z } from 'zod';
import { badRequest } from './errors.js';

// Parse and validate data with a zod schema; throw a 400 with a short, safe message on failure.
export function parse(schema, data) {
  const result = schema.safeParse(data ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue.path.join('.') || 'request';
    throw badRequest(`${field}: ${issue.message}`, 'validation_error');
  }
  return result.data;
}

export const uuid = z.string().uuid();
export const lat = z.number().min(-90).max(90);
export const lng = z.number().min(-180).max(180);
export { z };
