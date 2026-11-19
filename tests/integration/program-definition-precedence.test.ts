import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { URI } from 'vscode-uri';
import { build_check_context, run_check_with_cwd } from '../../src/cli/check';
import { DEFAULT_SETTINGS } from '../../src/server-handlers';
import { WorkspaceIndexer } from '../../src/indexer';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { SemanticAnalyzer } from '../../src/analyzer';
import { DefinitionProvider } from '../../src/providers/definition';
import { HoverProvider } from '../../src/providers/hover';
import { CompletionProvider } from '../../src/providers/completion';
import { ReferencesProvider } from '../../src/providers/references';
import { CommandDatabase } from '../../src/command-database';
import { StataDiagnosticCode, SymbolTable } from '../../src/types';

/**
 * Which definition of a program a call uses for the caller locals it
 * sets (`c_local`, a `local()` option, or a `c_local` of an argument).
 * In Stata a program already in memory is used: one a do-file that
 * ran defined, or one defined earlier in the same file. The ado named
 * after the program is loaded only when no program of that name is in
 * memory, also after `program drop` (checked in StataMP 18).
 */

function make_workspace(files: Record<string, string>): string {
    const root = fs.realpathSync.native(fs.mkdtempSync(
        path.join(os.tmpdir(), 'sight-program-precedence-')
    ));
    for (const [my_path, my_text] of Object.entries(files)) {
        const full = path.join(root, my_path);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, my_text);
    }
    return root;
}

async function undefined_in_main(
    files: Record<string, string>
): Promise<string[]> {
    const root = make_workspace(files);
    try {
        const the_out: string[] = [];
        const the_err: string[] = [];
        await run_check_with_cwd(
            ['--workspace', root, '--no-config', '--format', 'json', 'main.do'],
            root,
            {
                stdout: (text) => the_out.push(text),
                stderr: (text) => the_err.push(text),
            }
        );
        expect(the_err.join('')).toBe('');
        const the_records = JSON.parse(the_out.join('')) as Array<{
            path: string;
            diagnostic: { code?: string; data?: { symbol_name?: string } };
        }>;
        return the_records
            .filter((my_record) => my_record.path === 'main.do'
                && my_record.diagnostic.code === 'UNDEFINED_MACRO')
            .map((my_record) => my_record.diagnostic.data?.symbol_name ?? '');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

const LITERAL_SETTER = 'program setter\n    c_local result 1\nend\n';
const DISPLAY_SETTER = 'program setter\n    display 1\nend\n';
const ARG_SETTER = 'program define setter\n    args dest\n    c_local `dest\' 1\nend\n';
const ARG_DISPLAY_SETTER = 'program setter\n    args x\n    display "`x\'"\nend\n';
const OPTION_SETTER = 'program setter\n    syntax, Local(name)\n    c_local `local\' 1\nend\n';
const OPTION_DISPLAY_SETTER = 'program setter\n    syntax, Local(name)\n    display "`local\'"\nend\n';

interface Case {
    name: string;
    files: Record<string, string>;
    undefined: string[];
}

const CASES: Case[] = [
    {
        name: 'a loaded literal c_local beats an ado that sets nothing',
        files: {
            'main.do': 'run overrides.do\nsetter\ndisplay "`result\'"\n',
            'overrides.do': LITERAL_SETTER,
            'setter.ado': DISPLAY_SETTER,
        },
        undefined: [],
    },
    {
        name: 'a loaded program that sets nothing beats an ado c_local of an argument',
        files: {
            'main.do': 'run overrides.do\nsetter result\ndisplay "`result\'"\n',
            'overrides.do': ARG_DISPLAY_SETTER,
            'setter.ado': ARG_SETTER,
        },
        undefined: ['result'],
    },
    {
        name: 'a loaded local() option beats an ado without one',
        files: {
            'main.do': 'run overrides.do\nsetter, local(result)\ndisplay "`result\'"\n',
            'overrides.do': OPTION_SETTER,
            'setter.ado': OPTION_DISPLAY_SETTER,
        },
        undefined: [],
    },
    {
        name: 'a loaded program without a local() option beats an ado with one',
        files: {
            'main.do': 'run overrides.do\nsetter, local(result)\ndisplay "`result\'"\n',
            'overrides.do': OPTION_DISPLAY_SETTER,
            'setter.ado': OPTION_SETTER,
        },
        undefined: ['result'],
    },
    {
        name: 'a loaded program that sets nothing beats an ado literal c_local',
        files: {
            'main.do': 'run overrides.do\nsetter\ndisplay "`result\'"\n',
            'overrides.do': DISPLAY_SETTER,
            'setter.ado': LITERAL_SETTER,
        },
        undefined: ['result'],
    },
    {
        name: 'the ado is loaded when nothing defined the program',
        files: {
            'main.do': 'setter result\ndisplay "`result\'"\n',
            'other.do': ARG_DISPLAY_SETTER,
            'setter.ado': ARG_SETTER,
        },
        undefined: [],
    },
    {
        name: 'the ado is loaded after program drop',
        files: {
            'main.do': 'run overrides.do\nprogram drop setter\n'
                + 'setter result\ndisplay "`result\'"\n',
            'overrides.do': ARG_DISPLAY_SETTER,
            'setter.ado': ARG_SETTER,
        },
        undefined: [],
    },
    {
        name: 'two unloaded .do definitions and no ado credit nothing',
        files: {
            'main.do': 'setter\ndisplay "`result\'"\n',
            'alib.do': LITERAL_SETTER,
            'zlib.do': DISPLAY_SETTER,
        },
        undefined: ['result'],
    },
];

describe('sight check: the definition a call reaches sets caller locals', () => {
    for (const my_case of CASES) {
        it(my_case.name, async () => {
            // Repeated: the index order must not decide the answer.
            for (let i = 0; i < 3; i++) {
                expect(await undefined_in_main(my_case.files))
                    .toEqual(my_case.undefined);
            }
        });
    }
});

function analyze_undefined(code: string, symbols: SymbolTable): string[] {
    const tokens = new StataLexer().tokenize(code).tokens;
    const ast = new StataParser().parse(tokens).ast;
    const result = new SemanticAnalyzer().analyze(
        ast, 'file:///elsewhere/main.do', symbols,
        { undefined_macro_enabled: true }, tokens
    );
    return result.diagnostics
        .filter((d) => d.code === StataDiagnosticCode.UNDEFINED_MACRO)
        .map((d) => /`([^']+)'/.exec(d.message)?.[1] ?? d.message);
}

describe('workspace index: program definitions do not depend on index order', () => {
    async function symbols_in_order(
        root: string,
        the_files: string[]
    ): Promise<SymbolTable> {
        const indexer = new WorkspaceIndexer();
        await indexer.initialize([]);
        for (const my_file of the_files) {
            await indexer.index_file(path.join(root, my_file));
        }
        return indexer.get_all_symbols();
    }

    for (const my_files of [
        { 'alib.do': LITERAL_SETTER, 'zlib.do': DISPLAY_SETTER },
        { 'alib.do': DISPLAY_SETTER, 'zlib.do': LITERAL_SETTER },
        { 'overrides.do': OPTION_SETTER, 'setter.ado': OPTION_DISPLAY_SETTER },
    ]) {
        const the_names = Object.keys(my_files);
        it(`gives one answer for ${the_names.join(' and ')}`, async () => {
            const root = make_workspace(my_files);
            try {
                const forward = await symbols_in_order(root, the_names);
                const backward = await symbols_in_order(
                    root, [...the_names].reverse());
                expect(forward.programs.get('setter')?.sourceUri)
                    .toBe(backward.programs.get('setter')?.sourceUri);
                for (const my_code of [
                    'setter\ndisplay "`result\'"\n',
                    'setter, local(result)\ndisplay "`result\'"\n',
                ]) {
                    expect(analyze_undefined(my_code, forward))
                        .toEqual(analyze_undefined(my_code, backward));
                }
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        });
    }
});

describe('workspace index: a helper defined in the calling ado', () => {
    // Helper names repeat across ados (`ParseName`, `Estimate`). A
    // call inside a program body reaches this file's own helper,
    // however the other files were indexed.
    const CALLER = [
        'program define caller',
        '    Helper result',
        '    display "`result\'"',
        'end',
        'program define Helper',
        '    args where',
        '    c_local `where\' 1',
        'end',
        '',
    ].join('\n');
    const OTHER = 'program define Helper\n    args x\n    display "`x\'"\nend\n';

    it('credits the call in both index orders', async () => {
        const root = make_workspace({
            'caller.ado': CALLER, 'a_other.ado': OTHER, 'z_other.ado': OTHER,
        });
        try {
            for (const the_order of [
                ['a_other.ado', 'caller.ado', 'z_other.ado'],
                ['z_other.ado', 'caller.ado', 'a_other.ado'],
            ]) {
                const indexer = new WorkspaceIndexer();
                await indexer.initialize([]);
                for (const my_file of the_order) {
                    await indexer.index_file(path.join(root, my_file));
                }
                const tokens = new StataLexer().tokenize(CALLER).tokens;
                const ast = new StataParser().parse(tokens).ast;
                const result = new SemanticAnalyzer().analyze(
                    ast, URI.file(path.join(root, 'caller.ado')).toString(),
                    indexer.get_all_symbols(),
                    { undefined_macro_enabled: true }, tokens
                );
                expect(result.diagnostics.filter(
                    (d) => d.code === StataDiagnosticCode.UNDEFINED_MACRO
                )).toEqual([]);
            }
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});

/**
 * Navigation for a local that a loaded program sets through a
 * `c_local` of an argument: wherever the warning is suppressed, the
 * argument word at the call is the local's definition.
 */
async function navigate(files: Record<string, string>): Promise<{
    definition: unknown;
    hover: string | null;
    offers: boolean;
    references: Array<{ line: number; character: number }>;
    references_from_argument: Array<{ line: number; character: number }>;
}> {
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
        const lines = files['main.do'].split('\n');
        const read_line = lines.findIndex((my_line) => my_line.startsWith('display'));
        const at_name = { line: read_line, character: lines[read_line].indexOf('result') + 2 };
        const definition = await new DefinitionProvider().get_definition(
            doc, at_name, symbols, doc.context_tracker, resolver, index);
        const hover = await new HoverProvider(new CommandDatabase()).get_hover(
            doc, at_name, symbols, resolver, undefined, undefined, root, index);
        const items = await new CompletionProvider().get_completions(
            doc, { line: read_line, character: lines[read_line].indexOf('`') + 1 },
            '`', resolver, symbols);
        const references = await new ReferencesProvider(resolver).get_references(
            doc, at_name, { includeDeclaration: true }, index);
        const call_line = lines.findIndex((my_line) => my_line.startsWith('setter'));
        const at_argument = {
            line: call_line,
            character: lines[call_line].lastIndexOf('result') + 1,
        };
        const from_argument = await new ReferencesProvider(resolver).get_references(
            doc, at_argument, { includeDeclaration: true }, index);
        store.dispose();
        const contents = hover?.contents;
        return {
            definition,
            hover: contents && typeof contents === 'object' && 'value' in contents
                ? contents.value : null,
            offers: items.some((my_item) => my_item.label === 'result'),
            references: references
                .filter((my_location) => my_location.uri === uri)
                .map((my_location) => my_location.range.start),
            references_from_argument: from_argument
                .filter((my_location) => my_location.uri === uri)
                .map((my_location) => my_location.range.start),
        };
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

describe('navigation: a local set by a loaded program', () => {
    it('treats the argument word as the definition', async () => {
        const result = await navigate({
            'lib.do': ARG_SETTER,
            'main.do': 'run lib.do\nsetter result\ndisplay "`result\'"\n',
        });
        expect(result.definition).toEqual({
            uri: expect.stringContaining('main.do'),
            range: {
                start: { line: 1, character: 7 },
                end: { line: 1, character: 13 },
            },
        });
        expect(result.hover).toContain('**Local Macro:** `result`');
        expect(result.offers).toBe(true);
        expect(result.references).toEqual([
            { line: 1, character: 7 },
            { line: 2, character: 9 },
        ]);
        expect(result.references_from_argument).toEqual(result.references);
    });

    it('treats a loaded local() option argument as the definition', async () => {
        const result = await navigate({
            'overrides.do': OPTION_SETTER,
            'setter.ado': OPTION_DISPLAY_SETTER,
            'main.do': 'run overrides.do\nsetter, local(result)\ndisplay "`result\'"\n',
        });
        expect(result.definition).toEqual({
            uri: expect.stringContaining('main.do'),
            range: {
                start: { line: 1, character: 14 },
                end: { line: 1, character: 20 },
            },
        });
        expect(result.offers).toBe(true);
    });

    for (const [my_name, my_files] of Object.entries({
        'a loaded program that sets nothing, beside an ado that does': {
            'overrides.do': ARG_DISPLAY_SETTER,
            'setter.ado': ARG_SETTER,
            'main.do': 'run overrides.do\nsetter result\ndisplay "`result\'"\n',
        },
        'a .do file never loaded': {
            'lib.do': ARG_SETTER,
            'main.do': 'setter result\ndisplay "`result\'"\n',
        },
        'a load after the call': {
            'lib.do': ARG_SETTER,
            'main.do': 'setter result\ndisplay "`result\'"\nrun lib.do\n',
        },
        'a file with the same name in another directory': {
            'a/lib.do': 'display 1\n',
            'b/lib.do': ARG_SETTER,
            'main.do': 'run a/lib.do\nsetter result\ndisplay "`result\'"\n',
        },
        'a definition later at the top level of the same file': {
            'main.do': `setter result\ndisplay "\`result'"\n${ARG_SETTER}`,
        },
        'a call after program drop': {
            'main.do': `${ARG_SETTER}program drop setter\nsetter result\ndisplay "\`result'"\n`,
        },
    })) {
        it(`offers no definition for ${my_name}`, async () => {
            const result = await navigate(my_files);
            expect(result.definition).toBeNull();
            expect(result.hover).toBeNull();
            expect(result.offers).toBe(false);
        });
    }
});
