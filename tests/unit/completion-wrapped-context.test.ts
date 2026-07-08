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

    it('returns undefined on a blank line after a terminator', () => {
        const source = 'reg y x\n';
        const start = logical_statement_start(tokens_of(source), { line: 1, character: 0 });
        expect(start).toBeUndefined();
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
});

describe('detect_completion_context — continuation-line guard (#310)', () => {
    it('does not return command_path for a continuation line starting with a file command', () => {
        // `merge` wrapped; continuation line begins with `keepusing(` — but a
        // continuation line that started with a file-command word must not
        // shadow option context. Use `using` which is a file-ish word.
        const source = '#delimit ;\nmerge 1:1 id using "f.dta",\n    keepusing(';
        const context = context_of(source, { line: 2, character: 14 });
        expect(context.type).toBe('option');
    });

    it('still returns command_path for a genuine single-line file command', () => {
        const source = 'do myfile.do';
        const context = context_of(source, { line: 0, character: 4 });
        expect(context.type).toBe('command_path');
    });

    it('still returns subcommand for a genuine single-line prefix command', () => {
        const db = create_test_command_db();
        // `frame ` needs subcommands in the db; use the real command db shape.
        const real_db = new CommandDatabase();
        real_db.register({
            name: 'frame',
            minAbbreviation: 'frame',
            syntax: 'frame ...',
            description: 'frames',
            options: [],
            category: 'data',
            isBuiltin: true,
            subcommands: [{ name: 'create', minAbbreviation: 'cr' }],
        });
        const context = context_of('frame ', { line: 0, character: 6 }, real_db);
        expect(context.type).toBe('subcommand');
        void db;
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
