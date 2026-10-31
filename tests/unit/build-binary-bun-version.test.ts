import { describe, expect, it } from 'bun:test';
import {
    assert_binary_bun_version,
    MIN_BINARY_BUN_VERSION,
} from '../../scripts/build-binary';

describe('assert_binary_bun_version', () => {
    it('rejects a Bun without pseudo-terminal support', () => {
        expect(() => assert_binary_bun_version('1.3.1'))
            .toThrow(/Bun 1\.3\.5 or later \(found 1\.3\.1\)/);
    });

    it('accepts the minimum and newer versions', () => {
        expect(() => assert_binary_bun_version(MIN_BINARY_BUN_VERSION))
            .not.toThrow();
        expect(() => assert_binary_bun_version('1.3.13')).not.toThrow();
        expect(() => assert_binary_bun_version('2.0.0')).not.toThrow();
    });
});
