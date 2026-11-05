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
import { create_document_state } from '../property/helpers/document-utils';

/** Messages of the UNDEFINED_VARIABLE diagnostics (the check on). */
function undefined_variables(source: string): string[] {
    return create_document_state(source).diagnostics
        .filter((my_diagnostic) =>
            my_diagnostic.code === StataDiagnosticCode.UNDEFINED_VARIABLE)
        .map((my_diagnostic) => my_diagnostic.message);
}

async function check_output(source: string, config: string | null): Promise<string> {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sight-undefined-variable-'));
    try {
        fs.writeFileSync(path.join(root, 'main.do'), source);
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
