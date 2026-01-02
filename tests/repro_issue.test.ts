/**
 * Reproduction test for completion issues reported in feedback.
 * 
 * Scenarios:
 * 1. `display `|'` -> completions list should appear (local macro)
 * 2. `display $` -> completions list should appear (global unbraced)
 * 3. `display $a` -> completions list should appear (global unbraced)
 * 4. `display ${a}` -> completions list should appear (global braced)
 * 5. `display ${a` -> completions list should appear (global braced)
 * 6. `display ${foo} $ba|` -> should not append `}` (mixed line bug)
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { Position } from 'vscode-languageserver';
import { CompletionProvider, detect_completion_context } from '../src/providers/completion';
import { CommandDatabase } from '../src/command-database';
import { DocumentState } from '../src/document-store';
import { SymbolTable, MacroSymbol } from '../src/types';

function create_test_document(
    content_with_cursor: string,
    symbols?: Partial<SymbolTable>
): { document: DocumentState, position: Position } {
    const marker_index = content_with_cursor.indexOf('|');
    const content = content_with_cursor.replace('|', '');

    // Calculate position
    const before_marker = content_with_cursor.substring(0, marker_index);
    const line = before_marker.split('\n').length - 1;
    const last_newline = before_marker.lastIndexOf('\n');
    const character = last_newline === -1
        ? before_marker.length
        : before_marker.length - last_newline - 1;

    // NOTE: In the real server, workspace symbols are filtered to exclude the
    // current URI, then document.symbols are overlaid to ensure freshness.
    // These tests should therefore put their macro symbols into document.symbols.
    const document_symbols: SymbolTable = {
        programs: symbols?.programs || new Map(),
        localMacros: symbols?.localMacros || new Map(),
        globalMacros: symbols?.globalMacros || new Map(),
        variables: symbols?.variables || new Map(),
        scalars: symbols?.scalars || new Map(),
        matrices: symbols?.matrices || new Map(),
    };

    return {
        document: {
            uri: 'file:///test.do',
            version: 1,
            content,
            ast: null,
            symbols: document_symbols,
            diagnostics: [],
            context_tracker: {
                get_context_at_position: () => 'stata',
                get_context_range_at_position: () => null,
                get_all_context_ranges: () => [],
                validate_context_structure: () => [],
            } as any
        },
        position: { line, character }
    };
}

describe('Reproduction Tests: Completion Failures', () => {
    let provider: CompletionProvider;
    let command_db: CommandDatabase;
    let symbols: SymbolTable;

    beforeEach(() => {
        command_db = new CommandDatabase();
        provider = new CompletionProvider(command_db, { snippet_support: true });
        
        // Populate with test macros
        symbols = {
            programs: new Map(),
            localMacros: new Map([
                ['apple', { name: 'apple', scope: 'local', location: { uri: 'file:///test.do', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } }, sourceUri: 'file:///test.do' }]
            ]),
            globalMacros: new Map([
                ['apple', { name: 'apple', scope: 'global', location: { uri: 'file:///test.do', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } }, sourceUri: 'file:///test.do' }],
                ['banana', { name: 'banana', scope: 'global', location: { uri: 'file:///test.do', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } }, sourceUri: 'file:///test.do' }]
            ]),
            variables: new Map(),
            scalars: new Map(),
            matrices: new Map(),
        };
    });

    // 1. `display `|'`
    test('Scenario 1: display `|\' should return local completions', async () => {
        const { document, position } = create_test_document("display `|'", symbols);
        
        // Detect context
        const context = detect_completion_context(document, position);
        expect(context.type).toBe('macro');
        if (context.type === 'macro') {
            expect(context.scope).toBe('local');
        }

        // Get completions
        const completions = await provider.get_completions(document, position);
        
        // Verify 'apple' is present
        const apple = completions.find(c => c.label === 'apple');
        expect(apple).toBeDefined();
        
        // Verify no closing apostrophe added (already present)
        expect(apple?.textEdit?.newText).toBe('apple');
    });

    // 2. `display $`
    test('Scenario 2: display $| should return global completions', async () => {
        const { document, position } = create_test_document("display $|", symbols);
        
        const context = detect_completion_context(document, position);
        expect(context.type).toBe('macro');
        if (context.type === 'macro') {
            expect(context.scope).toBe('global');
        }

        const completions = await provider.get_completions(document, position);
        
        const apple = completions.find(c => c.label === 'apple');
        expect(apple).toBeDefined();
        expect(apple?.textEdit?.newText).toBe('apple'); // No suffix for unbraced
    });

    // 3. `display $a`
    test('Scenario 3: display $a| should return global completions', async () => {
        const { document, position } = create_test_document("display $a|", symbols);
        
        const context = detect_completion_context(document, position);
        expect(context.type).toBe('macro');
        if (context.type === 'macro') {
            expect(context.scope).toBe('global');
        }

        const completions = await provider.get_completions(document, position);
        
        const apple = completions.find(c => c.label === 'apple');
        expect(apple).toBeDefined();
    });

    // 4. `display ${a}`
    test('Scenario 4: display ${a|} should return global completions', async () => {
        const { document, position } = create_test_document("display ${a|}", symbols);
        
        const context = detect_completion_context(document, position);
        expect(context.type).toBe('macro');
        if (context.type === 'macro') {
            expect(context.scope).toBe('global');
        }

        const completions = await provider.get_completions(document, position);
        
        const apple = completions.find(c => c.label === 'apple');
        expect(apple).toBeDefined();
        expect(apple?.textEdit?.newText).toBe('apple'); // } already exists
    });

    // 5. `display ${a`
    test('Scenario 5: display ${a| should return global completions', async () => {
        const { document, position } = create_test_document("display ${a|", symbols);
        
        const context = detect_completion_context(document, position);
        expect(context.type).toBe('macro');
        if (context.type === 'macro') {
            expect(context.scope).toBe('global');
        }

        const completions = await provider.get_completions(document, position);
        
        const apple = completions.find(c => c.label === 'apple');
        expect(apple).toBeDefined();
        expect(apple?.textEdit?.newText).toBe('apple}'); // Append }
    });

    // 6. Mixed line bug
    test('Scenario 6: display ${foo} $ba| should not append }', async () => {
        const { document, position } = create_test_document("display ${foo} $ba|", symbols);
        
        const context = detect_completion_context(document, position);
        expect(context.type).toBe('macro');
        if (context.type === 'macro') {
            expect(context.scope).toBe('global');
        }

        const completions = await provider.get_completions(document, position);
        
        const banana = completions.find(c => c.label === 'banana');
        expect(banana).toBeDefined();
        
        // Should NOT append } because $ba is unbraced, even though ${foo} is earlier
        expect(banana?.textEdit?.newText).toBe('banana');
        expect(banana?.textEdit?.newText).not.toContain('}');
    });

    // 7. Invalid character handling (clamping)
    test('Scenario 7: `app.le| should not complete', async () => {
        // If we are at `app.le|, the context detector should currently return local
        // but we want to confirm if it should or shouldn't
        // Per spec: treat '.' as end of macro.
        // So `app` is macro. `.le` is not.
        // If cursor is at |, we are outside the macro `app`.
        const { document, position } = create_test_document("display `app.le|");
        
        // This should arguably NOT be a macro context because we are after the invalid char
        const context = detect_completion_context(document, position);
        
        // If we implement the fix, this should be null or similar
        // For now, let's just log what it is
        if (process.env.SIGHT_TEST_LOG) {
            console.log('Scenario 7 context:', context);
        }
    });
});
