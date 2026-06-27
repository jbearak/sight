/**
 * Integration tests for Callee Revalidation on Caller Change
 *
 * Tests end-to-end behavior of reverse dependency tracking and callee revalidation.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ScopeResolver } from '../../src/scope-resolver';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';
import { URI } from 'vscode-uri';
import { create_empty_symbol_table, SemanticAnalyzer } from '../../src/analyzer';
import { StataLexer } from '../../src/lexer';
import { StataParser } from '../../src/parser';
import { ForwardCall } from '../../src/types';

describe('Callee Revalidation Integration Tests', () => {
    let scope_resolver: ScopeResolver;
    let forward_resolver: ForwardScopeResolver;
    let lexer: StataLexer;
    let parser: StataParser;
    let analyzer: SemanticAnalyzer;
    let temp_dir: string;

    beforeEach(() => {
        scope_resolver = new ScopeResolver();
        forward_resolver = new ForwardScopeResolver(scope_resolver);
        scope_resolver.set_forward_scope_resolver(forward_resolver);
        lexer = new StataLexer();
        parser = new StataParser();
        analyzer = new SemanticAnalyzer();
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'callee-reval-test-'));
    });

    afterEach(() => {
        fs.rmSync(temp_dir, { recursive: true, force: true });
    });

    const write_file = (name: string, content: string): string => {
        const file_path = path.join(temp_dir, name);
        fs.writeFileSync(file_path, content);
        return file_path;
    };

    const parse_and_analyze = (content: string, uri: string) => {
        const lex_result = lexer.tokenize(content);
        const parse_result = parser.parse(lex_result.tokens);
        const analysis_result = analyzer.analyze(parse_result.ast, uri);
        return { symbols: analysis_result.symbols, ast: parse_result.ast };
    };

    const extract_forward_calls = (content: string, file_path: string): ForwardCall[] => {
        const calls: ForwardCall[] = [];
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            const match = line.match(/^(do|run|include)\s+["']?([^"'\s]+)["']?/);
            if (match) {
                const [, type, raw_path] = match;
                const resolved_path = path.resolve(path.dirname(file_path), raw_path.replace(/\.do$/, '') + '.do');
                if (fs.existsSync(resolved_path)) {
                    calls.push({
                        type: type as 'do' | 'run' | 'include',
                        raw_path,
                        call_site_line: i,
                        range: { start: { line: i, character: 0 }, end: { line: i, character: line.length } },
                        source: 'command',
                        is_static: true,
                    });
                }
            }
        }
        return calls;
    };

    describe('Caller Edit -> Callee Update', () => {
        test('adding a call to callee triggers affected_callees', () => {
            const callee_path = write_file('callee.do', `
// @lsp-done-by: "caller.do"
local result $parent_global
`);
            const caller_path = write_file('caller.do', `
global parent_global = 1
do "callee.do"
`);

            const caller_uri = URI.file(caller_path).toString();
            const callee_uri = URI.file(callee_path).toString();

            const caller_content = fs.readFileSync(caller_path, 'utf8');
            const { symbols } = parse_and_analyze(caller_content, caller_uri);
            const forward_calls = extract_forward_calls(caller_content, caller_path);

            const result = scope_resolver.update_reverse_dependencies(caller_uri, forward_calls, symbols);

            expect(result.affected_callees.has(callee_uri)).toBe(true);
        });

        test('removing a call from caller triggers affected_callees', () => {
            const callee_path = write_file('callee.do', 'local x = 1');
            const caller_path = write_file('caller.do', 'global y = 2\ndo "callee.do"');

            const caller_uri = URI.file(caller_path).toString();
            const callee_uri = URI.file(callee_path).toString();

            const caller_content_v1 = fs.readFileSync(caller_path, 'utf8');
            const { symbols: symbols_v1 } = parse_and_analyze(caller_content_v1, caller_uri);
            const forward_calls_v1 = extract_forward_calls(caller_content_v1, caller_path);
            scope_resolver.update_reverse_dependencies(caller_uri, forward_calls_v1, symbols_v1);

            fs.writeFileSync(caller_path, 'global y = 2');
            const caller_content_v2 = fs.readFileSync(caller_path, 'utf8');
            const { symbols: symbols_v2 } = parse_and_analyze(caller_content_v2, caller_uri);
            const forward_calls_v2 = extract_forward_calls(caller_content_v2, caller_path);

            const result = scope_resolver.update_reverse_dependencies(caller_uri, forward_calls_v2, symbols_v2);

            expect(result.affected_callees.has(callee_uri)).toBe(true);
        });
    });

    describe('Call Type Changes', () => {
        test('changing do to include triggers affected_callees', () => {
            const callee_path = write_file('callee.do', 'local x = 1');
            const caller_uri = URI.file(path.join(temp_dir, 'caller.do')).toString();
            const callee_uri = URI.file(callee_path).toString();

            const { symbols } = parse_and_analyze('do "callee.do"', caller_uri);
            scope_resolver.update_reverse_dependencies(caller_uri, [{
                type: 'do',
                raw_path: 'callee.do',
                call_site_line: 0,
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 14 } },
                source: 'command',
                is_static: true,
            }], symbols);

            const result = scope_resolver.update_reverse_dependencies(caller_uri, [{
                type: 'include',
                raw_path: 'callee.do',
                call_site_line: 0,
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 18 } },
                source: 'command',
                is_static: true,
            }], symbols);

            expect(result.affected_callees.has(callee_uri)).toBe(true);
        });
    });

    describe('Call Site Line Changes', () => {
        test('changing call site line triggers affected_callees', () => {
            const callee_path = write_file('callee.do', 'local x = 1');
            const caller_uri = URI.file(path.join(temp_dir, 'caller.do')).toString();
            const callee_uri = URI.file(callee_path).toString();

            const symbols = create_empty_symbol_table();

            scope_resolver.update_reverse_dependencies(caller_uri, [{
                type: 'do',
                raw_path: 'callee.do',
                call_site_line: 5,
                range: { start: { line: 5, character: 0 }, end: { line: 5, character: 14 } },
                source: 'command',
                is_static: true,
            }], symbols);

            const result = scope_resolver.update_reverse_dependencies(caller_uri, [{
                type: 'do',
                raw_path: 'callee.do',
                call_site_line: 10,
                range: { start: { line: 10, character: 0 }, end: { line: 10, character: 14 } },
                source: 'command',
                is_static: true,
            }], symbols);

            expect(result.affected_callees.has(callee_uri)).toBe(true);
        });
    });

    describe('Directive/Call-Type Mismatch Warnings', () => {
        test('emits warning when callee uses @lsp-included-by but caller uses do', async () => {
            const caller_path = write_file('caller.do', `
global parent_global = 1
do "callee.do"
`);
            const callee_path = write_file('callee.do', `
// @lsp-included-by: "${caller_path}"
local result = 1
`);

            const caller_uri = URI.file(caller_path).toString();
            const callee_uri = URI.file(callee_path).toString();

            const caller_content = fs.readFileSync(caller_path, 'utf8');
            const { symbols } = parse_and_analyze(caller_content, caller_uri);
            const forward_calls = extract_forward_calls(caller_content, caller_path);

            // Update reverse dependencies to establish the relationship
            scope_resolver.update_reverse_dependencies(caller_uri, forward_calls, symbols);

            // Resolve scope for the callee to trigger mismatch detection
            const callee_content = fs.readFileSync(callee_path, 'utf8');
            const resolved_scope = await scope_resolver.resolve(callee_uri, callee_content);

            // Check that a mismatch warning was generated
            const mismatch_warnings = resolved_scope.diagnostics.filter(d =>
                d.message.includes('Directive @lsp-included-by used but caller uses do')
            );
            expect(mismatch_warnings.length).toBe(1);
            expect(mismatch_warnings[0].severity).toBe('warning');
        });

        test('emits warning when callee uses @lsp-included-by but caller uses do (text inference fallback)', async () => {
            const caller_path = write_file('caller.do', `
global parent_global = 1
do "callee.do"
`);
            const callee_path = write_file('callee.do', `
// @lsp-included-by: "caller.do"
local result = 1
`);

            const callee_uri = URI.file(callee_path).toString();

            // Do NOT establish reverse dependencies - this forces text inference fallback
            // Resolve scope for the callee to trigger mismatch detection via text inference
            const callee_content = fs.readFileSync(callee_path, 'utf8');
            const resolved_scope = await scope_resolver.resolve(callee_uri, callee_content);

            // Check that a mismatch warning was generated via text inference
            const mismatch_warnings = resolved_scope.diagnostics.filter(d =>
                d.message.includes('Directive @lsp-included-by used but caller uses do (not include)')
            );
            expect(mismatch_warnings.length).toBe(1);
            expect(mismatch_warnings[0].severity).toBe('warning');
        });
    });

    describe('Call Site Line from Reverse Dependencies', () => {
        test('uses earliest call site line from reverse deps when no explicit call_site', async () => {
            const caller_path = write_file('caller.do', `
global parent_global = 1
// Line 2
// Line 3
do "callee.do"  // Line 4
global after_global = 2
`);
            const callee_path = write_file('callee.do', `
// @lsp-done-by: "${caller_path}"
local result = $parent_global
`);

            const caller_uri = URI.file(caller_path).toString();
            const callee_uri = URI.file(callee_path).toString();

            const caller_content = fs.readFileSync(caller_path, 'utf8');
            const { symbols } = parse_and_analyze(caller_content, caller_uri);
            const forward_calls = extract_forward_calls(caller_content, caller_path);

            // Update reverse dependencies
            scope_resolver.update_reverse_dependencies(caller_uri, forward_calls, symbols);

            const callee_content = fs.readFileSync(callee_path, 'utf8');

            // Resolve scope for the callee
            const resolved_scope = await scope_resolver.resolve(callee_uri, callee_content);

            // Check that out-of-scope symbols are correctly identified based on call site line
            const out_of_scope_symbols = resolved_scope.out_of_scope_symbols;
            const after_global_out_of_scope = out_of_scope_symbols.some(s =>
                s.name === 'after_global' && s.type === 'global'
            );
            expect(after_global_out_of_scope).toBe(true);

            // Now change the call site line and verify it updates
            const updated_forward_calls = [{
                type: 'do' as const,
                raw_path: 'callee.do',
                call_site_line: 6, // Move call to after after_global definition
                range: { start: { line: 6, character: 0 }, end: { line: 6, character: 14 } },
                source: 'command' as const,
                is_static: true,
            }];

            scope_resolver.update_reverse_dependencies(caller_uri, updated_forward_calls, symbols);
            // Mimic server behavior: caller change invalidates callee scopes
            scope_resolver.cascade_invalidate(new Set([callee_uri]));
            const updated_resolved_scope = await scope_resolver.resolve(callee_uri, callee_content);

            // Now after_global should be in scope
            const updated_out_of_scope_symbols = updated_resolved_scope.out_of_scope_symbols;
            const after_global_still_out_of_scope = updated_out_of_scope_symbols.some(s =>
                s.name === 'after_global' && s.type === 'global'
            );
            expect(after_global_still_out_of_scope).toBe(false);
        });
    });

    describe('Interface Hash Stability', () => {
        test('adding comment does not change interface hash', () => {
            const caller_uri = URI.file(path.join(temp_dir, 'caller.do')).toString();

            const { symbols: symbols_v1 } = parse_and_analyze('global foo = 1', caller_uri);
            scope_resolver.update_reverse_dependencies(caller_uri, [], symbols_v1);

            const { symbols: symbols_v2 } = parse_and_analyze('// comment\nglobal foo = 1', caller_uri);
            const result = scope_resolver.update_reverse_dependencies(caller_uri, [], symbols_v2);

            expect(result.interface_changed).toBe(false);
        });

        test('adding new global changes interface hash', () => {
            const caller_uri = URI.file(path.join(temp_dir, 'caller.do')).toString();

            const { symbols: symbols_v1 } = parse_and_analyze('global foo = 1', caller_uri);
            scope_resolver.update_reverse_dependencies(caller_uri, [], symbols_v1);

            const { symbols: symbols_v2 } = parse_and_analyze('global foo = 1\nglobal bar = 2', caller_uri);
            const result = scope_resolver.update_reverse_dependencies(caller_uri, [], symbols_v2);

            expect(result.interface_changed).toBe(true);
        });
    });
});