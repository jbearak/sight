/**
 * Property test: option context is stable across statement wrapping (#310).
 *
 * A command with a trailing comma (`<cmd> <var>, <opt>`) is in OPTION context
 * regardless of how the statement is wrapped across physical lines. Rendering
 * the same statement (a) on a single line, (b) `#delimit ;`-wrapped at the
 * comma, and (c) `#delimit cr` `///`-wrapped at the comma must all detect
 * option context for the same command. This is the executable oracle for the
 * logical-statement-prefix fix: any wrapping that still lost the command would
 * produce a counter-example.
 */

import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { Position } from 'vscode-languageserver';
import { detect_completion_context } from '../../src/providers/completion';
import { create_real_document_state } from '../test-context-helper';
import { arbitrary_non_reserved_identifier } from './generators';

function option_context(source: string, position: Position) {
    const doc = create_real_document_state(source);
    return detect_completion_context(doc, position, doc.tokens);
}

describe('wrapped option context is stable (property, #310)', () => {
    it('detects option context for the same command in single-line, ;-wrap, and ///-wrap renderings', () => {
        fc.assert(
            fc.property(
                arbitrary_non_reserved_identifier(),
                arbitrary_non_reserved_identifier(),
                fc.constantFrom('', 'x', 'no', 'vc'),
                (command, variable, option_fragment) => {
                    // (a) single line: `cmd var, frag|`
                    const single = `${command} ${variable}, ${option_fragment}`;
                    const single_ctx = option_context(single, {
                        line: 0,
                        character: single.length,
                    });

                    // (b) ;-mode wrap, with a following statement so the cursor
                    // sits before a REAL terminator (not EOF) — this also guards
                    // the "cursor immediately before the statement terminator"
                    // anchor case.
                    const semi =
                        `#delimit ;\n${command} ${variable},\n` +
                        `    ${option_fragment} ;\ndisplay 1 ;`;
                    const semi_ctx = option_context(semi, {
                        line: 2,
                        character: 4 + option_fragment.length,
                    });

                    // (c) cr-mode /// wrap, again with a following statement.
                    const cr =
                        `${command} ${variable}, ///\n` +
                        `    ${option_fragment}\ndisplay 1`;
                    const cr_ctx = option_context(cr, {
                        line: 1,
                        character: 4 + option_fragment.length,
                    });

                    expect(single_ctx.type).toBe('option');
                    expect(semi_ctx.type).toBe('option');
                    expect(cr_ctx.type).toBe('option');
                    if (
                        single_ctx.type === 'option' &&
                        semi_ctx.type === 'option' &&
                        cr_ctx.type === 'option'
                    ) {
                        expect(semi_ctx.command).toBe(single_ctx.command);
                        expect(cr_ctx.command).toBe(single_ctx.command);
                        expect(single_ctx.command).toBe(command);
                    }
                }
            ),
            { numRuns: 200 }
        );
    });
});
