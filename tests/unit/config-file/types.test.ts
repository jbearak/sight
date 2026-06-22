import { describe, expect, it } from 'bun:test';
import {
    PROJECT_CONFIG_FILE,
    STALE_JSON_CONFIG_FILE,
    MAX_DISCOVERY_DEPTH,
} from '../../../src/config-file';

describe('config-file public constants', () => {
    it('exports canonical project config constants', () => {
        expect(PROJECT_CONFIG_FILE).toBe('sight.toml');
        expect(STALE_JSON_CONFIG_FILE).toBe('.sight.json');
        expect(MAX_DISCOVERY_DEPTH).toBe(32);
    });
});
