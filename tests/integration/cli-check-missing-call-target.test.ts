/**
 * A do/run/include whose target does not exist is reported once, at
 * the caller's call site. Resolving a sibling callee's inherited scope
 * walks the caller's forward calls; that walk must not hand the
 * caller's missing-file warning to the sibling, where it was remapped
 * to the sibling's line 1.
 */

import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { run_check_with_cwd } from '../../src/cli/check';
import { StataDiagnosticCode } from '../../src/types';

interface JsonDiagnostic {
    path: string;
    diagnostic: {
        range: { start: { line: number; character: number } };
        message: string;
        code: string;
    };
}

function temp_dir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'sight-check-missing-'));
}

async function run_json(
    argv: string[],
    cwd: string,
): Promise<JsonDiagnostic[]> {
    const stdout: string[] = [];
    await run_check_with_cwd([...argv, '--format', 'json'], cwd, {
        stdout: (text) => stdout.push(text),
        stderr: () => {},
    });
    const the_parsed: unknown = JSON.parse(stdout.join(''));
    if (!Array.isArray(the_parsed)) {
        throw new Error('sight check --format json did not return an array');
    }
    return the_parsed as JsonDiagnostic[];
}

function missing_file_diagnostics(
    the_diagnostics: JsonDiagnostic[],
): JsonDiagnostic[] {
    return the_diagnostics.filter(
        my_entry => my_entry.diagnostic.code ===
            StataDiagnosticCode.CROSS_FILE_MISSING_FILE,
    );
}

const CALL_COMMANDS = ['do', 'run', 'include'] as const;

// The missing call both before and after the sibling call: the
// caller's forward walk covers every call, not only those before the
// sibling's call site.
const LAYOUTS = [
    {
        name: 'missing call before the sibling',
        caller: (command: string) =>
            `${command} "missing.do"\n${command} "other.do"\n`,
        missing_line: 0,
    },
    {
        name: 'missing call after the sibling',
        caller: (command: string) =>
            `${command} "other.do"\n${command} "missing.do"\n`,
        missing_line: 1,
    },
] as const;

describe('sight check: missing call target is reported once', () => {
    for (const my_command of CALL_COMMANDS) {
        for (const my_layout of LAYOUTS) {
            describe(`${my_command}, ${my_layout.name}`, () => {
                const write_files = (root: string): void => {
                    fs.writeFileSync(
                        path.join(root, 'main.do'),
                        my_layout.caller(my_command),
                    );
                    fs.writeFileSync(
                        path.join(root, 'other.do'),
                        'display "other"\n',
                    );
                };

                it('reports it at the call site when checking the caller',
                    async () => {
                        const root = temp_dir();
                        try {
                            write_files(root);
                            const the_found = missing_file_diagnostics(
                                await run_json(['main.do'], root),
                            );
                            expect(the_found).toHaveLength(1);
                            expect(the_found[0]?.path).toBe('main.do');
                            expect(the_found[0]?.diagnostic.range.start.line)
                                .toBe(my_layout.missing_line);
                            expect(the_found[0]?.diagnostic.message)
                                .toContain('missing.do');
                        } finally {
                            fs.rmSync(root, { recursive: true, force: true });
                        }
                    });

                it('does not report it when checking the sibling callee',
                    async () => {
                        const root = temp_dir();
                        try {
                            write_files(root);
                            const the_found = missing_file_diagnostics(
                                await run_json(['other.do'], root),
                            );
                            expect(the_found).toHaveLength(0);
                        } finally {
                            fs.rmSync(root, { recursive: true, force: true });
                        }
                    });

                it('reports it once in a --workspace run', async () => {
                    const root = temp_dir();
                    try {
                        write_files(root);
                        const the_found = missing_file_diagnostics(
                            await run_json(['--workspace', '.'], root),
                        );
                        expect(the_found).toHaveLength(1);
                        expect(the_found[0]?.path).toBe('main.do');
                        expect(the_found[0]?.diagnostic.range.start.line)
                            .toBe(my_layout.missing_line);
                    } finally {
                        fs.rmSync(root, { recursive: true, force: true });
                    }
                });
            });
        }
    }
});
