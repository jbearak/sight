/// <reference types="bun-types" />
/**
 * Tests for the vscode-free Stata install-root probing logic shared by
 * the GUI and CLI detectors.
 *
 * Feature: send-to-stata — StataNow directory compatibility (#200)
 */

import { describe, expect, it } from 'bun:test';
import {
    MAC_APP_INSTALL_ROOTS,
    find_installed_variant,
    macos_cli_candidate_paths,
} from '../../../client/src/send-to-stata/stata-install-roots';
import type { StataVariant } from '../../../client/src/send-to-stata/index';

const VARIANTS: readonly StataVariant[] = [
    'StataMP', 'StataSE', 'StataBE', 'StataIC', 'Stata',
];

function make_exists(
    the_present_paths: string[]
): (p: string) => Promise<boolean> {
    const the_set = new Set(the_present_paths);
    return (p: string) => Promise.resolve(the_set.has(p));
}

describe('MAC_APP_INSTALL_ROOTS', () => {
    it('probes both the perpetual Stata and StataNow directories', () => {
        expect(MAC_APP_INSTALL_ROOTS).toContain('/Applications/Stata');
        expect(MAC_APP_INSTALL_ROOTS).toContain('/Applications/StataNow');
    });
});

describe('find_installed_variant', () => {
    it('finds a variant under the canonical /Applications/Stata root', async () => {
        const the_result = await find_installed_variant(
            MAC_APP_INSTALL_ROOTS,
            VARIANTS,
            make_exists(['/Applications/Stata/StataMP.app'])
        );
        expect(the_result).toBe('StataMP');
    });

    it('finds a StataSE install under /Applications/StataNow (#200)', async () => {
        const the_result = await find_installed_variant(
            MAC_APP_INSTALL_ROOTS,
            VARIANTS,
            make_exists(['/Applications/StataNow/StataSE.app'])
        );
        expect(the_result).toBe('StataSE');
    });

    it('finds a StataBE install (variant omitted from the old detector)', async () => {
        const the_result = await find_installed_variant(
            MAC_APP_INSTALL_ROOTS,
            VARIANTS,
            make_exists(['/Applications/StataNow/StataBE.app'])
        );
        expect(the_result).toBe('StataBE');
    });

    it('returns null when nothing is installed', async () => {
        const the_result = await find_installed_variant(
            MAC_APP_INSTALL_ROOTS,
            VARIANTS,
            make_exists([])
        );
        expect(the_result).toBeNull();
    });

    it('applies variant priority within a root', async () => {
        const the_result = await find_installed_variant(
            MAC_APP_INSTALL_ROOTS,
            VARIANTS,
            make_exists([
                '/Applications/Stata/StataSE.app',
                '/Applications/Stata/Stata.app',
            ])
        );
        expect(the_result).toBe('StataSE');
    });

    it('prefers the higher edition across channels (edition before channel)', async () => {
        // Perpetual SE vs StataNow MP: the more capable edition (MP)
        // wins regardless of which channel it lives in.
        const the_result = await find_installed_variant(
            MAC_APP_INSTALL_ROOTS,
            VARIANTS,
            make_exists([
                '/Applications/Stata/StataSE.app',
                '/Applications/StataNow/StataMP.app',
            ])
        );
        expect(the_result).toBe('StataMP');
    });
});

describe('macos_cli_candidate_paths', () => {
    it('includes a StataNow .app/Contents/MacOS path for the binary (#200)', () => {
        const the_paths = macos_cli_candidate_paths('stata-se');
        expect(the_paths).toContain(
            '/Applications/Stata/StataSE.app/Contents/MacOS/stata-se'
        );
        expect(the_paths).toContain(
            '/Applications/StataNow/StataSE.app/Contents/MacOS/stata-se'
        );
    });

    it('returns an empty list for an unknown binary name', () => {
        expect(macos_cli_candidate_paths('not-a-stata-binary')).toEqual([]);
    });
});
