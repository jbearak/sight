/**
 * Unit tests for EmptyForvaluesRangeAnalyzer.
 *
 * Tests detection of `forvalues` ranges of numeric literals that run no
 * times, non-detection of ranges that run and of ranges with macro or
 * expression bounds, severity config, and `sight: ignore` suppression.
 *
 * The Stata behavior these tests encode was checked against StataMP 18:
 * `3/1`, `1(-1)3`, `3(1)1`, `3 4 to 1`, `3 4 : 1`, `-1/-3`, `1.5/0.5`
 * and `3 / 1` run 0 times; `3/3` runs once; `1/3`, `3(-1)1` and
 * `10 8 to 3` run 3, 3 and 4 times; a step of 0 is an error
 * ("increment may not be zero"); `- 1/-3` (detached sign) is an error.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DiagnosticSeverity } from 'vscode-languageserver';
import { run_check_with_cwd } from '../../src/cli/check';
import { DiagnosticsProvider } from '../../src/providers/diagnostics';
import { EmptyForvaluesRangeAnalyzer } from '../../src/providers/forvalues-range-diagnostics';
import { StataDiagnosticCode, StataLSPConfig } from '../../src/types';
import { DEFAULT_SETTINGS } from '../../src/server-handlers';
import { create_document_state } from '../property/helpers/document-utils';

describe('EmptyForvaluesRangeAnalyzer Unit Tests', () => {
    let analyzer: EmptyForvaluesRangeAnalyzer;
    let default_config: StataLSPConfig;

    beforeEach(() => {
        analyzer = new EmptyForvaluesRangeAnalyzer();
        default_config = {
            ...DEFAULT_SETTINGS,
            diagnostics: {
                ...DEFAULT_SETTINGS.diagnostics,
                severity: {
                    ...DEFAULT_SETTINGS.diagnostics.severity,
                },
            },
        };
    });

    const found = (source: string) =>
        analyzer
            .analyze(create_document_state(source), default_config)
            .filter(
                (d) => d.code === StataDiagnosticCode.EMPTY_FORVALUES_RANGE
            );

    const loop = (spec: string) =>
        `forvalues i = ${spec} {\n    display \`i'\n}\n`;

    describe('Diagnostic Code and Default Severity', () => {
        it('uses the symbolic rule id', () => {
            expect(StataDiagnosticCode.EMPTY_FORVALUES_RANGE).toBe(
                'EMPTY_FORVALUES_RANGE'
            );
        });
        it('defaults to warning', () => {
            expect(
                DEFAULT_SETTINGS.diagnostics.severity.emptyForvaluesRange
            ).toBe('warning');
        });
    });

    describe('Detection (positive)', () => {
        it('reports a/b with a > b and suggests the countdown', () => {
            const diagnostics = found(loop('3/1'));
            expect(diagnostics).toHaveLength(1);
            expect(diagnostics[0].severity).toBe(DiagnosticSeverity.Warning);
            expect(diagnostics[0].source).toBe('sight');
            expect(diagnostics[0].message).toBe(
                '`forvalues` range `3/1` runs no times (`a/b` counts up); ' +
                    'did you mean `3(-1)1`?'
            );
        });

        it('covers exactly the range expression', () => {
            // forvalues i = 3/1 {
            // 0         1    1
            // 0123456789012345678
            const diagnostics = found(loop('3/1'));
            expect(diagnostics[0].range).toEqual({
                start: { line: 0, character: 14 },
                end: { line: 0, character: 17 },
            });
        });

        it('covers a spaced range from its first to last token', () => {
            const diagnostics = found(loop('10 / 2'));
            expect(diagnostics).toHaveLength(1);
            expect(diagnostics[0].range).toEqual({
                start: { line: 0, character: 14 },
                end: { line: 0, character: 20 },
            });
            expect(diagnostics[0].message).toContain('did you mean `10(-1)2`?');
        });

        it('reports a(s)b with a negative step counting away', () => {
            const diagnostics = found(loop('1(-1)3'));
            expect(diagnostics).toHaveLength(1);
            expect(diagnostics[0].message).toBe(
                '`forvalues` range `1(-1)3` runs no times ' +
                    '(step `-1` counts away from `3`)'
            );
        });

        it('reports a(s)b with a positive step counting away', () => {
            const diagnostics = found(loop('3(1)1'));
            expect(diagnostics).toHaveLength(1);
            expect(diagnostics[0].message).toBe(
                '`forvalues` range `3(1)1` runs no times ' +
                    '(step `1` counts away from `1`)'
            );
            expect(diagnostics[0].message).not.toContain('did you mean');
        });

        it('reports a t to b whose implied step counts away', () => {
            const diagnostics = found(loop('3 4 to 1'));
            expect(diagnostics).toHaveLength(1);
            expect(diagnostics[0].message).toBe(
                '`forvalues` range `3 4 to 1` runs no times ' +
                    '(the step from `3` to `4` counts away from `1`)'
            );
        });

        it('reports the a t : b spelling of the same form', () => {
            const diagnostics = found(loop('3 4 : 1'));
            expect(diagnostics).toHaveLength(1);
            expect(diagnostics[0].message).toContain('`3 4 : 1`');
        });

        it('reports negative and decimal literals', () => {
            expect(found(loop('-1/-3'))).toHaveLength(1);
            expect(found(loop('1.5/0.5'))).toHaveLength(1);
            expect(found(loop('3(-.5)4'))).toHaveLength(1);
        });

        it('reports abbreviations, prefixes, and nested loops', () => {
            expect(found('forv i = 3/1 {\n}\n')).toHaveLength(1);
            expect(found('quietly forvalues i = 3/1 {\n}\n')).toHaveLength(1);
            expect(found('capture: forval i=3/1 {\n}\n')).toHaveLength(1);
            expect(
                found(
                    'program define p\n    forvalues i = 3/1 {\n' +
                        '        display `i\'\n    }\nend\n'
                )
            ).toHaveLength(1);
        });

        it('reports a range split by a /// continuation', () => {
            expect(found('forvalues i = 3 ///\n    /1 {\n}\n')).toHaveLength(
                1
            );
        });
    });

    describe('Non-detection (negative)', () => {
        const ranges_that_run = [
            '1/3',
            '3/3',
            '3(-1)1',
            '1(1)3',
            '3(-1)3',
            '10 8 to 3',
            '1 2 to 5',
            '1 2 : 5',
            '0.5/1.5',
        ];
        for (const my_spec of ranges_that_run) {
            it(`does not report ${my_spec}, which runs`, () => {
                expect(found(loop(my_spec))).toHaveLength(0);
            });
        }

        const macro_or_expression_ranges = [
            "1/`n'",
            "`n'/1",
            '3/$n',
            "3(`step')1",
            "3 `next' to 1",
            "3/1`n'",
            '3/(1)',
            '(3)/1',
            '3/1+0',
            '2+1/1',
            '3(0-1)1',
        ];
        for (const my_spec of macro_or_expression_ranges) {
            it(`does not report ${my_spec}, which is not all literals`, () => {
                expect(found(loop(my_spec))).toHaveLength(0);
            });
        }

        it('leaves a zero step to other checks', () => {
            expect(found(loop('1(0)3'))).toHaveLength(0);
            expect(found(loop('3(0)1'))).toHaveLength(0);
            expect(found(loop('3 3 to 1'))).toHaveLength(0);
        });

        it('does not treat a detached sign as a negative literal', () => {
            expect(found(loop('- 1/-3'))).toHaveLength(0);
        });

        it('ignores a header with no opening brace', () => {
            expect(found('forvalues i = 3/1\n')).toHaveLength(0);
        });

        it('does not match wrong-case or too-short command words', () => {
            expect(found('Forvalues i = 3/1 {\n}\n')).toHaveLength(0);
            expect(found('for i = 3/1 {\n}\n')).toHaveLength(0);
        });

        it('does not report text outside command position', () => {
            expect(
                found('display "forvalues i = 3/1 {"\n')
            ).toHaveLength(0);
        });
    });

    describe('Severity Configuration', () => {
        it('respects off', () => {
            default_config.diagnostics.severity.emptyForvaluesRange = 'off';
            expect(found(loop('3/1'))).toHaveLength(0);
        });
        it('respects error', () => {
            default_config.diagnostics.severity.emptyForvaluesRange = 'error';
            const diagnostics = found(loop('3/1'));
            expect(diagnostics[0].severity).toBe(DiagnosticSeverity.Error);
        });
    });

    describe('Suppression', () => {
        it('respects a standalone sight: ignore', () => {
            expect(found('// sight: ignore\n' + loop('3/1'))).toHaveLength(0);
        });
        it('respects sight: ignore-next', () => {
            expect(
                found('// sight: ignore-next\n' + loop('3/1'))
            ).toHaveLength(0);
        });
        it('respects a trailing sight: ignore', () => {
            expect(
                found('forvalues i = 3/1 { // sight: ignore\n}\n')
            ).toHaveLength(0);
        });
        it('still reports the next unsuppressed loop', () => {
            const diagnostics = found(
                '// sight: ignore-next\n' + loop('3/1') + loop('5/2')
            );
            expect(diagnostics).toHaveLength(1);
            expect(diagnostics[0].message).toContain('`5/2`');
        });
    });
});

describe('EMPTY_FORVALUES_RANGE through DiagnosticsProvider', () => {
    const provider_found = async (source: string) => {
        const my_provider = new DiagnosticsProvider({
            sendDiagnostics: () => {},
        });
        const the_diagnostics = await my_provider.get_diagnostics(
            create_document_state(source),
            DEFAULT_SETTINGS
        );
        return the_diagnostics.filter(
            (d) => d.code === StataDiagnosticCode.EMPTY_FORVALUES_RANGE
        );
    };

    it('publishes the diagnostic with a documentation link', async () => {
        const diagnostics = await provider_found('forvalues i = 3/1 {\n}\n');
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0].codeDescription?.href).toContain(
            '#empty-forvalues-range'
        );
    });

    it('honors sight: ignore-next', async () => {
        expect(
            await provider_found(
                '// sight: ignore-next\nforvalues i = 3/1 {\n}\n'
            )
        ).toHaveLength(0);
    });
});

describe('EMPTY_FORVALUES_RANGE in sight check JSON output', () => {
    it('reports the code, range, and message', async () => {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), 'sight-forvalues-range-')
        );
        try {
            fs.writeFileSync(
                path.join(root, 'main.do'),
                'forvalues j = 3/1 {\n    display `j\'\n}\n'
            );
            const stdout: string[] = [];
            await run_check_with_cwd(
                ['--workspace', root, '--no-config', '--format', 'json'],
                root,
                {
                    stdout: (text) => stdout.push(text),
                    stderr: () => {},
                }
            );
            const parsed = JSON.parse(stdout.join(''));
            const the_records = parsed.filter(
                (record: { diagnostic: { code: string } }) =>
                    record.diagnostic.code ===
                    StataDiagnosticCode.EMPTY_FORVALUES_RANGE
            );
            expect(the_records).toHaveLength(1);
            expect(the_records[0].diagnostic.message).toBe(
                '`forvalues` range `3/1` runs no times (`a/b` counts up); ' +
                    'did you mean `3(-1)1`?'
            );
            expect(the_records[0].diagnostic.range).toEqual({
                start: { line: 0, character: 14 },
                end: { line: 0, character: 17 },
            });
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
