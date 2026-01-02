/**
 * Unit tests for ScopeResolver.add_out_of_scope_symbols() method.
 * Tests deduplication logic and priority handling.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { ScopeResolver } from '../../src/scope-resolver';
import { OutOfScopeSymbol } from '../../src/types';

describe('ScopeResolver.add_out_of_scope_symbols()', () => {
    let resolver: ScopeResolver;

    beforeEach(() => {
        resolver = new ScopeResolver();
    });

    // Helper to create OutOfScopeSymbol
    const createSymbol = (
        name: string,
        reason: 'after_call_site' | 'inheritance_excludes_locals',
        type: 'local' | 'global' | 'program' | 'variable' | 'scalar' | 'matrix' = 'local',
        defined_line: number = 5,
        call_site_line: number = 10
    ): OutOfScopeSymbol => ({
        name,
        type,
        source_uri: 'file:///test.do',
        defined_line,
        call_site_line,
        reason,
    });

    describe('Basic functionality', () => {
        it('should add new symbols to empty array', () => {
            const out_of_scope: OutOfScopeSymbol[] = [];
            const new_symbols = [
                createSymbol('var1', 'after_call_site'),
                createSymbol('var2', 'inheritance_excludes_locals'),
            ];

            // Access private method via type assertion
            (resolver as any).add_out_of_scope_symbols(out_of_scope, new_symbols);

            expect(out_of_scope).toHaveLength(2);
            expect(out_of_scope[0].name).toBe('var1');
            expect(out_of_scope[0].reason).toBe('after_call_site');
            expect(out_of_scope[1].name).toBe('var2');
            expect(out_of_scope[1].reason).toBe('inheritance_excludes_locals');
        });

        it('should add new symbols to existing array without conflicts', () => {
            const out_of_scope: OutOfScopeSymbol[] = [
                createSymbol('existing', 'after_call_site'),
            ];
            const new_symbols = [
                createSymbol('new1', 'after_call_site'),
                createSymbol('new2', 'inheritance_excludes_locals'),
            ];

            (resolver as any).add_out_of_scope_symbols(out_of_scope, new_symbols);

            expect(out_of_scope).toHaveLength(3);
            expect(out_of_scope.map(s => s.name)).toEqual(['existing', 'new1', 'new2']);
        });
    });

    describe('Deduplication by name', () => {
        it('should not add duplicate symbols with same reason', () => {
            const out_of_scope: OutOfScopeSymbol[] = [
                createSymbol('var1', 'after_call_site', 'local', 5, 10),
            ];
            const new_symbols = [
                createSymbol('var1', 'after_call_site', 'local', 7, 12),
            ];

            (resolver as any).add_out_of_scope_symbols(out_of_scope, new_symbols);

            expect(out_of_scope).toHaveLength(1);
            expect(out_of_scope[0].defined_line).toBe(5); // Original kept
            expect(out_of_scope[0].call_site_line).toBe(10); // Original kept
        });

        it('should not replace inheritance_excludes_locals with after_call_site', () => {
            const out_of_scope: OutOfScopeSymbol[] = [
                createSymbol('var1', 'inheritance_excludes_locals', 'local', 5, 10),
            ];
            const new_symbols = [
                createSymbol('var1', 'after_call_site', 'local', 7, 12),
            ];

            (resolver as any).add_out_of_scope_symbols(out_of_scope, new_symbols);

            expect(out_of_scope).toHaveLength(1);
            expect(out_of_scope[0].reason).toBe('inheritance_excludes_locals'); // Original kept
            expect(out_of_scope[0].defined_line).toBe(5); // Original kept
        });
    });

    describe('Priority handling: inheritance_excludes_locals > after_call_site', () => {
        it('should replace after_call_site with inheritance_excludes_locals', () => {
            const out_of_scope: OutOfScopeSymbol[] = [
                createSymbol('var1', 'after_call_site', 'local', 5, 10),
            ];
            const new_symbols = [
                createSymbol('var1', 'inheritance_excludes_locals', 'local', 7, 12),
            ];

            (resolver as any).add_out_of_scope_symbols(out_of_scope, new_symbols);

            expect(out_of_scope).toHaveLength(1);
            expect(out_of_scope[0].reason).toBe('inheritance_excludes_locals'); // Replaced
            expect(out_of_scope[0].defined_line).toBe(7); // New values
            expect(out_of_scope[0].call_site_line).toBe(12); // New values
        });

        it('should handle multiple replacements in single call', () => {
            const out_of_scope: OutOfScopeSymbol[] = [
                createSymbol('var1', 'after_call_site', 'local', 5, 10),
                createSymbol('var2', 'after_call_site', 'global', 6, 11),
                createSymbol('var3', 'inheritance_excludes_locals', 'program', 7, 12),
            ];
            const new_symbols = [
                createSymbol('var1', 'inheritance_excludes_locals', 'local', 15, 20),
                createSymbol('var2', 'inheritance_excludes_locals', 'global', 16, 21),
                createSymbol('var3', 'after_call_site', 'program', 17, 22), // Should not replace
            ];

            (resolver as any).add_out_of_scope_symbols(out_of_scope, new_symbols);

            expect(out_of_scope).toHaveLength(3);
            
            // var1: replaced
            expect(out_of_scope[0].name).toBe('var1');
            expect(out_of_scope[0].reason).toBe('inheritance_excludes_locals');
            expect(out_of_scope[0].defined_line).toBe(15);
            
            // var2: replaced
            expect(out_of_scope[1].name).toBe('var2');
            expect(out_of_scope[1].reason).toBe('inheritance_excludes_locals');
            expect(out_of_scope[1].defined_line).toBe(16);
            
            // var3: not replaced (inheritance_excludes_locals has higher priority)
            expect(out_of_scope[2].name).toBe('var3');
            expect(out_of_scope[2].reason).toBe('inheritance_excludes_locals');
            expect(out_of_scope[2].defined_line).toBe(7); // Original kept
        });
    });

    describe('Symbol type handling', () => {
        it('should handle different symbol types', () => {
            const out_of_scope: OutOfScopeSymbol[] = [];
            const new_symbols = [
                createSymbol('local_var', 'after_call_site', 'local'),
                createSymbol('global_var', 'after_call_site', 'global'),
                createSymbol('prog', 'inheritance_excludes_locals', 'program'),
                createSymbol('data_var', 'after_call_site', 'variable'),
                createSymbol('scalar_val', 'inheritance_excludes_locals', 'scalar'),
                createSymbol('matrix_val', 'after_call_site', 'matrix'),
            ];

            (resolver as any).add_out_of_scope_symbols(out_of_scope, new_symbols);

            expect(out_of_scope).toHaveLength(6);
            expect(out_of_scope.map(s => s.type)).toEqual([
                'local', 'global', 'program', 'variable', 'scalar', 'matrix'
            ]);
        });

        it('should deduplicate by name regardless of type', () => {
            const out_of_scope: OutOfScopeSymbol[] = [
                createSymbol('samename', 'after_call_site', 'local'),
            ];
            const new_symbols = [
                createSymbol('samename', 'inheritance_excludes_locals', 'global'), // Different type
            ];

            (resolver as any).add_out_of_scope_symbols(out_of_scope, new_symbols);

            expect(out_of_scope).toHaveLength(1);
            expect(out_of_scope[0].reason).toBe('inheritance_excludes_locals');
            expect(out_of_scope[0].type).toBe('global'); // Type updated with replacement
        });
    });

    describe('Edge cases', () => {
        it('should handle empty new_symbols array', () => {
            const out_of_scope: OutOfScopeSymbol[] = [
                createSymbol('existing', 'after_call_site'),
            ];
            const new_symbols: OutOfScopeSymbol[] = [];

            (resolver as any).add_out_of_scope_symbols(out_of_scope, new_symbols);

            expect(out_of_scope).toHaveLength(1);
            expect(out_of_scope[0].name).toBe('existing');
        });

        it('should handle multiple symbols with same name in new_symbols', () => {
            const out_of_scope: OutOfScopeSymbol[] = [];
            const new_symbols = [
                createSymbol('duplicate', 'after_call_site', 'local', 5, 10),
                createSymbol('duplicate', 'inheritance_excludes_locals', 'global', 7, 12),
            ];

            (resolver as any).add_out_of_scope_symbols(out_of_scope, new_symbols);

            // Should process in order: first adds, second replaces due to higher priority
            expect(out_of_scope).toHaveLength(1);
            expect(out_of_scope[0].reason).toBe('inheritance_excludes_locals');
            expect(out_of_scope[0].type).toBe('global');
            expect(out_of_scope[0].defined_line).toBe(7);
        });

        it('should preserve all symbol properties during replacement', () => {
            const out_of_scope: OutOfScopeSymbol[] = [
                createSymbol('test', 'after_call_site', 'local', 5, 10),
            ];
            const new_symbols = [
                {
                    name: 'test',
                    type: 'global' as const,
                    source_uri: 'file:///different.do',
                    defined_line: 15,
                    call_site_line: 20,
                    reason: 'inheritance_excludes_locals' as const,
                },
            ];

            (resolver as any).add_out_of_scope_symbols(out_of_scope, new_symbols);

            expect(out_of_scope).toHaveLength(1);
            expect(out_of_scope[0]).toEqual({
                name: 'test',
                type: 'global',
                source_uri: 'file:///different.do',
                defined_line: 15,
                call_site_line: 20,
                reason: 'inheritance_excludes_locals',
            });
        });
    });

    describe('Complex scenarios', () => {
        it('should handle mixed operations in single call', () => {
            const out_of_scope: OutOfScopeSymbol[] = [
                createSymbol('keep_same', 'after_call_site', 'local', 1, 2),
                createSymbol('replace_me', 'after_call_site', 'global', 3, 4),
                createSymbol('keep_priority', 'inheritance_excludes_locals', 'program', 5, 6),
            ];
            const new_symbols = [
                createSymbol('new_symbol', 'after_call_site', 'variable', 7, 8), // Add new
                createSymbol('keep_same', 'after_call_site', 'local', 9, 10), // No change (same reason)
                createSymbol('replace_me', 'inheritance_excludes_locals', 'global', 11, 12), // Replace
                createSymbol('keep_priority', 'after_call_site', 'program', 13, 14), // No change (lower priority)
            ];

            (resolver as any).add_out_of_scope_symbols(out_of_scope, new_symbols);

            expect(out_of_scope).toHaveLength(4);
            
            // Original order preserved, new symbol added at end
            expect(out_of_scope[0].name).toBe('keep_same');
            expect(out_of_scope[0].defined_line).toBe(1); // Original kept
            
            expect(out_of_scope[1].name).toBe('replace_me');
            expect(out_of_scope[1].reason).toBe('inheritance_excludes_locals'); // Replaced
            expect(out_of_scope[1].defined_line).toBe(11); // New value
            
            expect(out_of_scope[2].name).toBe('keep_priority');
            expect(out_of_scope[2].reason).toBe('inheritance_excludes_locals'); // Original kept
            expect(out_of_scope[2].defined_line).toBe(5); // Original kept
            
            expect(out_of_scope[3].name).toBe('new_symbol');
            expect(out_of_scope[3].reason).toBe('after_call_site'); // New symbol
        });
    });
});