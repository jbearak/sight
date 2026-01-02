/**
 * Property tests for Reverse Dependency Tracking
 *
 * Feature: callee-revalidation-on-caller-change
 * Tests Properties 2, 3, 4b, 4c, 7, 8 from the design document.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ScopeResolver } from '../../src/scope-resolver';
import { URI } from 'vscode-uri';
import { create_empty_symbol_table } from '../../src/analyzer';
import { ForwardCall, SymbolTable, MacroSymbol } from '../../src/types';

describe('Reverse Dependency Tracking Property Tests', () => {
    let resolver: ScopeResolver;
    let temp_dir: string;

    beforeEach(() => {
        resolver = new ScopeResolver();
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reverse-dep-test-'));
    });

    afterEach(() => {
        fs.rmSync(temp_dir, { recursive: true, force: true });
    });

    const write_file = (name: string, content: string): string => {
        const file_path = path.join(temp_dir, name);
        fs.writeFileSync(file_path, content);
        return file_path;
    };

    const make_forward_call = (callee_path: string, type: 'do' | 'run' | 'include', line: number): ForwardCall => ({
        type,
        path: callee_path,
        raw_path: path.basename(callee_path),
        call_site_line: line,
        range: { start: { line, character: 0 }, end: { line, character: 10 } },
        source: 'command',
        is_static: true,
    });

    const make_symbols_with_global = (name: string): SymbolTable => {
        const symbols = create_empty_symbol_table();
        symbols.globalMacros.set(name, {
            name,
            scope: 'global',
            location: { uri: 'test', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } } },
            sourceUri: 'test',
        });
        return symbols;
    };

    // Property 2: Index Maintenance and Diff-Based Invalidation
    describe('Property 2: Index Maintenance', () => {
        test('adding forward calls updates index correctly', () => {
            const callee_path = write_file('callee.do', 'local x = 1');
            const caller_uri = URI.file(path.join(temp_dir, 'caller.do')).toString();
            const callee_uri = URI.file(callee_path).toString();

            const forward_calls = [make_forward_call(callee_path, 'do', 5)];
            const symbols = make_symbols_with_global('test_global');

            const result = resolver.update_reverse_dependencies(caller_uri, forward_calls, symbols);

            expect(result.affected_callees.has(callee_uri)).toBe(true);
        });

        test('removing forward calls updates index correctly', () => {
            const callee_path = write_file('callee.do', 'local x = 1');
            const caller_uri = URI.file(path.join(temp_dir, 'caller.do')).toString();
            const callee_uri = URI.file(callee_path).toString();

            // First add
            const forward_calls = [make_forward_call(callee_path, 'do', 5)];
            const symbols = make_symbols_with_global('test_global');
            resolver.update_reverse_dependencies(caller_uri, forward_calls, symbols);

            // Then remove
            const result = resolver.update_reverse_dependencies(caller_uri, [], symbols);

            expect(result.affected_callees.has(callee_uri)).toBe(true);
        });

        test('modifying call type triggers invalidation', () => {
            const callee_path = write_file('callee.do', 'local x = 1');
            const caller_uri = URI.file(path.join(temp_dir, 'caller.do')).toString();
            const callee_uri = URI.file(callee_path).toString();

            // First add as 'do'
            const symbols = make_symbols_with_global('test_global');
            resolver.update_reverse_dependencies(caller_uri, [make_forward_call(callee_path, 'do', 5)], symbols);

            // Change to 'include'
            const result = resolver.update_reverse_dependencies(caller_uri, [make_forward_call(callee_path, 'include', 5)], symbols);

            expect(result.affected_callees.has(callee_uri)).toBe(true);
        });
    });

    // Property 3: Cleanup on Close and Delete
    describe('Property 3: Cleanup on Close and Delete', () => {
        test('remove_caller_from_reverse_deps cleans up all entries', () => {
            const callee_path = write_file('callee.do', 'local x = 1');
            const caller_uri = URI.file(path.join(temp_dir, 'caller.do')).toString();

            // Add dependency
            const forward_calls = [make_forward_call(callee_path, 'do', 5)];
            const symbols = make_symbols_with_global('test_global');
            resolver.update_reverse_dependencies(caller_uri, forward_calls, symbols);

            // Remove caller
            resolver.remove_caller_from_reverse_deps(caller_uri);

            // Verify no affected callees on next update (index should be clean)
            const result = resolver.update_reverse_dependencies(caller_uri, forward_calls, symbols);
            expect(result.affected_callees.size).toBeGreaterThan(0); // Should be added fresh
        });

        test('remove_uri_from_reverse_deps removes as both caller and callee', () => {
            const file_a_path = write_file('a.do', 'local x = 1');
            const file_b_path = write_file('b.do', 'local y = 2');
            const uri_a = URI.file(file_a_path).toString();
            const uri_b = URI.file(file_b_path).toString();

            // A calls B
            const symbols = make_symbols_with_global('test_global');
            resolver.update_reverse_dependencies(uri_a, [make_forward_call(file_b_path, 'do', 5)], symbols);

            // Remove B entirely
            resolver.remove_uri_from_reverse_deps(uri_b);

            // A should have no callees now
            const result = resolver.update_reverse_dependencies(uri_a, [], symbols);
            expect(result.affected_callees.size).toBe(0);
        });
    });

    // Property 4b: Interface Hashing Stability
    describe('Property 4b: Interface Hashing Stability', () => {
        test('same symbols produce same hash regardless of insertion order', () => {
            const symbols1 = create_empty_symbol_table();
            symbols1.globalMacros.set('alpha', { name: 'alpha', scope: 'global', location: { uri: 'test', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } } }, sourceUri: 'test' });
            symbols1.globalMacros.set('beta', { name: 'beta', scope: 'global', location: { uri: 'test', range: { start: { line: 1, character: 0 }, end: { line: 1, character: 4 } } }, sourceUri: 'test' });

            const symbols2 = create_empty_symbol_table();
            symbols2.globalMacros.set('beta', { name: 'beta', scope: 'global', location: { uri: 'test', range: { start: { line: 1, character: 0 }, end: { line: 1, character: 4 } } }, sourceUri: 'test' });
            symbols2.globalMacros.set('alpha', { name: 'alpha', scope: 'global', location: { uri: 'test', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } } }, sourceUri: 'test' });

            const hash1 = resolver.compute_interface_hash(symbols1);
            const hash2 = resolver.compute_interface_hash(symbols2);

            expect(hash1).toBe(hash2);
        });

        test('different symbols produce different hashes', () => {
            const symbols1 = make_symbols_with_global('foo');
            const symbols2 = make_symbols_with_global('bar');

            const hash1 = resolver.compute_interface_hash(symbols1);
            const hash2 = resolver.compute_interface_hash(symbols2);

            expect(hash1).not.toBe(hash2);
        });

        test('interface_changed is false when symbols unchanged', () => {
            const caller_uri = URI.file(path.join(temp_dir, 'caller.do')).toString();
            const symbols = make_symbols_with_global('test_global');

            // First update
            resolver.update_reverse_dependencies(caller_uri, [], symbols);

            // Same symbols again
            const result = resolver.update_reverse_dependencies(caller_uri, [], symbols);

            expect(result.interface_changed).toBe(false);
        });

        test('interface_changed is true when symbols change', () => {
            const caller_uri = URI.file(path.join(temp_dir, 'caller.do')).toString();
            const symbols1 = make_symbols_with_global('foo');
            const symbols2 = make_symbols_with_global('bar');

            // First update
            resolver.update_reverse_dependencies(caller_uri, [], symbols1);

            // Different symbols
            const result = resolver.update_reverse_dependencies(caller_uri, [], symbols2);

            expect(result.interface_changed).toBe(true);
        });
    });

    // Property 8: Multi-Edge Storage
    describe('Property 8: Multi-Edge Storage', () => {
        test('multiple calls to same callee are tracked', () => {
            const callee_path = write_file('callee.do', 'local x = 1');
            const caller_uri = URI.file(path.join(temp_dir, 'caller.do')).toString();
            const callee_uri = URI.file(callee_path).toString();

            const forward_calls = [
                make_forward_call(callee_path, 'do', 5),
                make_forward_call(callee_path, 'do', 10),
            ];
            const symbols = make_symbols_with_global('test_global');

            const result = resolver.update_reverse_dependencies(caller_uri, forward_calls, symbols);

            expect(result.affected_callees.has(callee_uri)).toBe(true);
        });

        test('multiple callers to same callee are tracked independently', () => {
            const callee_path = write_file('callee.do', 'local x = 1');
            const caller1_uri = URI.file(path.join(temp_dir, 'caller1.do')).toString();
            const caller2_uri = URI.file(path.join(temp_dir, 'caller2.do')).toString();
            const callee_uri = URI.file(callee_path).toString();

            const symbols = make_symbols_with_global('test_global');

            // Caller 1 adds callee
            resolver.update_reverse_dependencies(caller1_uri, [make_forward_call(callee_path, 'do', 5)], symbols);

            // Caller 2 adds same callee
            resolver.update_reverse_dependencies(caller2_uri, [make_forward_call(callee_path, 'do', 10)], symbols);

            // Remove caller 1
            resolver.remove_caller_from_reverse_deps(caller1_uri);

            // Caller 2's relationship should still exist
            const result = resolver.update_reverse_dependencies(caller2_uri, [], symbols);
            expect(result.affected_callees.has(callee_uri)).toBe(true);
        });
    });
});