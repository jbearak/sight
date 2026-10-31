/**
 * Unit tests for console setup: arguments, locating Stata, history, and
 * completion candidates.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parse_console_args } from '../../../src/console/args';
import { locate_stata } from '../../../src/console/stata-locator';
import { History, default_history_path } from '../../../src/console/history';
import { SessionCompleter, to_candidates } from '../../../src/console/completer';
import { run_console } from '../../../src/console/index';

let tmp_dir: string;
beforeEach(() => {
    tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sight-console-'));
});
afterEach(() => {
    fs.rmSync(tmp_dir, { recursive: true, force: true });
});

function make_executable(file_path: string): string {
    fs.mkdirSync(path.dirname(file_path), { recursive: true });
    fs.writeFileSync(file_path, '#!/bin/sh\n', { mode: 0o755 });
    return file_path;
}

describe('parse_console_args', () => {
    it('uses defaults', () => {
        const result = parse_console_args([]);
        expect(result).toEqual({ success: true, args: {
            color_output: 'streams', history: true, stata_echoes: false,
            yes: false, help: false, stata_args: ['-q'],
        } });
    });

    it('parses options and passes arguments after -- to Stata', () => {
        const result = parse_console_args(['--stata', '/x/stata-mp', '--color-output=off',
            '--no-history', '--stata-echoes', '--', '-b', 'do', 'a b.do']);
        expect(result.success && result.args).toEqual({
            stata_path: '/x/stata-mp', color_output: 'off', history: false,
            stata_echoes: true, yes: false, help: false, stata_args: ['-b', 'do', 'a b.do'],
        });
    });

    it('parses --yes and -y', () => {
        const long = parse_console_args(['--yes']);
        const short = parse_console_args(['-y']);
        expect(long.success && long.args.yes).toBe(true);
        expect(short.success && short.args.yes).toBe(true);
    });

    it('rejects unknown options and bad values', () => {
        expect(parse_console_args(['-q']).success).toBe(false);
        expect(parse_console_args(['--color-output', 'values']).success).toBe(false);
        expect(parse_console_args(['--stata']).success).toBe(false);
    });
});

describe('locate_stata', () => {
    it('prefers --stata, then SIGHT_STATA_PATH', () => {
        const explicit = make_executable(path.join(tmp_dir, 'mine'));
        expect(locate_stata({ explicit_path: explicit, env: {} }))
            .toEqual({ found: true, path: explicit });
        expect(locate_stata({ env: { SIGHT_STATA_PATH: explicit } }))
            .toEqual({ found: true, path: explicit });
        expect(locate_stata({ explicit_path: path.join(tmp_dir, 'missing'), env: {} }).found)
            .toBe(false);
    });

    it('searches PATH by edition, most capable first', () => {
        const low = path.join(tmp_dir, 'a');
        const high = path.join(tmp_dir, 'b');
        make_executable(path.join(low, 'stata-se'));
        const mp = make_executable(path.join(high, 'stata-mp'));
        const result = locate_stata({ env: { PATH: [low, high].join(path.delimiter) }, platform: 'linux' });
        expect(result).toEqual({ found: true, path: mp });
    });

    it('skips a dangling symlink', () => {
        const bin = path.join(tmp_dir, 'bin');
        fs.mkdirSync(bin);
        fs.symlinkSync(path.join(tmp_dir, 'gone'), path.join(bin, 'stata-mp'));
        const result = locate_stata({ env: { PATH: bin }, platform: 'linux' });
        expect(result.found).toBe(false);
    });

    it('falls back to the macOS app bundles', () => {
        const wanted = '/Applications/StataNow/StataSE.app/Contents/MacOS/stata-se';
        const result = locate_stata({
            env: { PATH: '' },
            platform: 'darwin',
            is_executable: (file_path) => file_path === wanted,
        });
        expect(result).toEqual({ found: true, path: wanted });
    });
});

describe('History', () => {
    it('persists entries with private permissions and skips space-prefixed ones', () => {
        const file_path = path.join(tmp_dir, 'nested', 'console_history');
        const history = new History(file_path);
        history.add('display 1');
        history.add('display 1');
        history.add(' local password abc');
        history.add('');
        expect(history.all()).toEqual(['display 1']);
        expect(new History(file_path).all()).toEqual(['display 1']);
        expect(fs.statSync(file_path).mode & 0o777).toBe(0o600);
        expect(fs.statSync(path.dirname(file_path)).mode & 0o777).toBe(0o700);
    });

    it('honors the override and XDG locations', () => {
        expect(default_history_path({ SIGHT_CONSOLE_HISTORY: '/h' })).toBe('/h');
        expect(default_history_path({ XDG_DATA_HOME: '/data' }, 'linux'))
            .toBe(path.join('/data', 'sight', 'console_history'));
    });

    it('keeps history under APPDATA on Windows', () => {
        expect(default_history_path({ APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, 'win32'))
            .toBe(path.join('C:\\Users\\a\\AppData\\Roaming', 'sight', 'console_history'));
    });
});

describe('completion', () => {
    it('maps items to replacements and filters by exact-case prefix', () => {
        const candidates = to_candidates([
            { label: 'summarize' },
            { label: 'Summary' },
            { label: 'myloc', textEdit: { range: { start: { line: 0, character: 3 },
                end: { line: 0, character: 5 } }, newText: 'myloc\'' } },
            { label: 'snip', insertText: 'su${1:x}', insertTextFormat: 2 },
        ], 'su `my', 2);
        // Sorted by label; `Summary` fails the case-sensitive prefix, the
        // macro edit starts past the cursor, and the snippet is plain text.
        expect(candidates.map((my_item) => my_item.insert)).toEqual(['sux', 'summarize']);
    });

    it('suggests commands, options and names defined earlier this session', async () => {
        const completer = new SessionCompleter(tmp_dir);
        try {
            const commands = await completer.complete('su', 2);
            expect(commands.map((my_item) => my_item.label)).toContain('summarize');
            const options = await completer.complete('summarize x, de', 15);
            expect(options.map((my_item) => my_item.insert)).toContain('detail');

            completer.add_line('generate price_ratio = 1');
            const variables = await completer.complete('summarize price_', 16);
            expect(variables.map((my_item) => my_item.insert)).toContain('price_ratio');

            completer.drop_last_line();
            const after_drop = await completer.complete('summarize price_', 16);
            expect(after_drop.map((my_item) => my_item.insert)).not.toContain('price_ratio');
        } finally {
            await completer.dispose();
        }
    });
});

describe('run_console', () => {
    it('needs an interactive terminal on Windows', async () => {
        expect(await run_console([], { platform: 'win32', is_tty: false })).toBe(86);
    });

    it('rejects --stata on Windows, where Automation picks the Stata', async () => {
        expect(await run_console(['--stata', 'C:\\Stata\\StataMP-64.exe'], {
            platform: 'win32',
            is_tty: true,
        })).toBe(2);
    });

    it('reports a missing Stata', async () => {
        expect(await run_console([], { env: { PATH: tmp_dir }, platform: 'linux', is_tty: true }))
            .toBe(2);
    });

    it('runs Stata directly when not attached to a terminal', async () => {
        const script = path.join(tmp_dir, 'stata-mp');
        fs.writeFileSync(script, '#!/bin/sh\nexit 7\n', { mode: 0o755 });
        expect(await run_console(['--stata', script], { is_tty: false, platform: 'linux' }))
            .toBe(7);
    });
});
