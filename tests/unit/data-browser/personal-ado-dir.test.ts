import {
    describe,
    expect,
    it,
} from 'bun:test';
import * as path from 'path';
import { resolve_personal_ado_dir } from '../../../client/src/data-browser/install-path';

// `platform` picks the layout; the path is joined with the host's
// separator, as it is when the extension runs on that platform.

describe('resolve_personal_ado_dir', () => {
    it('defaults to OLDPLACE on macOS', () => {
        const my_result = resolve_personal_ado_dir(
            '',
            '/Users/tester',
            'darwin'
        );

        expect(my_result).toBe(path.join('/Users/tester', 'ado'));
    });

    it('keeps PERSONAL fallback on Linux', () => {
        const my_result = resolve_personal_ado_dir(
            '',
            '/home/tester',
            'linux'
        );

        expect(my_result).toBe(path.join('/home/tester', 'ado', 'personal'));
    });

    it('expands tilde for custom overrides', () => {
        const my_result = resolve_personal_ado_dir(
            '~/custom/ado',
            '/Users/tester',
            'darwin'
        );

        expect(my_result).toBe('/Users/tester/custom/ado');
    });
});
