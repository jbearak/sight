/// <reference types="bun-types" />
/**
 * Unit tests for the pure Stata install-path helpers.
 *
 * These verify that both the classic `/Applications/Stata` location and
 * the StataNow `/Applications/StataNow` location are probed, which is
 * what lets auto-detection find StataNow installs (the subscription
 * edition installs into a differently named directory).
 *
 * Feature: send-to-stata — StataNow install support
 */

import { describe, expect, it } from 'bun:test';
import {
    MACOS_APP_DIRS,
    macos_app_bundle_paths,
    macos_cli_paths,
    find_installed_stata_app,
} from '../../../client/src/send-to-stata/stata-paths';

/**
 * Build an async `exists` predicate that resolves true only for the
 * given set of present paths.
 */
function make_exists(
    the_present_paths: readonly string[]
): (p: string) => Promise<boolean> {
    const the_present = new Set(the_present_paths);
    return (candidate: string) => Promise.resolve(the_present.has(candidate));
}

describe('MACOS_APP_DIRS', () => {
    it('includes both the classic and StataNow directories', () => {
        expect(MACOS_APP_DIRS).toContain('/Applications/Stata');
        expect(MACOS_APP_DIRS).toContain('/Applications/StataNow');
    });

    it('probes the classic directory before StataNow', () => {
        const classic_idx = MACOS_APP_DIRS.indexOf('/Applications/Stata');
        const now_idx = MACOS_APP_DIRS.indexOf('/Applications/StataNow');
        expect(classic_idx).toBeLessThan(now_idx);
    });
});

describe('macos_app_bundle_paths', () => {
    it('produces a bundle path per install directory', () => {
        expect(macos_app_bundle_paths('StataSE')).toEqual([
            '/Applications/Stata/StataSE.app',
            '/Applications/StataNow/StataSE.app',
        ]);
    });
});

describe('find_installed_stata_app', () => {
    it('finds a StataNow-only install (the reported bug)', async () => {
        const exists = make_exists([
            '/Applications/StataNow/StataSE.app',
        ]);
        expect(await find_installed_stata_app(exists)).toBe('StataSE');
    });

    it('still finds a classic /Applications/Stata install', async () => {
        const exists = make_exists([
            '/Applications/Stata/StataMP.app',
        ]);
        expect(await find_installed_stata_app(exists)).toBe('StataMP');
    });

    it('returns null when nothing is installed', async () => {
        expect(await find_installed_stata_app(make_exists([]))).toBeNull();
    });

    it('prefers variant priority over install directory', async () => {
        // StataMP under StataNow should beat StataSE under the classic
        // directory, preserving historical variant precedence.
        const exists = make_exists([
            '/Applications/Stata/StataSE.app',
            '/Applications/StataNow/StataMP.app',
        ]);
        expect(await find_installed_stata_app(exists)).toBe('StataMP');
    });

    it('prefers the classic directory for the same variant', async () => {
        const exists = make_exists([
            '/Applications/Stata/StataSE.app',
            '/Applications/StataNow/StataSE.app',
        ]);
        // Both resolve to the "StataSE" variant; the returned name is
        // the same, but the classic directory is probed first.
        expect(await find_installed_stata_app(exists)).toBe('StataSE');
    });
});

describe('macos_cli_paths', () => {
    it('returns a path under each install directory for a known binary', () => {
        expect(macos_cli_paths('stata-se')).toEqual([
            '/Applications/Stata/StataSE.app/Contents/MacOS/stata-se',
            '/Applications/StataNow/StataSE.app/Contents/MacOS/stata-se',
        ]);
    });

    it('returns an empty list for an unknown binary', () => {
        expect(macos_cli_paths('not-a-real-binary')).toEqual([]);
    });
});
