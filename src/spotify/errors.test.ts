import { describe, expect, it } from 'vitest';
import { ApiError, AuthError, describeError } from './errors';

describe('describeError', () => {
  it('explains common failures in plain language', () => {
    expect(describeError(new AuthError())).toMatch(/reconnect/);
    expect(describeError(new ApiError(403, 'Forbidden'))).toMatch(/permission/);
    expect(describeError(new ApiError(404, 'Not found'))).toMatch(/could not find/);
    expect(describeError(new ApiError(500, 'Boom'))).toBe('Spotify error 500: Boom');
    expect(describeError(new TypeError('Failed to fetch'))).toMatch(/Network error/);
    expect(describeError('weird')).toBe('weird');
  });
});
