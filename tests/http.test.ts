import { describe, expect, it } from 'vitest';
import { isAuthorized } from '../src/http.js';

describe('isAuthorized', () => {
  it('accepts only the exact bearer token', () => {
    expect(isAuthorized('Bearer abc', 'abc')).toBe(true);
    expect(isAuthorized('Bearer abd', 'abc')).toBe(false);
    expect(isAuthorized(undefined, 'abc')).toBe(false);
  });
});
