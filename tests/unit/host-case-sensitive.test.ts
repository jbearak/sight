import { describe, it, expect } from 'bun:test';
import { host_is_case_sensitive } from '../../src/utils/file-path-utils';

describe('host_is_case_sensitive', () => {
  it('flipped variant exists -> case-insensitive', () => {
    const fs = { existsSync: (_p: string) => true };
    expect(host_is_case_sensitive('/Workspace/proj', fs)).toBe(false);
  });
  it('flipped variant absent -> case-sensitive', () => {
    const fs = { existsSync: (p: string) => p === '/Workspace/proj' };
    expect(host_is_case_sensitive('/Workspace/proj', fs)).toBe(true);
  });
  it('no ascii letter -> assume case-sensitive', () => {
    const fs = { existsSync: (_p: string) => true };
    expect(host_is_case_sensitive('/123/456', fs)).toBe(true);
  });
});
