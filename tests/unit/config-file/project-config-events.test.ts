import { describe, expect, it } from 'bun:test';
import * as path from 'path';
import {
    is_project_config_event_path,
    PROJECT_CONFIG_FILE,
    STALE_JSON_CONFIG_FILE,
} from '../../../src/config-file';

describe('is_project_config_event_path', () => {
    it('matches sight.toml and stale .sight.json exactly by basename', () => {
        expect(is_project_config_event_path(path.join('a', PROJECT_CONFIG_FILE))).toBe(true);
        expect(is_project_config_event_path(path.join('a', STALE_JSON_CONFIG_FILE))).toBe(true);
    });

    it('rejects similarly named files', () => {
        expect(is_project_config_event_path('sight.toml.bak')).toBe(false);
        expect(is_project_config_event_path('.sight.json.bak')).toBe(false);
        expect(is_project_config_event_path('SIGHT.TOML')).toBe(false);
    });
});
