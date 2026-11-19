/**
 * Go to Definition, Hover and Find References on the word under the
 * cursor: a name with Unicode letters is one word, as the lexer reads
 * it, and a local that a program sets in its caller keeps to the
 * caller's program frame, the program under the cursor, and the ado
 * a call loads (see docs/find-references.md).
 */

import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { URI } from 'vscode-uri';
import { Location, Position } from 'vscode-languageserver';
import { build_check_context } from '../../src/cli/check';
import { DEFAULT_SETTINGS } from '../../src/server-handlers';
import { DefinitionProvider } from '../../src/providers/definition';
import { HoverProvider } from '../../src/providers/hover';
import { ReferencesProvider } from '../../src/providers/references';
import { SymbolProvider } from '../../src/providers/symbols';
import { CommandDatabase } from '../../src/command-database';

interface Navigation {
    /** Start of each reference in main.do, as `line:character`. */
    references: string[];
    /** Start of each definition in main.do, as `line:character`. */
    definitions: string[];
    hover: string | null;
}

function make_workspace(files: Record<string, string>): string {
    const root = fs.realpathSync.native(fs.mkdtempSync(
        path.join(os.tmpdir(), 'sight-navigation-word-')
    ));
    for (const [my_path, my_text] of Object.entries(files)) {
        fs.writeFileSync(path.join(root, my_path), my_text);
    }
    return root;
}

function starts(result: Location | Location[] | null | undefined): string[] {
    if (!result) return [];
    const the_locations = Array.isArray(result) ? result : [result];
    return the_locations
        .filter((my_location) => my_location.uri.endsWith('/main.do'))
        .map((my_location) =>
            `${my_location.range.start.line}:${my_location.range.start.character}`);
}

/** Navigation from each position in main.do (zero-based). */
async function navigate(
    files: Record<string, string>,
    positions: Position[]
): Promise<Navigation[]> {
    const root = make_workspace(files);
    try {
        const {
            document_store: store,
            scope_resolver: resolver,
            workspace_indexer: index,
        } = await build_check_context(root, DEFAULT_SETTINGS);
        const uri = URI.file(path.join(root, 'main.do')).toString();
        const symbols = index.get_all_symbols();
        await store.open(uri, files['main.do'], 1, symbols);
        const doc = store.get(uri)!;
        const the_results: Navigation[] = [];
        for (const my_position of positions) {
            const references = await new ReferencesProvider(resolver)
                .get_references(
                    doc, my_position, { includeDeclaration: true }, index);
            const definition = await new DefinitionProvider().get_definition(
                doc, my_position, symbols, doc.context_tracker, resolver,
                index);
            const hover = await new HoverProvider(new CommandDatabase())
                .get_hover(doc, my_position, symbols, resolver, undefined,
                    undefined, root, index);
            const contents = hover?.contents;
            the_results.push({
                references: starts(references),
                definitions: starts(definition),
                hover: contents && typeof contents === 'object'
                    && 'value' in contents ? contents.value : null,
            });
        }
        store.dispose();
        return the_results;
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

describe('navigation: a name with Unicode letters is one word', () => {
    it('finds a variable', async () => {
        const [result] = await navigate({
            'main.do': 'set obs 1\ngenerate café = 1\nsummarize café\n',
        }, [{ line: 2, character: 11 }]);
        expect(result.references).toEqual(['1:9', '2:10']);
        expect(result.definitions).toEqual(['1:9']);
        expect(result.hover).toContain('`café`');
    });

    it('finds a local macro', async () => {
        const [result] = await navigate({
            'main.do': 'local année 5\ndisplay "`année\'"\n',
        }, [{ line: 1, character: 12 }]);
        // As for an ASCII name: the definition is the `local`
        // statement, the read is the whole macro reference.
        expect(result.references).toEqual(['0:0', '1:9']);
        expect(result.definitions).toEqual(['0:0']);
        expect(result.hover).toContain('**Local Macro:** `année`');
    });

    it('finds a program', async () => {
        const [result] = await navigate({
            'main.do': 'program define résumé\n    display 1\nend\nrésumé\n',
        }, [{ line: 3, character: 5 }]);
        expect(result.references).toEqual(['0:15', '3:0']);
        expect(result.definitions).toEqual(['0:0']);
        expect(result.hover).toContain('**Program:** `résumé`');
    });

    it('selects a program name in the outline', async () => {
        const root = make_workspace({
            'main.do': 'program define résumé\n    display 1\nend\n',
        });
        try {
            const { document_store: store, workspace_indexer: index } =
                await build_check_context(root, DEFAULT_SETTINGS);
            const uri = URI.file(path.join(root, 'main.do')).toString();
            await store.open(uri, 'program define résumé\n    display 1\nend\n',
                1, index.get_all_symbols());
            const the_symbols = new SymbolProvider()
                .get_document_symbols(store.get(uri)!);
            store.dispose();
            const program = the_symbols.find(
                (my_symbol) => my_symbol.name === 'résumé');
            expect(program?.selectionRange).toEqual({
                start: { line: 0, character: 15 },
                end: { line: 0, character: 21 },
            });
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});

describe('navigation: a local a program sets in its caller', () => {
    it('gives the program\'s references on a call to it', async () => {
        const [on_call, on_read] = await navigate({
            'main.do': [
                'program define makeflag',
                '    c_local done 1',
                'end',
                'makeflag',
                'makeflag',
                'display "`done\'"',
                '',
            ].join('\n'),
        }, [{ line: 3, character: 1 }, { line: 5, character: 12 }]);
        expect(on_call.references).toEqual(['0:15', '3:0', '4:0']);
        // The read still finds the calls that set it.
        expect(on_read.references).toEqual(['3:0', '4:0', '5:9']);
    });

    it('keeps references in the program frame of the read', async () => {
        const [result] = await navigate({
            'main.do': [
                'program define markdone',
                '    c_local done 1',
                'end',
                'program define first',
                '    markdone',
                '    display "`done\'"',
                'end',
                'program define second',
                '    markdone',
                '    display "`done\'"',
                'end',
                '',
            ].join('\n'),
        }, [{ line: 5, character: 15 }]);
        expect(result.references).toEqual(['4:4', '5:13']);
    });

    it('finds the argument word of a call that loads an ado', async () => {
        const the_results = await navigate({
            'alib.do': 'program define setter\n    display 1\nend\n',
            'setter.ado': [
                'program define setter',
                '    args dest',
                '    c_local `dest\' 1',
                'end',
                '',
            ].join('\n'),
            'main.do': [
                'run alib.do',
                'program drop setter',
                'setter result',
                'display "`result\'"',
                '',
            ].join('\n'),
        }, [{ line: 3, character: 11 }, { line: 2, character: 8 }]);
        for (const my_result of the_results) {
            expect(my_result.references).toEqual(['2:7', '3:9']);
        }
        expect(the_results[0].definitions).toEqual(['2:7']);
    });
});
