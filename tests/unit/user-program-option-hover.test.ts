/**
 * Hover on an option at a call to a user program shows the `syntax`
 * option it spells, matched as StataMP 18 matches it: down to the
 * leading capitals, typed in lowercase.
 */

import { describe, it, expect } from 'bun:test';
import { HoverProvider } from '../../src/providers/hover';
import { CommandDatabase } from '../../src/commands';
import { DocumentStore } from '../../src/document-store';

const PROGRAM = [
    'program define p',
    '    syntax [, DETail Level(real 95)]',
    'end',
].join('\n');

async function hover_text(call: string, character: number): Promise<string | null> {
    const store = new DocumentStore();
    await store.open('file:///test.do', `${PROGRAM}\n${call}`, 1);
    const document = store.get('file:///test.do');
    if (!document) throw new Error('document did not open');
    const hover = await new HoverProvider(new CommandDatabase())
        .get_hover(document, { line: 3, character });
    const contents = hover?.contents;
    if (!contents) return null;
    return typeof contents === 'string'
        ? contents
        : 'value' in contents ? contents.value : JSON.stringify(contents);
}

describe('user program option hover', () => {
    it('shows the option an abbreviation spells', async () => {
        expect(await hover_text('p, det', 4)).toContain('**Option:** `DETail`');
        expect(await hover_text('p, detail', 6)).toContain('**Option:** `DETail`');
        expect(await hover_text('p, l(90)', 3)).toContain('**Option:** `Level`');
    });

    it('shows nothing for a spelling Stata rejects', async () => {
        // Shorter than the minimum, or capitalized.
        expect(await hover_text('p, de', 4)).toBeNull();
        expect(await hover_text('p, DETail', 5)).toBeNull();
    });

    it('shows nothing inside the option argument', async () => {
        expect(await hover_text('p, l(90)', 4)).toBeNull();
        expect(await hover_text('p, level(90)', 9)).toBeNull();
        expect(await hover_text('p, level(90)', 10)).toBeNull();
    });

    it('prefers the option to a function of the same name', async () => {
        const store = new DocumentStore();
        const source = [
            'program define q',
            '    syntax [, SUM(real 0)]',
            'end',
            'q, sum(1)',
            'display sum(1)',
        ].join('\n');
        await store.open('file:///sum.do', source, 1);
        const document = store.get('file:///sum.do');
        if (!document) throw new Error('document did not open');
        const provider = new HoverProvider(new CommandDatabase());
        const on_option = await provider.get_hover(
            document, { line: 3, character: 4 });
        expect(JSON.stringify(on_option?.contents))
            .toContain('**Option:** `SUM`');
        const on_function = await provider.get_hover(
            document, { line: 4, character: 9 });
        expect(JSON.stringify(on_function?.contents))
            .not.toContain('**Option:**');
    });
});
