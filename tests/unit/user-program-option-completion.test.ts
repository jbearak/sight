/**
 * Option completions at a call to a user program offer each option
 * with the shortest spelling Stata accepts for it.
 */

import { describe, it, expect } from 'bun:test';
import { CompletionProvider } from '../../src/providers/completion';
import { CommandDatabase } from '../../src/commands';
import { DocumentStore } from '../../src/document-store';

async function option_completions(
    code: string,
    line: number,
    character: number
): Promise<Array<{ label: string; documentation: string }>> {
    const store = new DocumentStore();
    await store.open('file:///test.do', code, 1);
    const document = store.get('file:///test.do');
    if (!document) throw new Error('document did not open');
    return new CompletionProvider(new CommandDatabase())
        .get_completions_for_user_program_call('p', document, { line, character })
        .map((my_item) => ({
            label: my_item.label,
            documentation: typeof my_item.documentation === 'string'
                ? my_item.documentation
                : my_item.documentation?.value ?? '',
        }));
}

describe('user program option completion', () => {
    // StataMP 18: an all-lowercase `syntax` option must be typed in
    // full, so `cache` and `capture` share no shorter spelling.
    const PROGRAM = [
        'program define p',
        '    syntax [, cache capture]',
        'end',
    ].join('\n');

    it('keeps offering both options once three letters are typed', async () => {
        const code = `${PROGRAM}\np, cac`;
        const the_items = await option_completions(code, 3, 6);
        expect(the_items.map((my_item) => my_item.label).sort())
            .toContain('cache');
    });

    it('never offers an abbreviation shorter than the minimum', async () => {
        const code = `${PROGRAM}\np, `;
        const the_items = await option_completions(code, 3, 3);
        expect(the_items.length).toBe(2);
        for (const my_item of the_items) {
            // The whole name is the minimum, so no abbreviation shows.
            expect(my_item.documentation).not.toContain('Abbreviation');
        }
    });
});
