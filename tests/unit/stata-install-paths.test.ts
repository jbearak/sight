/**
 * Unit tests for `discover_stata_ado_paths`.
 *
 * Uses injected `home`, `platform`, `env`, and `exists` so the tests
 * are deterministic regardless of the machine they run on.
 */

import { describe, it, expect } from 'bun:test';
import * as path from 'path';
import { discover_stata_ado_paths } from '../../src/utils/stata-install-paths';

function make_exists(
    the_present_paths: string[],
    my_path: typeof path.posix | typeof path.win32 = path.posix
): (p: string) => boolean {
    const my_normalized = new Set(
        the_present_paths.map(p => my_path.resolve(p))
    );
    return (candidate: string) => my_normalized.has(my_path.resolve(candidate));
}

describe('discover_stata_ado_paths', () => {
    it('returns an empty list when no candidate directories exist', () => {
        const the_paths = discover_stata_ado_paths({
            home: '/home/user',
            platform: 'linux',
            exists: () => false,
            env: {},
        });
        expect(the_paths).toEqual([]);
    });

    describe('macOS', () => {
        it('picks up the canonical /Applications/Stata install dir', () => {
            const the_present = [
                '/Applications/Stata/ado/base',
                '/Applications/Stata/ado/site',
                '/Applications/Stata/ado/updates',
            ];
            const the_paths = discover_stata_ado_paths({
                home: '/Users/me',
                platform: 'darwin',
                exists: make_exists(the_present),
                env: {},
            });
            expect(the_paths).toEqual(the_present);
        });

        it('includes the modern Library Application Support PERSONAL dir', () => {
            const the_present = [
                '/Users/me/Library/Application Support/Stata/ado/personal',
                '/Users/me/Library/Application Support/Stata/ado/plus',
            ];
            const the_paths = discover_stata_ado_paths({
                home: '/Users/me',
                platform: 'darwin',
                exists: make_exists(the_present),
                env: {},
            });
            expect(the_paths).toEqual(the_present);
        });

        it('covers legacy ~/ado/personal alongside the modern Library dir', () => {
            const the_present = [
                '/Users/me/ado/personal',
                '/Users/me/Library/Application Support/Stata/ado/plus',
            ];
            const the_paths = discover_stata_ado_paths({
                home: '/Users/me',
                platform: 'darwin',
                exists: make_exists(the_present),
                env: {},
            });
            expect(the_paths).toEqual(the_present);
        });

        it('picks up the StataNow install dir', () => {
            const the_present = [
                '/Applications/StataNow/ado/base',
                '/Applications/StataNow/ado/updates',
            ];
            const the_paths = discover_stata_ado_paths({
                home: '/Users/me',
                platform: 'darwin',
                exists: make_exists(the_present),
                env: {},
            });
            expect(the_paths).toEqual(the_present);
        });

        it('considers Stata variants like StataMP and StataSE', () => {
            const the_present = [
                '/Applications/StataMP/ado/base',
                '/Applications/StataSE/ado/base',
            ];
            const the_paths = discover_stata_ado_paths({
                home: '/Users/me',
                platform: 'darwin',
                exists: make_exists(the_present),
                env: {},
            });
            expect(the_paths).toContain('/Applications/StataMP/ado/base');
            expect(the_paths).toContain('/Applications/StataSE/ado/base');
        });
    });

    describe('Linux', () => {
        it('picks up /usr/local/stata<version>/ado/base', () => {
            const the_present = [
                '/usr/local/stata18/ado/base',
                '/usr/local/stata18/ado/site',
            ];
            const the_paths = discover_stata_ado_paths({
                home: '/home/user',
                platform: 'linux',
                exists: make_exists(the_present),
                env: {},
            });
            expect(the_paths).toEqual(the_present);
        });

        it('falls back to /opt prefix and unversioned directories', () => {
            const the_present = [
                '/opt/stata/ado/base',
                '/opt/stata17/ado/base',
                '/home/user/ado/personal',
            ];
            const the_paths = discover_stata_ado_paths({
                home: '/home/user',
                platform: 'linux',
                exists: make_exists(the_present),
                env: {},
            });
            // Order: user paths first, then system, newest version first.
            expect(the_paths[0]).toBe('/home/user/ado/personal');
            expect(the_paths).toContain('/opt/stata17/ado/base');
            expect(the_paths).toContain('/opt/stata/ado/base');
            const my_stata17_idx = the_paths.indexOf('/opt/stata17/ado/base');
            const my_stata_unversioned_idx = the_paths.indexOf('/opt/stata/ado/base');
            expect(my_stata17_idx).toBeLessThan(my_stata_unversioned_idx);
        });

        it('does not include macOS-only Library paths on Linux', () => {
            const the_present = [
                '/home/user/Library/Application Support/Stata/ado/personal',
            ];
            const the_paths = discover_stata_ado_paths({
                home: '/home/user',
                platform: 'linux',
                exists: make_exists(the_present),
                env: {},
            });
            expect(the_paths).toEqual([]);
        });
    });

    describe('Windows', () => {
        it('honours ProgramFiles / ProgramW6432 / ProgramFiles(x86) env vars', () => {
            const my_env = {
                ProgramFiles: 'D:\\Programs',
                ProgramW6432: 'D:\\Programs',
                'ProgramFiles(x86)': 'D:\\Programs (x86)',
            };
            const the_present = [
                path.win32.resolve('D:\\Programs\\Stata18\\ado\\base'),
                path.win32.resolve('D:\\Programs (x86)\\Stata17\\ado\\base'),
            ];
            const the_paths = discover_stata_ado_paths({
                home: 'C:\\Users\\me',
                platform: 'win32',
                exists: make_exists(the_present, path.win32),
                env: my_env,
            });
            expect(the_paths).toEqual(the_present);
        });

        it('uses sensible defaults when Program Files env vars are missing', () => {
            const the_present = [
                path.win32.resolve('C:\\Program Files\\Stata18\\ado\\base'),
                path.win32.resolve('C:\\Program Files (x86)\\Stata17\\ado\\base'),
            ];
            const the_paths = discover_stata_ado_paths({
                home: 'C:\\Users\\me',
                platform: 'win32',
                exists: make_exists(the_present, path.win32),
                env: {},
            });
            expect(the_paths).toEqual(the_present);
        });

        it('discovers drive-root installs like C:\\Stata18 with no Program Files entries', () => {
            const the_present = [
                path.win32.resolve('C:\\Stata18\\ado\\base'),
            ];
            const the_paths = discover_stata_ado_paths({
                home: 'C:\\Users\\me',
                platform: 'win32',
                exists: make_exists(the_present, path.win32),
                env: {},
            });
            expect(the_paths).toEqual(the_present);
        });

        it('discovers drive-root installs on alternate drives like D:\\Stata17', () => {
            const the_present = [
                path.win32.resolve('D:\\Stata17\\ado\\base'),
            ];
            const the_paths = discover_stata_ado_paths({
                home: 'C:\\Users\\me',
                platform: 'win32',
                exists: make_exists(the_present, path.win32),
                env: {},
            });
            expect(the_paths).toEqual(the_present);
        });

        it('discovers Stata default PLUS at C:\\ado\\plus on Windows', () => {
            const the_present = [
                path.win32.resolve('C:\\ado\\personal'),
                path.win32.resolve('C:\\ado\\plus'),
            ];
            const the_paths = discover_stata_ado_paths({
                home: 'C:\\Users\\me',
                platform: 'win32',
                exists: make_exists(the_present, path.win32),
                env: {},
            });
            expect(the_paths).toEqual(the_present);
        });

        it('honours SystemDrive env var for ado defaults', () => {
            const the_present = [
                path.win32.resolve('D:\\ado\\plus'),
            ];
            const the_paths = discover_stata_ado_paths({
                home: 'C:\\Users\\me',
                platform: 'win32',
                exists: make_exists(the_present, path.win32),
                env: { SystemDrive: 'D:' },
            });
            expect(the_paths).toEqual(the_present);
        });

        it('includes the home-directory ~/ado conventions on Windows too', () => {
            const the_present = [
                path.win32.resolve('C:\\Users\\me\\ado\\personal'),
                path.win32.resolve('C:\\Users\\me\\ado\\plus'),
            ];
            const the_paths = discover_stata_ado_paths({
                home: 'C:\\Users\\me',
                platform: 'win32',
                exists: make_exists(the_present, path.win32),
                env: {},
            });
            expect(the_paths).toEqual(the_present);
        });
    });

    it('deduplicates candidate paths that resolve to the same absolute path', () => {
        const the_unique_queries = new Set<string>();
        let the_total_queries = 0;
        const the_paths = discover_stata_ado_paths({
            home: '/Users/me',
            platform: 'darwin',
            env: {},
            exists: candidate => {
                the_total_queries++;
                the_unique_queries.add(candidate);
                return candidate === '/Applications/Stata/ado/base';
            },
        });
        // Only existing path makes it into the result.
        expect(the_paths).toEqual(['/Applications/Stata/ado/base']);
        // Each normalized candidate should be probed at most once.
        expect(the_unique_queries.size).toBeGreaterThan(0);
        expect(the_total_queries).toBe(the_unique_queries.size);
    });
});
