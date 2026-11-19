import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { run_check_with_cwd } from '../../src/cli/check';
import { EXIT_CHECK_FAILED, EXIT_OK } from '../../src/cli/shared';

/**
 * `sight check` end to end for c_local names taken from positional
 * arguments, with the setter program in another file: a workspace ado
 * and an ado on the configured adopath. Stata 18 gives the caller the
 * local in both cases.
 */

function temp_dir(): string {
    return fs.realpathSync.native(
        fs.mkdtempSync(path.join(os.tmpdir(), 'sight-c-local-args-'))
    );
}

async function run_capture(argv: string[], cwd: string) {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await run_check_with_cwd(argv, cwd, {
        stdout: (text) => stdout.push(text),
        stderr: (text) => stderr.push(text),
    });
    return { code, stdout: stdout.join(''), stderr: stderr.join('') };
}

const SETTER_ADO = [
    'program define _getrhs',
    '    args where lcons',
    '    c_local `where\' "x1 x2"',
    '    if "`lcons\'" != "" {',
    '        c_local `lcons\' 1',
    '    }',
    'end',
    '',
].join('\n');

const GETTOKEN_ADO = [
    'program define getname',
    '    gettoken id 0 : 0, parse(", ")',
    '    c_local `id\' 1',
    'end',
    '',
].join('\n');

const MAIN_DO = [
    'program define avplot',
    '    quietly _getrhs rhs hascons',
    '    display "`rhs\' `hascons\'"',
    'end',
    'capture getname found , opt',
    'display "`found\'"',
    '',
].join('\n');

describe('sight check: c_local names from positional arguments', () => {
    it('resolves a setter program in a workspace ado', async () => {
        const root = temp_dir();
        try {
            fs.writeFileSync(path.join(root, '_getrhs.ado'), SETTER_ADO);
            fs.writeFileSync(path.join(root, 'getname.ado'), GETTOKEN_ADO);
            fs.writeFileSync(path.join(root, 'main.do'), MAIN_DO);
            const result = await run_capture(
                ['--workspace', root, '--no-config', '--quiet', 'main.do'],
                root
            );
            expect(result.stderr).toBe('');
            expect(result.stdout).toBe('');
            expect(result.code).toBe(EXIT_OK);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it('resolves a setter program on the adopath', async () => {
        const root = temp_dir();
        const ado_root = temp_dir();
        try {
            fs.writeFileSync(path.join(ado_root, '_getrhs.ado'), SETTER_ADO);
            fs.writeFileSync(path.join(ado_root, 'getname.ado'), GETTOKEN_ADO);
            fs.writeFileSync(
                path.join(root, 'sight.toml'),
                `adoPaths = [${JSON.stringify(ado_root)}]\n`
            );
            fs.writeFileSync(path.join(root, 'main.do'), MAIN_DO);
            const result = await run_capture(
                ['--workspace', root, '--quiet', 'main.do'],
                root
            );
            expect(result.stderr).toBe('');
            expect(result.stdout).toBe('');
            expect(result.code).toBe(EXIT_OK);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
            fs.rmSync(ado_root, { recursive: true, force: true });
        }
    });

    it('still warns for a macro argument', async () => {
        const root = temp_dir();
        try {
            fs.writeFileSync(path.join(root, '_getrhs.ado'), SETTER_ADO);
            fs.writeFileSync(path.join(root, 'main.do'), [
                'local target rhs',
                '_getrhs `target\'',
                'display "`rhs\'"',
                '',
            ].join('\n'));
            const result = await run_capture(
                ['--workspace', root, '--no-config', '--quiet', 'main.do'],
                root
            );
            expect(result.code).toBe(EXIT_CHECK_FAILED);
            expect(result.stdout).toContain('main.do:3:');
            expect(result.stdout).toContain('[undefined_macro]');
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    describe('a setter in a workspace .do file', () => {
        const LIBRARY_DO = [
            'program define review_setter',
            '    args name',
            '    c_local `name\' 1',
            'end',
            '',
        ].join('\n');

        async function check_main(main: string, library?: string) {
            const root = temp_dir();
            try {
                if (library !== undefined) {
                    fs.writeFileSync(path.join(root, 'library.do'), library);
                }
                fs.writeFileSync(path.join(root, 'main.do'), main);
                return await run_capture(
                    ['--workspace', root, '--no-config', '--quiet', 'main.do'],
                    root
                );
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        }

        it('warns when main.do never runs the file', async () => {
            const result = await check_main([
                'capture review_setter result',
                'display "`result\'"',
                '',
            ].join('\n'), LIBRARY_DO);
            expect(result.code).toBe(EXIT_CHECK_FAILED);
            expect(result.stdout).toContain('main.do:2:');
            expect(result.stdout).toContain('`result\' is not defined');
        });

        it('does not warn after main.do runs the file', async () => {
            const result = await check_main([
                'run library.do',
                'capture review_setter result',
                'display "`result\'"',
                '',
            ].join('\n'), LIBRARY_DO);
            expect(result.stdout).toBe('');
            expect(result.code).toBe(EXIT_OK);
        });

        it('warns when main.do defines the program after the call', async () => {
            const result = await check_main([
                'review_setter result',
                'display "`result\'"',
                LIBRARY_DO,
            ].join('\n'));
            expect(result.code).toBe(EXIT_CHECK_FAILED);
            expect(result.stdout).toContain('main.do:2:');
            expect(result.stdout).toContain('`result\' is not defined');
        });
    });
});
