/**
 * Wrapped-statement completion context (issue #310).
 *
 * `detect_completion_context` historically saw only the current physical
 * line, so a statement wrapped across lines (via `#delimit ;` newlines or
 * `///` continuations in `#delimit cr`) lost its command and thus its option
 * context. These tests pin the logical-statement behavior in both delimiter
 * modes, the multi-statement-per-line fix, the continuation-line detector
 * guard, the #309 embedded-suppression interaction, and the single-line /
 * tokenless regressions.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { Position } from 'vscode-languageserver';
import {
    CompletionProvider,
    detect_completion_context,
} from '../../src/providers/completion';
import { CommandDatabase } from '../../src/commands';
import { StataLexer } from '../../src/lexer';
import { logical_statement_start } from '../../src/utils/statement-span';
import { create_real_document_state } from '../test-context-helper';
import { DocumentStore } from '../../src/document-store';
import { create_completion_handler } from '../../src/server-handlers';
import type { HandlerDependencies } from '../../src/server-handlers';

function tokens_of(source: string) {
    return new StataLexer().tokenize(source).tokens;
}

function context_of(source: string, position: Position, db?: CommandDatabase) {
    const doc = create_real_document_state(source);
    return detect_completion_context(doc, position, doc.tokens, db);
}

function create_test_command_db(): CommandDatabase {
    const db = new CommandDatabase();
    db.register({
        name: 'regress',
        minAbbreviation: 'reg',
        syntax: 'regress depvar [indepvars]',
        description: 'Linear regression',
        options: [
            { name: 'noconstant', minAbbreviation: 'nocons', description: 'No constant', hasArgument: false },
            { name: 'vce', minAbbreviation: 'vce', description: 'Variance estimator', hasArgument: true },
        ],
        category: 'regression',
        isBuiltin: true,
    });
    db.register({
        name: 'summarize',
        minAbbreviation: 'su',
        syntax: 'summarize [varlist]',
        description: 'Summary statistics',
        options: [
            { name: 'detail', minAbbreviation: 'd', description: 'Detailed output', hasArgument: false },
        ],
        category: 'statistics',
        isBuiltin: true,
    });
    return db;
}

describe('logical_statement_start (issue #310)', () => {
    it('finds the command start across a semicolon-mode newline wrap', () => {
        const source = '#delimit ;\nreg y x,\n    vce(';
        const start = logical_statement_start(tokens_of(source), { line: 2, character: 8 });
        expect(start).toBeDefined();
        expect(start!.line).toBe(1);
        expect(start!.character).toBe(0);
    });

    it('finds the command start across a /// continuation in cr mode', () => {
        const source = 'reg y x, ///\n    vce(';
        const start = logical_statement_start(tokens_of(source), { line: 1, character: 8 });
        expect(start).toBeDefined();
        expect(start!.line).toBe(0);
    });

    it('returns the second statement for two statements on one line', () => {
        const source = '#delimit ;\ngen a = 1 ; gen b = 2 ,';
        const start = logical_statement_start(tokens_of(source), { line: 1, character: 22 });
        expect(start).toBeDefined();
        expect(start!.line).toBe(1);
        // The second `gen`, not the first.
        expect(start!.character).toBeGreaterThan(0);
    });

    it('reports a fresh statement position on a blank line after a terminator', () => {
        // No statement token yet: the start is on the cursor's own line so the
        // caller treats it as a fresh (command) position, not a continuation.
        const source = 'reg y x\n';
        const start = logical_statement_start(tokens_of(source), { line: 1, character: 0 });
        expect(start).toBeDefined();
        expect(start!.line).toBe(1);
    });

    it('returns undefined for undefined/empty tokens', () => {
        expect(logical_statement_start(undefined, { line: 0, character: 0 })).toBeUndefined();
        expect(logical_statement_start([], { line: 0, character: 0 })).toBeUndefined();
    });
});

describe('detect_completion_context — wrapped statements (issue #310)', () => {
    it('detects option context for a semicolon-mode wrapped statement (repro)', () => {
        const source = '#delimit ;\nreg y x,\n    vce(';
        const context = context_of(source, { line: 2, character: 8 });
        expect(context.type).toBe('option');
        if (context.type === 'option') {
            expect(context.command).toBe('reg');
        }
    });

    it('detects option context for a /// wrapped statement in cr mode (repro)', () => {
        const source = 'reg y x, ///\n    vce(';
        const context = context_of(source, { line: 1, character: 8 });
        expect(context.type).toBe('option');
        if (context.type === 'option') {
            expect(context.command).toBe('reg');
        }
    });

    it('detects option context when typing an option name on a wrapped line', () => {
        const source = 'reg y x, ///\n    nocon';
        const context = context_of(source, { line: 1, character: 9 });
        expect(context.type).toBe('option');
        if (context.type === 'option') {
            expect(context.command).toBe('reg');
        }
    });

    it('detects option context with the comma at the end of the first line', () => {
        const source = '#delimit ;\nregress y x,\n    ';
        const context = context_of(source, { line: 2, character: 4 });
        expect(context.type).toBe('option');
        if (context.type === 'option') {
            expect(context.command).toBe('regress');
        }
    });
});

describe('detect_completion_context — cursor before a mid-document terminator (#310)', () => {
    it('detects option context with the cursor immediately before a following ; (semicolon mode)', () => {
        // Content continues after the statement, so the token right after the
        // cursor is a real STATEMENT_TERMINATOR, not EOF. The statement-start
        // walk must not self-match that terminator as its own boundary.
        const source = '#delimit ;\nregress y x ,\nrobust;\ndisplay 1 ;';
        const context = context_of(source, { line: 2, character: 6 });
        expect(context.type).toBe('option');
        if (context.type === 'option') {
            expect(context.command).toBe('regress');
        }
    });

    it('detects option context with the cursor before a following newline terminator (/// wrap)', () => {
        const source = 'regress y x, ///\n    nocon\ndisplay 1';
        const context = context_of(source, { line: 1, character: 9 });
        expect(context.type).toBe('option');
        if (context.type === 'option') {
            expect(context.command).toBe('regress');
        }
    });
});

describe('detect_completion_context — mata/python block boundaries (#310)', () => {
    it('does not walk into a preceding bare mata/end block under #delimit ;', () => {
        const source = '#delimit ;\nmata\nx=1\nend\nreg y x,\n robust';
        const context = context_of(source, { line: 5, character: 7 });
        expect(context.type).toBe('option');
        if (context.type === 'option') {
            expect(context.command).toBe('reg');
        }
    });

    it('does not walk into a preceding bare python/end block under #delimit ;', () => {
        const source = '#delimit ;\npython\nx=1\nend\nreg y x,\n robust';
        const context = context_of(source, { line: 5, character: 7 });
        expect(context.type).toBe('option');
        if (context.type === 'option') {
            expect(context.command).toBe('reg');
        }
    });

    it('gives command context at column 0 of a bare mata block closer (end)', () => {
        const source = 'generate foo = 1;\n#delimit ;\nmata\nx=1\nend';
        const context = context_of(source, { line: 4, character: 0 });
        expect(context.type).toBe('command');
    });

    it('gives command context at column 0 of a mata brace-block closer (})', () => {
        const source = '#delimit ;\nmata {\n x=1\n}';
        const context = context_of(source, { line: 3, character: 0 });
        expect(context.type).toBe('command');
    });

    it('resolves trailing Stata after an inline mata: on the same physical line (wrapped)', () => {
        // An inline `mata:` statement shares its line with the trailing
        // `regress y x,`; the region floor must not clamp that away.
        const source = '#delimit ;\nmata: x = 1 ; regress y x,\n    vce(';
        const context = context_of(source, { line: 2, character: 8 });
        expect(context.type).toBe('option');
        if (context.type === 'option') {
            expect(context.command).toBe('regress');
        }
    });

    it('resolves trailing Stata after an inline python: on the same physical line (wrapped)', () => {
        const source = '#delimit ;\npython: x = 1 ; regress y x,\n    vce(';
        const context = context_of(source, { line: 2, character: 8 });
        expect(context.type).toBe('option');
        if (context.type === 'option') {
            expect(context.command).toBe('regress');
        }
    });

    it('gives command context at the closer of a mata brace block containing nested braces', () => {
        // The nested inner `}` must not stop the walk inside the embedded body:
        // the walk is clamped to the cursor's Stata region, above which the
        // whole `mata { ... }` block lives.
        const source =
            '#delimit ;\nmata {\n  for (i=1;i<=10;i++) {\n    x = x + i\n  }\n  y = 5\n}';
        const context = context_of(source, { line: 6, character: 0 });
        expect(context.type).toBe('command');
    });

    it('still gives option context inside a regular Stata brace block wrapped statement', () => {
        // A non-embedded `{ }` block body is real Stata; option context for the
        // inner command must be preserved.
        const source = '#delimit ;\nforeach v of varlist a b {\n    reg y `v\',\n        vce(';
        const context = context_of(source, { line: 3, character: 12 });
        expect(context.type).toBe('option');
        if (context.type === 'option') {
            expect(context.command).toBe('reg');
        }
    });
});

describe('detect_completion_context — cursor inside a multi-char boundary token (#310)', () => {
    it('does not synthesize reversed text when the cursor is inside a #delimit directive', () => {
        // Cursor mid-`#delimit ;`: must not slice substring(boundaryEnd, cursor)
        // with boundaryEnd > cursor.
        const context = context_of('#delimit ;', { line: 0, character: 5 });
        expect(context.type).toBe('command');
    });
});

describe('detect_completion_context — long wrapped varlist (#310)', () => {
    it('still detects option context for a wrapped statement with hundreds of tokens', () => {
        const the_vars = Array.from({ length: 800 }, (_, i) => `x${i}`).join(' ');
        const source = `#delimit ;\nregress y ${the_vars},\n    `;
        const context = context_of(source, { line: 2, character: 4 });
        expect(context.type).toBe('option');
        if (context.type === 'option') {
            expect(context.command).toBe('regress');
        }
    });
});

describe('detect_completion_context — multiple statements on one line (#310)', () => {
    it('attributes option context to the second statement, not the first', () => {
        // `display 1; reg y x, |` on one physical line under #delimit ;
        const source = '#delimit ;\ndisplay 1; reg y x, ';
        const context = context_of(source, { line: 1, character: 20 });
        expect(context.type).toBe('option');
        if (context.type === 'option') {
            expect(context.command).toBe('reg');
        }
    });

    it('gives command context at the start of a new statement after a ; on the same line', () => {
        // Cursor at the first character of `reg`, right after `display 1; `.
        const source = '#delimit ;\ndisplay 1; reg y x,';
        const context = context_of(source, { line: 1, character: 11 });
        expect(context.type).toBe('command');
    });

    it('gives command context immediately after a ; with nothing typed yet', () => {
        const source = '#delimit ;\ndisplay 1; ';
        const context = context_of(source, { line: 1, character: 11 });
        expect(context.type).toBe('command');
    });

    it('gives command context while typing the second statement command word', () => {
        const source = '#delimit ;\ndisplay 1; re';
        const context = context_of(source, { line: 1, character: 13 });
        expect(context.type).toBe('command');
    });

    it('does not offer the prior command\'s options for an empty statement after its ;', () => {
        // Cursor right after `regress y x, robust; ` — a brand-new empty
        // statement, not more options for regress.
        const source = '#delimit ;\nregress y x, robust; ';
        const context = context_of(source, { line: 1, character: 22 });
        expect(context.type).toBe('command');
    });

    it('gives command context right after a { block opener on the same line', () => {
        const source = 'foreach v of varlist a b { \n}\n';
        const context = context_of(source, { line: 0, character: 27 });
        expect(context.type).toBe('command');
    });
});

describe('detect_completion_context — statement-scoped detectors over logical text (#310)', () => {
    function frame_command_db(): CommandDatabase {
        const db = new CommandDatabase();
        db.register({
            name: 'frame',
            minAbbreviation: 'frame',
            syntax: 'frame ...',
            description: 'frames',
            options: [],
            category: 'data',
            isBuiltin: true,
            subcommands: [{ name: 'create', minAbbreviation: 'cr' }],
        });
        return db;
    }

    it('does not return command_path on a wrapped option statement (comma carries through)', () => {
        // The logical text `merge 1:1 id using "f.dta" , keepusing(` contains
        // the comma, so command_path bails and option context wins.
        const source = '#delimit ;\nmerge 1:1 id using "f.dta",\n    keepusing(';
        const context = context_of(source, { line: 2, character: 14 });
        expect(context.type).toBe('option');
    });

    it('resolves command_path for a file command that is the second statement on a line', () => {
        const source = '#delimit ;\ndisplay 1 ; use "data';
        const context = context_of(source, { line: 1, character: 21 });
        expect(context.type).toBe('command_path');
        if (context.type === 'command_path') {
            expect(context.command).toBe('use');
        }
    });

    it('resolves a subcommand split across a /// continuation', () => {
        const source = '#delimit ;\nframe ///\n    cr';
        const context = context_of(source, { line: 2, character: 6 }, frame_command_db());
        expect(context.type).toBe('subcommand');
        if (context.type === 'subcommand') {
            expect(context.prefix_command).toBe('frame');
        }
    });

    it('validates a lowercase prefix chain wrapped under #delimit ;', () => {
        const source = '#delimit ;\nby group:\nquietly:\nframe ';
        const context = context_of(
            source,
            { line: 3, character: 6 },
            frame_command_db()
        );
        expect(context).toEqual({
            type: 'subcommand',
            prefix_command: 'frame',
        });
    });

    it('validates a lowercase colon prefix across a true /// wrap', () => {
        const source = 'capture: ///\n    frame ';
        const context = context_of(
            source,
            { line: 1, character: 10 },
            frame_command_db()
        );
        expect(context).toEqual({
            type: 'subcommand',
            prefix_command: 'frame',
        });
    });

    it('rejects a wrong-case by prefix wrapped under #delimit ;', () => {
        const source = '#delimit ;\nBY group:\nframe ';
        const context = context_of(
            source,
            { line: 2, character: 6 },
            frame_command_db()
        );
        expect(context.type).not.toBe('subcommand');
    });

    it('rejects a wrong-case colon prefix across a true /// wrap', () => {
        const source = 'CAPTURE: ///\n    frame ';
        const context = context_of(
            source,
            { line: 1, character: 10 },
            frame_command_db()
        );
        expect(context.type).not.toBe('subcommand');
    });

    it('still returns command_path for a genuine single-line file command', () => {
        const context = context_of('do myfile.do', { line: 0, character: 4 });
        expect(context.type).toBe('command_path');
    });

    it('still returns subcommand for a genuine single-line prefix command', () => {
        const context = context_of('frame ', { line: 0, character: 6 }, frame_command_db());
        expect(context.type).toBe('subcommand');
    });
});

describe('detect_completion_context — single-line regressions (#310)', () => {
    it('detects option context on a single physical line (unchanged)', () => {
        const source = 'reg y x, vce(';
        const context = context_of(source, { line: 0, character: 13 });
        expect(context.type).toBe('option');
        if (context.type === 'option') {
            expect(context.command).toBe('reg');
        }
    });

    it('detects command context while typing the first word (unchanged)', () => {
        const context = context_of('reg', { line: 0, character: 3 });
        expect(context.type).toBe('command');
    });

    it('detects variable context in the varlist (unchanged)', () => {
        const context = context_of('regress y ', { line: 0, character: 10 });
        expect(context.type).toBe('variable');
    });

    it('behaves identically with and without tokens on a single line', () => {
        const source = 'regress y x, nocon';
        const doc = create_real_document_state(source);
        const with_tokens = detect_completion_context(doc, { line: 0, character: 18 }, doc.tokens);
        const without_tokens = detect_completion_context(doc, { line: 0, character: 18 }, undefined);
        expect(with_tokens).toEqual(without_tokens);
    });

    it('does not detect option context for a comma inside parentheses (unchanged)', () => {
        const context = context_of('gen x = func(a, b)', { line: 0, character: 16 });
        expect(context.type).not.toBe('option');
    });
});

describe('get_completions — wrapped option completions (#310)', () => {
    let provider: CompletionProvider;
    beforeEach(() => {
        provider = new CompletionProvider(create_test_command_db(), { snippet_support: true });
    });

    it('offers option completions on a semicolon-mode wrapped line', async () => {
        const source = '#delimit ;\nregress y x,\n    ';
        const doc = create_real_document_state(source);
        const completions = await provider.get_completions(doc, { line: 2, character: 4 });
        const labels = completions.map(c => c.label);
        expect(labels).toContain('vce');
        expect(labels).toContain('noconstant');
    });

    it('filters wrapped option completions by the typed prefix', async () => {
        const source = 'regress y x, ///\n    noc';
        const doc = create_real_document_state(source);
        const completions = await provider.get_completions(doc, { line: 1, character: 7 });
        const labels = completions.map(c => c.label);
        expect(labels).toContain('noconstant');
        expect(labels).not.toContain('vce');
    });
});

describe('detect_completion_context — colon-suffixed prefix wrapped (#310)', () => {
    it('resolves the command past a wrapped capture: prefix', () => {
        const source = '#delimit ;\ncapture: regress y x,\n    vce(';
        const context = context_of(source, { line: 2, character: 8 });
        expect(context.type).toBe('option');
        if (context.type === 'option') {
            expect(context.command).toBe('regress');
        }
    });
});

describe('create_completion_handler — isIncomplete matches the real context on wrapped statements (#310)', () => {
    async function is_incomplete_for(source: string, position: Position): Promise<boolean> {
        const uri = 'file:///wrapped-isincomplete.do';
        const document_store = new DocumentStore();
        try {
            await document_store.open(uri, source, 1);
            const deps: HandlerDependencies = {
                debounce_manager: null,
                document_store,
                diagnostics_provider: null,
                completion_provider: { get_completions: async () => [] },
                hover_provider: null,
                definition_provider: null,
                references_provider: null,
                symbol_provider: null,
                formatter_provider: null,
                workspace_indexer: null,
                scope_resolver: null,
                forward_scope_resolver: null,
                dependency_graph: null,
                rename_handler: null,
                get_document_settings: async () => ({}) as any,
                connection: { sendDiagnostics: () => {}, console: { log: () => {} } },
            } as any;
            const handler = create_completion_handler(deps);
            const result = await handler(
                { textDocument: { uri }, position },
                undefined
            );
            return result.isIncomplete;
        } finally {
            await document_store.dispose();
        }
    }

    it('reports isIncomplete=true for a macro context on a /// continuation line, where the tokenless physical line alone would look like a file command', async () => {
        // `foo ///` then `  use ` + a local-macro backtick. The real completion
        // path (tokens) sees a macro context (dynamic range -> isIncomplete);
        // the current physical line alone (`  use ` + backtick) would look like
        // a `use` file command. The probe must gate tokens by context exactly
        // like the real path so the two agree.
        const source = 'foo ///\n  use `';
        expect(await is_incomplete_for(source, Position.create(1, 7))).toBe(true);
    });
});

describe('get_completions — #309 interaction: embedded continuation under #delimit ; (#310)', () => {
    it('offers no Stata command/option completions on a continued inline mata line', async () => {
        const provider = new CompletionProvider(create_test_command_db(), { snippet_support: true });
        // Inline `mata:` legally continues onto the next physical line under
        // `#delimit ;` and ends at the `;`. The continuation line is Mata, so
        // no Stata command/option completions must appear there.
        const source = '#delimit ;\nmata: x = 1,\n    2 ;';
        const doc = create_real_document_state(source);
        const completions = await provider.get_completions(doc, { line: 2, character: 5 });
        const labels = completions.map(c => c.label);
        // No Stata command completions (regress) and no option items leaked.
        expect(labels).not.toContain('regress');
        expect(labels).not.toContain('vce');
        expect(labels).not.toContain('noconstant');
    });
});
