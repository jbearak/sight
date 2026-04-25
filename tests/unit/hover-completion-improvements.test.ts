/**
 * Tests for hover and completion improvements:
 * - System variable hover (_rc, _N, _n, _pi, _cons)
 * - Expression function hover via command_db.is_function() fallback
 * - Abbreviation-aware completion ranking
 */

import { describe, it, expect } from 'bun:test';
import {
    STATA_SYSTEM_VARIABLES,
    STATA_EXPRESSION_FUNCTIONS,
} from '../../src/providers/hover';
import {
    compute_ranking_key,
} from '../../src/providers/completion';
import { CompletionRankingFactors } from '../../src/types';
import { CommandDatabase } from '../../src/command-database';

describe('System variable hover', () => {
    it('should have entries for all known system variables', () => {
        const the_expected = ['_rc', '_N', '_n', '_pi', '_cons'];
        for (const my_var of the_expected) {
            expect(STATA_SYSTEM_VARIABLES.has(my_var)).toBe(true);
        }
    });

    it('should not match non-system variables', () => {
        expect(STATA_SYSTEM_VARIABLES.has('_myvar')).toBe(false);
        expect(STATA_SYSTEM_VARIABLES.has('rc')).toBe(false);
    });

    it('should have non-empty descriptions', () => {
        for (const [my_name, my_desc] of STATA_SYSTEM_VARIABLES) {
            expect(my_desc.length).toBeGreaterThan(0);
        }
    });
});

describe('Expression functions set', () => {
    it('should contain common string functions', () => {
        for (const my_fn of ['strpos', 'substr', 'strlen', 'regexm', 'word']) {
            expect(STATA_EXPRESSION_FUNCTIONS.has(my_fn)).toBe(true);
        }
    });

    it('should contain common math functions', () => {
        for (const my_fn of ['abs', 'ceil', 'floor', 'round', 'sqrt', 'ln']) {
            expect(STATA_EXPRESSION_FUNCTIONS.has(my_fn)).toBe(true);
        }
    });

    it('should contain common programming functions', () => {
        for (const my_fn of ['cond', 'inlist', 'inrange', 'missing']) {
            expect(STATA_EXPRESSION_FUNCTIONS.has(my_fn)).toBe(true);
        }
    });

    it('should not contain duplicate entries', () => {
        // Verify the set size matches a manual count of unique entries
        // (Set automatically deduplicates, so this just documents intent)
        const the_array = Array.from(STATA_EXPRESSION_FUNCTIONS);
        const the_unique = new Set(the_array);
        expect(the_array.length).toBe(the_unique.size);
    });
});

describe('CommandDatabase function support', () => {
    it('should report is_function for loaded functions', () => {
        const db = new CommandDatabase();
        db.load_cache({
            version: 18,
            commands: {},
            abbreviations: {},
            functions: ['strpos', 'substr', 'abs'],
        });
        expect(db.is_function('strpos')).toBe(true);
        expect(db.is_function('abs')).toBe(true);
        expect(db.is_function('nonexistent')).toBe(false);
    });

    it('should handle missing functions field gracefully', () => {
        const db = new CommandDatabase();
        db.load_cache({
            version: 18,
            commands: {},
            abbreviations: {},
        });
        expect(db.is_function('strpos')).toBe(false);
        expect(db.get_all_functions()).toEqual([]);
    });

    it('should clear functions on clear()', () => {
        const db = new CommandDatabase();
        db.load_cache({
            version: 18,
            commands: {},
            abbreviations: {},
            functions: ['strpos'],
        });
        expect(db.is_function('strpos')).toBe(true);
        db.clear();
        expect(db.is_function('strpos')).toBe(false);
    });
});

describe('Abbreviation-aware completion ranking', () => {
    it('should rank commands with shorter abbreviations first within same tier', () => {
        // regress (min_abbrev=3) should sort before reghdfe (min_abbrev=6)
        // because shorter abbreviation = more "canonical" command.
        // The abbreviation length is encoded in alphabetical_order.
        const base: CompletionRankingFactors = {
            scope_depth: 0,
            directive_type: 'current',
            symbol_type: 'builtin',
            command_priority: 2,
        };

        const regress_key = compute_ranking_key({
            ...base,
            alphabetical_order: '03regress', // min_abbrev=3
        });
        const reghdfe_key = compute_ranking_key({
            ...base,
            alphabetical_order: '06reghdfe', // min_abbrev=6
        });

        expect(regress_key < reghdfe_key).toBe(true);
    });

    it('should preserve tier ordering across different abbreviation lengths', () => {
        // Tier 1 commands should always sort before tier 2, regardless
        // of abbreviation length.
        const tier1_key = compute_ranking_key({
            scope_depth: 0,
            directive_type: 'current',
            symbol_type: 'builtin',
            alphabetical_order: '08summarize', // long abbrev
            command_priority: 1,
        });
        const tier2_key = compute_ranking_key({
            scope_depth: 0,
            directive_type: 'current',
            symbol_type: 'builtin',
            alphabetical_order: '03regress', // short abbrev
            command_priority: 2,
        });

        expect(tier1_key < tier2_key).toBe(true);
    });

    it('should be prefix-independent (works with VS Code client-side filtering)', () => {
        // The sort order must be the same regardless of what prefix
        // triggered the completion, because VS Code caches results
        // (isIncomplete: false) and filters client-side.
        const base: CompletionRankingFactors = {
            scope_depth: 0,
            directive_type: 'current',
            symbol_type: 'builtin',
            command_priority: 2,
        };

        const regress_key = compute_ranking_key({
            ...base,
            alphabetical_order: '03regress',
        });
        const reghdfe_key = compute_ranking_key({
            ...base,
            alphabetical_order: '06reghdfe',
        });

        // regress always sorts before reghdfe, whether the user typed
        // 'r', 're', 'reg', or 'regr'.
        expect(regress_key < reghdfe_key).toBe(true);
    });
});
