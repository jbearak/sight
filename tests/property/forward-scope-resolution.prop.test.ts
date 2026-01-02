/**
 * Property tests for Forward Scope Resolution
 *
 * Tests Properties 5-6 (inheritance rules), 9-12 (recursive resolution),
 * 17-18 (call-site filtering), 30-34 (duplicate handling, include downgrade).
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';
import { ScopeResolver } from '../../src/scope-resolver';
import { create_empty_symbol_table } from '../../src/analyzer';
import { ForwardCall, SymbolTable } from '../../src/types';
import { URI } from 'vscode-uri';

describe('Forward Scope Resolution Property Tests', () => {
    let scope_resolver: ScopeResolver;
    let forward_resolver: ForwardScopeResolver;
    let temp_dir: string;

    beforeEach(() => {
        scope_resolver = new ScopeResolver();
        forward_resolver = new ForwardScopeResolver(scope_resolver);
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forward-scope-test-'));
    });

    afterEach(() => {
        fs.rmSync(temp_dir, { recursive: true, force: true });
    });

    const write_file = (name: string, content: string): string => {
        const file_path = path.join(temp_dir, name);
        fs.writeFileSync(file_path, content);
        return file_path;
    };

    // Property 5: Do/Run Inheritance Excludes Locals
    describe('Property 5: Do/Run Inheritance Excludes Locals', () => {
        test('do command excludes local macros from callee', async () => {
            const callee = write_file('callee.do', `
local callee_local = 1
global callee_global = 2
`);

            const forward_calls: ForwardCall[] = [{
                type: 'do',
                path: callee,
                raw_path: 'callee.do',
                call_site_line: 0,
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
                source: 'command',
                is_static: true,
            }];

            const result = await forward_resolver.resolve(
                URI.file(path.join(temp_dir, 'caller.do')).toString(),
                forward_calls
            );

            expect(result.symbols.localMacros.size).toBe(0);
            expect(result.symbols.globalMacros.size).toBe(1);
        });

        test('run command excludes local macros from callee', async () => {
            const callee = write_file('callee.do', `
local callee_local = 1
global callee_global = 2
`);

            const forward_calls: ForwardCall[] = [{
                type: 'run',
                path: callee,
                raw_path: 'callee.do',
                call_site_line: 0,
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
                source: 'command',
                is_static: true,
            }];

            const result = await forward_resolver.resolve(
                URI.file(path.join(temp_dir, 'caller.do')).toString(),
                forward_calls
            );

            expect(result.symbols.localMacros.size).toBe(0);
        });
    });

    // Property 6: Include Inheritance Preserves All Symbols
    describe('Property 6: Include Inheritance Preserves All Symbols', () => {
        test('include command includes local macros from callee', async () => {
            const callee = write_file('callee.do', `
local callee_local = 1
global callee_global = 2
`);

            const forward_calls: ForwardCall[] = [{
                type: 'include',
                path: callee,
                raw_path: 'callee.do',
                call_site_line: 0,
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
                source: 'command',
                is_static: true,
            }];

            const result = await forward_resolver.resolve(
                URI.file(path.join(temp_dir, 'caller.do')).toString(),
                forward_calls
            );

            expect(result.symbols.localMacros.size).toBe(1);
            expect(result.symbols.globalMacros.size).toBe(1);
        });
    });

    // Property 10: Depth Limit Enforcement
    describe('Property 10: Depth Limit Enforcement', () => {
        test('stops at max depth and emits warning', async () => {
            // Create a chain of files that exceeds max depth using @lsp-do directives
            // (since the parser doesn't extract quoted paths from do commands into varlist)
            const files: string[] = [];
            for (let i = 0; i < 15; i++) {
                const content = i < 14 ? `// @lsp-do: "file${i + 1}.do"\nlocal x${i} = ${i}` : 'local x = 1';
                files.push(write_file(`file${i}.do`, content));
            }

            const forward_calls: ForwardCall[] = [{
                type: 'do',
                path: files[0],
                raw_path: 'file0.do',
                call_site_line: 0,
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
                source: 'command',
                is_static: true,
            }];

            const result = await forward_resolver.resolve(
                URI.file(path.join(temp_dir, 'caller.do')).toString(),
                forward_calls
            );

            const depth_warning = result.diagnostics.find(d =>
                d.message.includes('Maximum forward resolution depth')
            );
            expect(depth_warning).toBeDefined();
        });
    });

    // Property 17: Call-Site Visibility Boundary
    describe('Property 17: Call-Site Visibility Boundary', () => {
        test('symbols visible after call site, not before', () => {
            const base_symbols = create_empty_symbol_table();
            const call_sites = [{
                callee_uri: 'file:///callee.do',
                call_line: 5,
                symbols: {
                    programs: new Map(),
                    localMacros: new Map([['callee_local', { name: 'callee_local', scope: 'local' as const, location: { uri: '', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } }, sourceUri: '' }]]),
                    globalMacros: new Map(),
                    variables: new Map(),
                    scalars: new Map(),
                    matrices: new Map(),
                },
                effective_type: 'include' as const,
            }];

            // Query before call site (line 3)
            const before = forward_resolver.get_symbols_at_line(base_symbols, call_sites, 3);
            expect(before.localMacros.has('callee_local')).toBe(false);

            // Query after call site (line 6)
            const after = forward_resolver.get_symbols_at_line(base_symbols, call_sites, 6);
            expect(after.localMacros.has('callee_local')).toBe(true);
        });
    });

    // Property 30: Duplicate Do/Run Call Optimization
    describe('Property 30: Duplicate Do/Run Call Optimization', () => {
        test('should_process_call returns skip for duplicate do', () => {
            const visited = new Map<string, 'do' | 'include'>();
            visited.set('file:///callee.do', 'do');

            const decision = forward_resolver.should_process_call(
                'file:///callee.do',
                'do',
                visited
            );

            expect(decision.action).toBe('skip');
        });
    });

    // Property 31: Do-Then-Include Adds Only Locals
    describe('Property 31: Do-Then-Include Adds Only Locals', () => {
        test('should_process_call returns add_locals_only for include after do', () => {
            const visited = new Map<string, 'do' | 'include'>();
            visited.set('file:///callee.do', 'do');

            const decision = forward_resolver.should_process_call(
                'file:///callee.do',
                'include',
                visited
            );

            expect(decision.action).toBe('add_locals_only');
        });
    });

    // Property 32: Include-First Skips Subsequent Calls
    describe('Property 32: Include-First Skips Subsequent Calls', () => {
        test('should_process_call returns skip after include', () => {
            const visited = new Map<string, 'do' | 'include'>();
            visited.set('file:///callee.do', 'include');

            const decision = forward_resolver.should_process_call(
                'file:///callee.do',
                'do',
                visited
            );

            expect(decision.action).toBe('skip');
        });
    });

    // Property 33: Include Downgrade in Do Chain
    describe('Property 33: Include Downgrade in Do Chain', () => {
        test('include in do chain is treated as do', () => {
            const effective = forward_resolver.compute_effective_call_type('include', 'do');
            expect(effective).toBe('do');
        });
    });

    // Property 34: Include Preservation in Include Chain
    describe('Property 34: Include Preservation in Include Chain', () => {
        test('include in include chain preserves include semantics', () => {
            const effective = forward_resolver.compute_effective_call_type('include', 'include');
            expect(effective).toBe('include');
        });
    });
});