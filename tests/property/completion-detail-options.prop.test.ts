/**
 * Tests for completion detail showing options instead of syntax.
 * 
 * Validates: Requirements 2.2, 2.3, 2.4
 * - Commands with options show "Options: ..." in detail
 * - No SMCL tags appear in completion details
 * - Commands without options have undefined detail
 */

import { describe, it, expect } from 'bun:test';
import { CompletionProvider } from '../../src/providers/completion';
import { CommandDatabase } from '../../src/command-database';
import { DocumentState } from '../../src/document-store';
import { SymbolTable } from '../../src/types';

/**
 * Helper to create a minimal document state for testing.
 */
function create_test_document(content: string): DocumentState {
    return {
        uri: 'file:///test.do',
        version: 1,
        content,
        ast: null,
        symbols: {
            programs: new Map(),
            localMacros: new Map(),
            globalMacros: new Map(),
            variables: new Map(),
            scalars: new Map(),
            matrices: new Map(),
        } as SymbolTable,
        diagnostics: [],
    };
}

/**
 * Create a test command database with commands for testing.
 */
function create_test_command_db(): CommandDatabase {
    const db = new CommandDatabase();
    
    // Command with options (like regress)
    db.register({
        name: 'regress',
        minAbbreviation: 'reg',
        syntax: 'regress depvar [indepvars] [if] [in] [weight] [, options]',
        options: [
            { name: 'noconstant', minAbbreviation: 'nocons', hasArgument: false },
            { name: 'hascons', minAbbreviation: 'hc', hasArgument: false },
            { name: 'tsscons', minAbbreviation: 'tss', hasArgument: false },
            { name: 'vce', minAbbreviation: 'vce', hasArgument: true },
            { name: 'level', minAbbreviation: 'l', hasArgument: true },
            { name: 'beta', minAbbreviation: 'b', hasArgument: false },
        ],
        category: 'estimation',
        isBuiltin: true,
    });
    
    // Command without options
    db.register({
        name: 'display',
        minAbbreviation: 'di',
        syntax: 'display [display_directive [display_directive [...]]]',
        options: [],
        category: 'programming',
        isBuiltin: true,
        priority: 1,
    });

    // Lower-priority colliding command used to verify abbreviation resolution
    db.register({
        name: 'dir',
        minAbbreviation: 'd',
        syntax: 'dir [, wide]',
        options: [
            { name: 'wide', minAbbreviation: 'wide', hasArgument: false },
        ],
        category: 'programming',
        isBuiltin: true,
        priority: 3,
    });
    
    return db;
}

/**
 * SMCL tags that should NOT appear in completion details.
 */
const SMCL_TAGS = ['{cmd:', '{varname}', '{ifin}', '{it:', '{opt:', '{bf:', '{ul:', '{help '];

describe('Completion Detail Options Tests', () => {
    const my_command_db = create_test_command_db();
    const my_provider = new CompletionProvider(my_command_db, { snippet_support: false });

    it('regress completion detail starts with "Options:" and contains known option names', async () => {
        const my_regress_info = my_command_db.lookup('regress');
        expect(my_regress_info).toBeDefined();
        expect(my_regress_info!.options.length).toBeGreaterThan(0);

        const my_document = create_test_document('reg');
        const my_position = { line: 0, character: 3 };
        const my_completions = await my_provider.get_completions(my_document, my_position);

        const my_regress_completion = my_completions.find(c => c.label === 'regress');
        expect(my_regress_completion).toBeDefined();
        expect(my_regress_completion!.detail).toBeDefined();
        expect(my_regress_completion!.detail!.startsWith('Options:')).toBe(true);

        // Check that at least one known option name appears in detail
        const known_options = my_regress_info!.options.slice(0, 5).map(o => o.name);
        const detail_contains_option = known_options.some(opt => my_regress_completion!.detail!.includes(opt));
        expect(detail_contains_option).toBe(true);
    });

    it('command with zero options has undefined detail or no "Options:" prefix', async () => {
        const my_display_info = my_command_db.lookup('display');
        expect(my_display_info).toBeDefined();
        expect(my_display_info!.options.length).toBe(0);

        const my_document = create_test_document('dis');
        const my_position = { line: 0, character: 3 };
        const my_completions = await my_provider.get_completions(my_document, my_position);

        const my_display_completion = my_completions.find(c => c.label === 'display');
        expect(my_display_completion).toBeDefined();
        
        // Either undefined detail or detail that doesn't start with "Options:"
        if (my_display_completion!.detail) {
            expect(my_display_completion!.detail.startsWith('Options:')).toBe(false);
        }
    });

    it('abbreviated command names should resolve option completions via the precedence-aware lookup', async () => {
        const my_local_db = new CommandDatabase();
        my_local_db.register({
            name: 'display',
            minAbbreviation: 'di',
            syntax: 'display ...',
            options: [
                { name: 'newline', minAbbreviation: 'newline', hasArgument: true },
            ],
            category: 'programming',
            isBuiltin: true,
            priority: 1,
        });
        my_local_db.register({
            name: 'dir',
            minAbbreviation: 'd',
            syntax: 'dir [, wide]',
            options: [
                { name: 'wide', minAbbreviation: 'wide', hasArgument: false },
            ],
            category: 'programming',
            isBuiltin: true,
            priority: 3,
        });
        const my_local_provider = new CompletionProvider(my_local_db, { snippet_support: false });

        const my_document = create_test_document('di, n');
        const my_position = { line: 0, character: 5 };
        const my_completions = await my_local_provider.get_completions(my_document, my_position);

        expect(my_completions.some(c => c.label === 'newline')).toBe(true);
        expect(my_completions.some(c => c.label === 'wide')).toBe(false);
    });

    it('no completion detail contains SMCL tags', async () => {
        const my_document = create_test_document('reg');
        const my_position = { line: 0, character: 3 };
        const my_completions = await my_provider.get_completions(my_document, my_position);

        for (const my_completion of my_completions) {
            if (my_completion.detail) {
                for (const my_tag of SMCL_TAGS) {
                    expect(my_completion.detail.includes(my_tag)).toBe(false);
                }
            }
        }
    });

    it('commands with >5 options show truncation indicator', async () => {
        const my_regress_info = my_command_db.lookup('regress');
        expect(my_regress_info).toBeDefined();
        expect(my_regress_info!.options.length).toBeGreaterThan(5);

        const my_document = create_test_document('reg');
        const my_position = { line: 0, character: 3 };
        const my_completions = await my_provider.get_completions(my_document, my_position);

        const my_regress_completion = my_completions.find(c => c.label === 'regress');
        expect(my_regress_completion).toBeDefined();
        expect(my_regress_completion!.detail).toBeDefined();
        expect(my_regress_completion!.detail!.includes('... (+')).toBe(true);
    });
});
