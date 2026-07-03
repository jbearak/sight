/**
 * Property-Based Tests for Scope-Aware Local-Macro Providers (#270)
 *
 * Invariant: hover, go-to-definition, and completion queried from a
 * position inside program P for local macro N only ever surface N's
 * definition owned by P (or the do-file scope when P doesn't define
 * N) — never a sibling program's same-named local.
 */

import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { DefinitionProvider } from '../../src/providers/definition';
import { HoverProvider } from '../../src/providers/hover';
import { CompletionProvider } from '../../src/providers/completion';
import { CommandDatabase } from '../../src/commands';
import { arbitrary_non_reserved_identifier } from './generators';
import { create_document_state } from './helpers/document-utils';
import { Location } from 'vscode-languageserver';

function as_locations(
    result: Location | Location[] | null
): Location[] {
    if (!result) return [];
    return Array.isArray(result) ? result : [result];
}

// Two sibling programs both defining `name`, an optional do-file
// definition, and a reference inside the second program.
function build_source(
    prog_a: string,
    prog_b: string,
    name: string,
    with_dofile_def: boolean
): { source: string; reference_line: number; own_def_line: number } {
    const the_lines = [
        `program define ${prog_a}`,        // 0
        `    local ${name} sibling_val`,   // 1
        'end',                             // 2
        `program define ${prog_b}`,        // 3
        `    local ${name} own_val`,       // 4
        `    display \`${name}'`,          // 5
        'end',                             // 6
    ];
    if (with_dofile_def) {
        the_lines.push(`local ${name} dofile_val`); // 7
    }
    return {
        source: the_lines.join('\n'),
        reference_line: 5,
        own_def_line: 4,
    };
}

const arbitrary_scenario = fc.record({
    the_names: fc.uniqueArray(arbitrary_non_reserved_identifier(), {
        minLength: 3,
        maxLength: 3,
    }),
    with_dofile_def: fc.boolean(),
});

describe('scoped local-macro provider invariants (#270)', () => {
    it('definition and hover from inside a program never surface a sibling\'s definition', async () => {
        const definition_provider = new DefinitionProvider();
        const hover_provider = new HoverProvider(new CommandDatabase());
        await fc.assert(
            fc.asyncProperty(arbitrary_scenario, async (my_scenario) => {
                const [prog_a, prog_b, name] = my_scenario.the_names;
                const { source, reference_line, own_def_line } =
                    build_source(
                        prog_a, prog_b, name, my_scenario.with_dofile_def
                    );
                const document_state = create_document_state(source);
                // Anchor on the backtick: short generated names (e.g.
                // 'a') can also occur inside the word 'display'.
                const character = source
                    .split('\n')[reference_line]
                    .indexOf('`') + 1;

                const the_definition = await definition_provider.get_definition(
                    document_state,
                    { line: reference_line, character },
                );
                const the_lines = as_locations(the_definition).map(
                    my_loc => my_loc.range.start.line
                );
                // Only the program's own definition — never the
                // sibling's (line 1), never the do-file's (shadowed).
                expect(the_lines).toEqual([own_def_line]);

                const the_hover = await hover_provider.get_hover(
                    document_state,
                    { line: reference_line, character },
                );
                const hover_text =
                    (the_hover?.contents as { value?: string })?.value ?? '';
                expect(hover_text).toContain('own_val');
                expect(hover_text).not.toContain('sibling_val');
                expect(hover_text).not.toContain('dofile_val');
            }),
            { numRuns: 25 }
        );
    });

    it('completion inside a program offers its own local with its own value', async () => {
        const completion_provider = new CompletionProvider(
            new CommandDatabase()
        );
        await fc.assert(
            fc.asyncProperty(arbitrary_scenario, async (my_scenario) => {
                const [prog_a, prog_b, name] = my_scenario.the_names;
                const { source } = build_source(
                    prog_a, prog_b, name, my_scenario.with_dofile_def
                );
                // Complete right after a backtick appended inside
                // prog_b's body (before `end`).
                const the_lines = source.split('\n');
                the_lines.splice(6, 0, '    di "`');
                const patched = the_lines.join('\n');
                const document_state = create_document_state(patched);
                const the_completions =
                    await completion_provider.get_completions(
                        document_state,
                        { line: 6, character: 9 },
                        '`',
                    );
                const the_item = the_completions.find(
                    my_item => my_item.label === name
                );
                expect(the_item).toBeDefined();
                expect(the_item!.documentation).toBe('Value: own_val');
            }),
            { numRuns: 25 }
        );
    });
});
