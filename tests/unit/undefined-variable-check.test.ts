/**
 * The opt-in UNDEFINED_VARIABLE check. `diagnostics.severity.
 * undefinedVariable` had never reached the analyzer outside tests.
 * Turned on as it was, the check read every argument of every command
 * as a variable (514,800 diagnostics over Stata's base ados: `as` and
 * `err` in `di as err`, numbers, strings, macro references). It now
 * checks only commands whose arguments are a varlist of existing
 * variables, and only plain names standing on their own.
 */
import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { run_check_with_cwd } from '../../src/cli/check';
import { StataDiagnosticCode } from '../../src/types';
import { VARIABLE_COMMAND_MIN_ABBREVIATIONS } from '../../src/analyzer';
import { create_document_state } from '../property/helpers/document-utils';

/** Messages of the UNDEFINED_VARIABLE diagnostics (the check on). */
function undefined_variables(source: string): string[] {
    return create_document_state(source).diagnostics
        .filter((my_diagnostic) =>
            my_diagnostic.code === StataDiagnosticCode.UNDEFINED_VARIABLE)
        .map((my_diagnostic) => my_diagnostic.message);
}

async function check_output(
    source: string,
    config: string | null,
    the_other_files: Record<string, string> = {}
): Promise<string> {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sight-undefined-variable-'));
    try {
        fs.writeFileSync(path.join(root, 'main.do'), source);
        for (const [my_name, my_text] of Object.entries(the_other_files)) {
            fs.writeFileSync(path.join(root, my_name), my_text);
        }
        const the_args = ['--workspace', root, '--quiet', '--color', 'never'];
        if (config === null) {
            the_args.push('--no-config');
        } else {
            fs.writeFileSync(path.join(root, 'sight.toml'), config);
        }
        const the_output: string[] = [];
        await run_check_with_cwd(the_args, root, {
            stdout: (text) => the_output.push(text),
            stderr: (text) => the_output.push(text),
        });
        return the_output.join('');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

describe('the undefinedVariable setting', () => {
    const SOURCE = 'gen price = 1\nsummarize price weight\n';

    it('reports an undefined variable when the setting is on', async () => {
        const output = await check_output(
            SOURCE,
            '[diagnostics.severity]\nundefinedVariable = "information"\n'
        );
        expect(output).toContain('weight may not be defined');
        expect(output).not.toContain('price may not be defined');
    });

    it('accepts an abbreviation of a variable an included file defines', async () => {
        const output = await check_output(
            'include "defs.do"\nsu pri\nsu zz\n',
            '[diagnostics.severity]\nundefinedVariable = "information"\n',
            { 'defs.do': 'gen price = 1\n' }
        );
        expect(output).not.toContain('pri may not be defined');
        expect(output).toContain('zz may not be defined');
    });

    it('reports nothing with the default (off)', async () => {
        expect(await check_output(SOURCE, null)).not.toContain('may not be defined');
    });
});

describe('the undefined-variable check', () => {
    it('checks the varlist of a varlist command', () => {
        expect(undefined_variables('su z\nregress y x\n')).toEqual([
            'z may not be defined',
            'y may not be defined',
            'x may not be defined',
        ]);
    });

    it('checks only the target of replace', () => {
        expect(undefined_variables('replace q = r\n')).toEqual(['q may not be defined']);
    });

    it('accepts an abbreviation of a known variable', () => {
        expect(undefined_variables('gen price = 1\nsu pri\n')).toEqual([]);
    });

    it('skips commands whose arguments are not a varlist', () => {
        expect(undefined_variables(
            'di as err "x"\nscalar s = 1\nlocal a b\nmatrix m = J(1,1,0)\nlabel define l 1 "a"\n'
        )).toEqual([]);
    });

    it('matches the command name in exact case', () => {
        expect(undefined_variables('SUMMARIZE w\nSu w\n')).toEqual([]);
    });

    it('skips macros, numbers, strings, wildcards and keywords', () => {
        expect(undefined_variables(
            "list `v' $g 1 \"a\" x* (b)\ndrop _all\nsu v`i'\n"
        )).toEqual([]);
    });

    it('skips factor-variable and time-series operators', () => {
        expect(undefined_variables(
            'gen y = 1\ngen x = 1\ngen z = 1\nregress y i.x L.z c.x#c.z\n'
        )).toEqual([]);
    });
});

describe('confirm variable', () => {
    it('defines the variable for every abbreviation of variable', () => {
        for (const my_word of ['variable', 'var', 'va', 'v']) {
            expect(undefined_variables(`confirm ${my_word} price\nsu price\n`))
                .toEqual([]);
        }
    });

    it('defines nothing for a capitalized subcommand, which Stata rejects', () => {
        expect(undefined_variables('confirm Variable price\nsu price\n'))
            .toEqual(['price may not be defined']);
    });
});

/**
 * Commands that create variables, in every spelling Stata accepts.
 * The minimum abbreviations are the command database's
 * `min_abbreviation` (`g`, `inp`, `ren`, `conf`).
 */
describe('abbreviated variable-creating commands', () => {
    /** `name` and each abbreviation of it down to `min_length`. */
    function spellings(name: string, min_length: number): string[] {
        const the_spellings: string[] = [];
        for (let i = min_length; i <= name.length; i++) {
            the_spellings.push(name.slice(0, i));
        }
        return the_spellings;
    }

    it('defines the variable for every abbreviation of generate', () => {
        for (const my_command of spellings('generate', 1)) {
            expect(undefined_variables(
                `set obs 1\n${my_command} year = 1\nlist year\n`
            )).toEqual([]);
        }
    });

    it('defines the variable after a storage type', () => {
        expect(undefined_variables(
            'g byte year = 1\nge double x = 2\nlist year x\n'
        )).toEqual([]);
    });

    it('defines the variable for every abbreviation of rename', () => {
        for (const my_command of spellings('rename', 3)) {
            expect(undefined_variables(
                `gen a = 1\n${my_command} a b\nlist b\n`
            )).toEqual([]);
        }
    });

    it('defines the variables for every abbreviation of input', () => {
        for (const my_command of spellings('input', 3)) {
            expect(undefined_variables(
                `${my_command} a b\n1 2\nend\nlist a b\n`
            )).toEqual([]);
        }
    });

    it('defines the variable for every abbreviation of confirm', () => {
        for (const my_command of spellings('confirm', 4)) {
            expect(undefined_variables(
                `${my_command} variable price\nsu price\n`
            )).toEqual([]);
        }
    });

    it('does not define the storage types input names', () => {
        // `inp double wage` creates only `wage`, so `doub` and `str1`
        // abbreviate nothing (they did, when the types were taken as
        // variable names, in every spelling of input).
        for (const my_command of spellings('input', 3)) {
            expect(undefined_variables([
                `${my_command} double wage str10 city float f byte b`,
                '1 Boston 1 1',
                'end',
                'list doub str1 floa byt wage city f b',
            ].join('\n') + '\n')).toEqual([
                'doub may not be defined',
                'str1 may not be defined',
                'floa may not be defined',
                'byt may not be defined',
            ]);
        }
    });

    /**
     * Each statement, written with every spelling of its command,
     * leaves the same undefined variables as with the full word.
     */
    const SAME_AS_FULL_WORD: Array<{
        command: keyof typeof VARIABLE_COMMAND_MIN_ABBREVIATIONS;
        source: (command: string) => string;
    }> = [
        {
            command: 'generate',
            source: (my_command) => [
                'set obs 1',
                `${my_command} byte x = 1`,
                `${my_command} double y:ylab = 2`,
                `${my_command} str5 s = "a"`,
                `${my_command} strL t = "a"`,
                `${my_command} z = 1`,
                'list x y s t z doub str5 byt ylab',
            ].join('\n') + '\n',
        },
        {
            command: 'input',
            source: (my_command) => [
                `${my_command} double wage str10 city strL note long l int i`,
                '1 a b 1 1',
                'end',
                'list doub str1 strL lon wage city note l i',
            ].join('\n') + '\n',
        },
        {
            command: 'rename',
            source: (my_command) => [
                'set obs 1',
                'gen a = 1',
                'gen b = 1',
                'gen c1 = 1',
                'gen e1 = 1',
                `${my_command} a a2`,
                `${my_command} (b c1) (b2 c2)`,
                `${my_command} e* f*`,
                'list a2 b2 c2 f1',
            ].join('\n') + '\n',
        },
        {
            command: 'confirm',
            source: (my_command) => [
                `capture ${my_command} variable p`,
                `capture ${my_command} var q`,
                `capture ${my_command} v r`,
                `capture ${my_command} numeric variable s`,
                'list p q r s',
            ].join('\n') + '\n',
        },
    ];

    for (const my_case of SAME_AS_FULL_WORD) {
        it(`treats every abbreviation of ${my_case.command} as the full word`, () => {
            const expected = undefined_variables(my_case.source(my_case.command));
            for (const my_command of spellings(
                my_case.command,
                VARIABLE_COMMAND_MIN_ABBREVIATIONS[my_case.command]
            )) {
                expect(undefined_variables(my_case.source(my_command)))
                    .toEqual(expected);
            }
        });
    }

    it('reads the storage types in the full-word cases', () => {
        expect(undefined_variables(SAME_AS_FULL_WORD[0].source('generate')))
            .toEqual([
                'doub may not be defined',
                'str5 may not be defined',
                'byt may not be defined',
                'ylab may not be defined',
            ]);
        expect(undefined_variables(SAME_AS_FULL_WORD[1].source('input')))
            .toEqual([
                'doub may not be defined',
                'str1 may not be defined',
                'strL may not be defined',
                'lon may not be defined',
            ]);
    });

    it('defines nothing for a shorter or capitalized spelling', () => {
        expect(undefined_variables(
            'G year = 1\nre a b\ninpu2 c\ncon variable d\nlist year b c d\n'
        )).toEqual([
            'year may not be defined',
            'b may not be defined',
            'c may not be defined',
            'd may not be defined',
        ]);
    });

    it('matches the command database minimum abbreviations', () => {
        const cache = JSON.parse(fs.readFileSync(path.join(
            import.meta.dir, '../../src/command-database/caches/v18.json'
        ), 'utf8')) as {
            commands: Record<string, { min_abbreviation: number }>;
        };
        expect(Object.fromEntries(
            ['generate', 'egen', 'input', 'rename', 'confirm'].map(
                (my_name) => [my_name, cache.commands[my_name]?.min_abbreviation]
            )
        )).toEqual(VARIABLE_COMMAND_MIN_ABBREVIATIONS);
    });
});
