/**
 * Property tests for Optional .do Extension Handling
 *
 * Tests path resolution fallback, explicit extension preservation,
 * exact path precedence, and scope resolution across LSP features.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { URI } from 'vscode-uri';
import { DirectiveParser } from '../../src/directive-parser';
import { ScopeResolver } from '../../src/scope-resolver';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';
import { ForwardCall } from '../../src/types';
import { arbitrary_identifier } from './generators/primitives';

describe('Optional .do Extension Property Tests', () => {
    let temp_dir: string;
    let directive_parser: DirectiveParser;
    let scope_resolver: ScopeResolver;
    let forward_resolver: ForwardScopeResolver;

    beforeEach(() => {
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'do-extension-test-'));
        directive_parser = new DirectiveParser();
        scope_resolver = new ScopeResolver();
        forward_resolver = new ForwardScopeResolver(scope_resolver);
    });

    afterEach(() => {
        fs.rmSync(temp_dir, { recursive: true, force: true });
    });

    const write_file = (name: string, content: string): string => {
        const file_path = path.join(temp_dir, name);
        fs.writeFileSync(file_path, content);
        return file_path;
    };

    const create_file_with_symbols = (name: string): string => {
        const content = `
local test_local = 1
global test_global = 2
program define test_program
    display "test"
end
scalar test_scalar = 3
matrix test_matrix = (1,2)
`;
        return write_file(name, content);
    };

    // Property 1: Path Resolution Fallback
    describe('Property 1: Path Resolution Fallback', () => {
        test('directive parser resolves path.do when path does not exist', () => {
            fc.assert(fc.property(
                arbitrary_identifier(),
                (base_name) => {
                    const do_file = create_file_with_symbols(`${base_name}.do`);
                    const result = directive_parser.resolve_path_with_fallback(base_name, temp_dir);
                    expect(result).toBe(do_file);
                }
            ), { numRuns: 100 });
        });
    });

    // Property 2: Explicit Extension Preserved
    describe('Property 2: Explicit Extension Preserved', () => {
        test('paths ending in .do are returned unchanged', () => {
            fc.assert(fc.property(
                arbitrary_identifier(),
                (base_name) => {
                    const do_name = `${base_name}.do`;
                    const do_file = create_file_with_symbols(do_name);
                    const result = directive_parser.resolve_path_with_fallback(do_name, temp_dir);
                    expect(result).toBe(do_file);
                }
            ), { numRuns: 100 });
        });
    });

    // Property 3: Exact Path Precedence
    describe('Property 3: Exact Path Precedence', () => {
        test('exact path takes precedence over .do fallback', () => {
            fc.assert(fc.property(
                arbitrary_identifier(),
                (base_name) => {
                    const exact_file = write_file(base_name, 'exact content');
                    write_file(`${base_name}.do`, 'do content');
                    const result = directive_parser.resolve_path_with_fallback(base_name, temp_dir);
                    expect(result).toBe(exact_file);
                }
            ), { numRuns: 100 });
        });
    });

    // Property 4: No False Positive Diagnostics (Forward Scope)
    describe('Property 4: No False Positive Diagnostics', () => {
        test('no diagnostic for forward calls when .do fallback exists', async () => {
            await fc.assert(fc.asyncProperty(
                arbitrary_identifier(),
                async (base_name) => {
                    create_file_with_symbols(`${base_name}.do`);
                    const caller_uri = URI.file(path.join(temp_dir, 'caller.do')).toString();

                    const forward_calls: ForwardCall[] = [{
                        type: 'do',
                        path: path.join(temp_dir, base_name),
                        raw_path: base_name,
                        call_site_line: 0,
                        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
                        source: 'directive',
                        is_static: true,
                    }];

                    const result = await forward_resolver.resolve(caller_uri, forward_calls);
                    const file_errors = result.diagnostics.filter(d => 
                        d.message.includes('Cannot read file')
                    );
                    expect(file_errors).toHaveLength(0);
                }
            ), { numRuns: 100 });
        });
    });

    // Property 5: Missing File Diagnostic
    describe('Property 5: Missing File Diagnostic', () => {
        test('diagnostic includes paths tried when file missing', async () => {
            await fc.assert(fc.asyncProperty(
                arbitrary_identifier(),
                async (base_name) => {
                    const caller_uri = URI.file(path.join(temp_dir, 'caller.do')).toString();

                    const forward_calls: ForwardCall[] = [{
                        type: 'do',
                        path: path.join(temp_dir, base_name),
                        raw_path: base_name,
                        call_site_line: 0,
                        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
                        source: 'directive',
                        is_static: true,
                    }];

                    const result = await forward_resolver.resolve(caller_uri, forward_calls);
                    const file_errors = result.diagnostics.filter(d => 
                        d.message.includes('Cannot read file')
                    );
                    expect(file_errors.length).toBeGreaterThan(0);
                }
            ), { numRuns: 100 });
        });
    });

    // Property 6: Forward Scope Resolution
    describe('Property 6: Forward Scope Resolution', () => {
        test('forward calls resolve symbols from .do fallback files', async () => {
            await fc.assert(fc.asyncProperty(
                arbitrary_identifier(),
                async (base_name) => {
                    create_file_with_symbols(`${base_name}.do`);
                    const caller_uri = URI.file(path.join(temp_dir, 'caller.do')).toString();

                    const forward_calls: ForwardCall[] = [{
                        type: 'do',
                        path: path.join(temp_dir, base_name),
                        raw_path: base_name,
                        call_site_line: 0,
                        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
                        source: 'command',
                        is_static: true,
                    }];

                    const result = await forward_resolver.resolve(caller_uri, forward_calls);
                    expect(result.symbols.globalMacros.has('test_global')).toBe(true);
                    expect(result.symbols.programs.has('test_program')).toBe(true);
                }
            ), { numRuns: 100 });
        });

        test('include calls resolve all symbols from .do fallback files', async () => {
            await fc.assert(fc.asyncProperty(
                arbitrary_identifier(),
                async (base_name) => {
                    create_file_with_symbols(`${base_name}.do`);
                    const caller_uri = URI.file(path.join(temp_dir, 'caller.do')).toString();

                    const forward_calls: ForwardCall[] = [{
                        type: 'include',
                        path: path.join(temp_dir, base_name),
                        raw_path: base_name,
                        call_site_line: 0,
                        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
                        source: 'command',
                        is_static: true,
                    }];

                    const result = await forward_resolver.resolve(caller_uri, forward_calls);
                    expect(result.symbols.localMacros.has('test_local')).toBe(true);
                    expect(result.symbols.globalMacros.has('test_global')).toBe(true);
                }
            ), { numRuns: 100 });
        });
    });

    // Property 7: Backward Scope Resolution
    describe('Property 7: Backward Scope Resolution', () => {
        test('done-by directives resolve symbols from .do fallback files', async () => {
            await fc.assert(fc.asyncProperty(
                arbitrary_identifier(),
                async (base_name) => {
                    create_file_with_symbols(`${base_name}.do`);
                    const child_content = `// @lsp-done-by: "${base_name}"`;
                    const child_file = write_file('child.do', child_content);
                    const child_uri = URI.file(child_file).toString();

                    const resolved = await scope_resolver.resolve(child_uri, child_content);
                    expect(resolved.symbols.globalMacros.has('test_global')).toBe(true);
                    expect(resolved.symbols.programs.has('test_program')).toBe(true);
                    expect(resolved.symbols.localMacros.has('test_local')).toBe(false);
                }
            ), { numRuns: 100 });
        });

        test('included-by directives resolve all symbols from .do fallback files', async () => {
            await fc.assert(fc.asyncProperty(
                arbitrary_identifier(),
                async (base_name) => {
                    create_file_with_symbols(`${base_name}.do`);
                    const child_content = `// @lsp-included-by: "${base_name}"`;
                    const child_file = write_file('child.do', child_content);
                    const child_uri = URI.file(child_file).toString();

                    const resolved = await scope_resolver.resolve(child_uri, child_content);
                    expect(resolved.symbols.localMacros.has('test_local')).toBe(true);
                    expect(resolved.symbols.globalMacros.has('test_global')).toBe(true);
                }
            ), { numRuns: 100 });
        });
    });

    // Edge Cases
    describe('Edge Cases', () => {
        test('empty path returns resolved directory path', () => {
            // Empty path resolves to containing directory (expected behavior)
            const result = directive_parser.resolve_path_with_fallback('', temp_dir);
            expect(result).toBe(temp_dir);
        });

        test('path with multiple dots', () => {
            fc.assert(fc.property(
                arbitrary_identifier(),
                (base_name) => {
                    const complex_name = `${base_name}.backup.do`;
                    const file = create_file_with_symbols(complex_name);
                    const result = directive_parser.resolve_path_with_fallback(complex_name, temp_dir);
                    expect(result).toBe(file);
                }
            ), { numRuns: 100 });
        });
    });
});
