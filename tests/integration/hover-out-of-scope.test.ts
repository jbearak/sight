import { init_tracker_from_source } from '../test-context-helper';
/**
 * Integration tests for hover out-of-scope display.
 * 
 * These tests verify that when hovering over an out-of-scope local macro,
 * the hover provider shows the out-of-scope macro info with "(out of scope)"
 * indicator, NOT falling through to show unrelated symbols like variables.
 * 
 * This test reproduces the real scenario where:
 * 1. A file has @lsp-done-by directive pointing to a parent
 * 2. The parent defines a local macro
 * 3. The child references that local macro with `macro_name' syntax
 * 4. The local macro is out-of-scope because done-by doesn't inherit locals
 * 5. A variable with the same name exists in workspace symbols
 * 
 * Expected: Hover shows "Local Macro: `macro_name` (out of scope)"
 * NOT: "Variable: macro_name"
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { HoverProvider } from '../../src/providers/hover';
import { CommandDatabase } from '../../src/command-database';
import { ScopeResolver } from '../../src/scope-resolver';
import { DocumentState } from '../../src/document-store';
import { Position, MarkupKind } from 'vscode-languageserver';
import { ResolvedScope, OutOfScopeSymbol, SymbolTable } from '../../src/types';
import { ContextTracker } from '../../src/context-tracker';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Hover Out-of-Scope Integration Tests', () => {
    let hover_provider: HoverProvider;
    let command_db: CommandDatabase;
    let temp_dir: string;

    beforeEach(() => {
        command_db = new CommandDatabase();
        hover_provider = new HoverProvider(command_db);
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hover-test-'));
    });

    afterEach(() => {
        // Clean up temp files
        fs.rmSync(temp_dir, { recursive: true, force: true });
    });

    /**
     * Create a DocumentState with proper context tracking.
     */
    function create_document_state(
        content: string,
        uri: string,
        symbols?: SymbolTable
    ): DocumentState {
        const context_tracker = new ContextTracker();
        init_tracker_from_source(context_tracker, content);

        const line_offsets: number[] = [0];
        for (let i = 0; i < content.length; i++) {
            if (content[i] === '\n') {
                line_offsets.push(i + 1);
            }
        }

        return {
            uri,
            version: 1,
            content,
            tokens: [],
            ast: { nodes: [] },
            symbols: symbols || {
                programs: new Map(),
                localMacros: new Map(),
                globalMacros: new Map(),
                variables: new Map(),
                scalars: new Map(),
                matrices: new Map(),
            },
            diagnostics: [],
            context_ranges: context_tracker.get_all_context_ranges(),
            context_tracker,
            line_offsets,
            forward_calls: [],
        };
    }

    describe('Real scenario: done-by with out-of-scope local macro', () => {
        test('should show out-of-scope local macro info, NOT variable info', async () => {
            // Setup: Create parent file that defines a local macro
            const parent_path = path.join(temp_dir, 'parent.do');
            const parent_content = `
// Parent file that defines local macro
local country_name "USA"
display "\`country_name'"
`;
            fs.writeFileSync(parent_path, parent_content);

            // Setup: Create child file with @lsp-done-by directive
            const child_uri = `file://${path.join(temp_dir, 'child.do')}`;
            const child_content = `// @lsp-done-by: "parent.do"
// This file is run via 'do' from parent
// Local macros are NOT inherited via do/run
display "\`country_name'"
`;

            // Create document state for child
            // Include a variable with the same name (simulating workspace symbols)
            const child_symbols: SymbolTable = {
                programs: new Map(),
                localMacros: new Map(),
                globalMacros: new Map(),
                variables: new Map([
                    ['country_name', {
                        name: 'country_name',
                        location: {
                            uri: 'file:///other/file.do',
                            range: { start: { line: 22, character: 0 }, end: { line: 22, character: 12 } }
                        },
                        sourceUri: 'file:///other/file.do',
                        source: 'gen' as const,
                    }]
                ]),
                scalars: new Map(),
                matrices: new Map(),
            };

            const child_document = create_document_state(child_content, child_uri, child_symbols);

            // Create workspace symbols with the same variable
            const workspace_symbols: SymbolTable = {
                programs: new Map(),
                localMacros: new Map(),
                globalMacros: new Map(),
                variables: new Map([
                    ['country_name', {
                        name: 'country_name',
                        location: {
                            uri: 'file:///other/file.do',
                            range: { start: { line: 22, character: 0 }, end: { line: 22, character: 12 } }
                        },
                        sourceUri: 'file:///other/file.do',
                        source: 'gen' as const,
                    }]
                ]),
                scalars: new Map(),
                matrices: new Map(),
            };

            // Create a mock scope resolver that returns the out-of-scope local macro
            const out_of_scope_symbols: OutOfScopeSymbol[] = [{
                name: 'country_name',
                type: 'local',
                source_uri: `file://${parent_path}`,
                defined_line: 2, // 0-indexed
                call_site_line: 0,
                reason: 'inheritance_excludes_locals',
            }];

            const resolved_scope: ResolvedScope = {
                chain: [],
                symbols: {
                    programs: new Map(),
                    localMacros: new Map(), // Empty - local not inherited
                    globalMacros: new Map(),
                    variables: new Map(),
                    scalars: new Map(),
                    matrices: new Map(),
                },
                out_of_scope_symbols,
                diagnostics: [],
                has_directives: true, has_auto_parents: false, is_standalone: false,
            };

            const mock_scope_resolver = {
                resolve: async () => resolved_scope,
            } as unknown as ScopeResolver;

            // Position at 'country_name' in the local macro reference `country_name'
            // Line 3 (0-indexed): display "`country_name'"
            // The backtick is at position 9, 'c' is at position 10
            const position: Position = { line: 3, character: 10 };

            // Call get_hover
            const hover = await hover_provider.get_hover(
                child_document,
                position,
                workspace_symbols,
                mock_scope_resolver,
                undefined,
                undefined,
                temp_dir
            );

            // Verify: Should show out-of-scope local macro, NOT variable
            expect(hover).not.toBeNull();
            const content = hover!.contents as { kind: string; value: string };
            
            // Should contain "(out of scope)" indicator
            expect(content.value).toContain('(out of scope)');
            
            // Should show as Local Macro
            expect(content.value).toContain('Local Macro');
            expect(content.value).toContain('country_name');
            
            // Should NOT show Variable info
            expect(content.value).not.toContain('Variable');
        });

        test('should show out-of-scope global macro info when using $ syntax', async () => {
            const child_uri = `file://${path.join(temp_dir, 'child.do')}`;
            const child_content = `// @lsp-done-by: "parent.do"
display $country_name
`;

            const child_document = create_document_state(child_content, child_uri);

            // Create workspace symbols with a variable of the same name
            const workspace_symbols: SymbolTable = {
                programs: new Map(),
                localMacros: new Map(),
                globalMacros: new Map(),
                variables: new Map([
                    ['country_name', {
                        name: 'country_name',
                        location: {
                            uri: 'file:///other/file.do',
                            range: { start: { line: 22, character: 0 }, end: { line: 22, character: 12 } }
                        },
                        sourceUri: 'file:///other/file.do',
                        source: 'gen' as const,
                    }]
                ]),
                scalars: new Map(),
                matrices: new Map(),
            };

            const out_of_scope_symbols: OutOfScopeSymbol[] = [{
                name: 'country_name',
                type: 'global',
                source_uri: 'file:///parent.do',
                defined_line: 5,
                call_site_line: 0,
                reason: 'after_call_site',
            }];

            const resolved_scope: ResolvedScope = {
                chain: [],
                symbols: {
                    programs: new Map(),
                    localMacros: new Map(),
                    globalMacros: new Map(),
                    variables: new Map(),
                    scalars: new Map(),
                    matrices: new Map(),
                },
                out_of_scope_symbols,
                diagnostics: [],
                has_directives: true, has_auto_parents: false, is_standalone: false,
            };

            const mock_scope_resolver = {
                resolve: async () => resolved_scope,
            } as unknown as ScopeResolver;

            // Position at 'country_name' after $
            // Line 1: display $country_name
            // $ is at position 8, 'c' is at position 9
            const position: Position = { line: 1, character: 9 };

            const hover = await hover_provider.get_hover(
                child_document,
                position,
                workspace_symbols,
                mock_scope_resolver,
                undefined,
                undefined,
                temp_dir
            );

            expect(hover).not.toBeNull();
            const content = hover!.contents as { kind: string; value: string };
            
            expect(content.value).toContain('(out of scope)');
            expect(content.value).toContain('Global Macro');
            expect(content.value).not.toContain('Variable');
        });

        test('bare identifier should still show variable (no out-of-scope macro display)', async () => {
            const child_uri = `file://${path.join(temp_dir, 'child.do')}`;
            // Bare identifier - not `country_name' or $country_name
            const child_content = `// @lsp-done-by: "parent.do"
display country_name
`;

            // Document has a variable with this name
            const child_symbols: SymbolTable = {
                programs: new Map(),
                localMacros: new Map(),
                globalMacros: new Map(),
                variables: new Map([
                    ['country_name', {
                        name: 'country_name',
                        location: {
                            uri: child_uri,
                            range: { start: { line: 1, character: 8 }, end: { line: 1, character: 20 } }
                        },
                        sourceUri: child_uri,
                        source: 'gen' as const,
                    }]
                ]),
                scalars: new Map(),
                matrices: new Map(),
            };

            const child_document = create_document_state(child_content, child_uri, child_symbols);

            // Even though there's an out-of-scope local macro with same name,
            // bare identifier should show variable info
            const out_of_scope_symbols: OutOfScopeSymbol[] = [{
                name: 'country_name',
                type: 'local',
                source_uri: 'file:///parent.do',
                defined_line: 2,
                call_site_line: 0,
                reason: 'inheritance_excludes_locals',
            }];

            const resolved_scope: ResolvedScope = {
                chain: [],
                symbols: {
                    programs: new Map(),
                    localMacros: new Map(),
                    globalMacros: new Map(),
                    variables: new Map(),
                    scalars: new Map(),
                    matrices: new Map(),
                },
                out_of_scope_symbols,
                diagnostics: [],
                has_directives: true, has_auto_parents: false, is_standalone: false,
            };

            const mock_scope_resolver = {
                resolve: async () => resolved_scope,
            } as unknown as ScopeResolver;

            // Position at 'country_name' - bare identifier
            // Line 1: display country_name
            // 'c' is at position 8
            const position: Position = { line: 1, character: 8 };

            const hover = await hover_provider.get_hover(
                child_document,
                position,
                undefined,
                mock_scope_resolver,
                undefined,
                undefined,
                temp_dir
            );

            expect(hover).not.toBeNull();
            const content = hover!.contents as { kind: string; value: string };
            
            // Should show Variable, NOT out-of-scope macro
            expect(content.value).toContain('Variable');
            expect(content.value).not.toContain('(out of scope)');
        });
        test('should detect local macro when cursor is in MIDDLE of word', async () => {
            const child_uri = `file://${path.join(temp_dir, 'child.do')}`;
            const child_content = `// @lsp-done-by: "parent.do"
display "\`country_name'"
`;
            // Line 1: display "`country_name'"
            // Positions: d=0, i=1, s=2, p=3, l=4, a=5, y=6, space=7, "=8, `=9, c=10, o=11, u=12, n=13, t=14, r=15, y=16, _=17, n=18, a=19, m=20, e=21, '=22, "=23

            const child_document = create_document_state(child_content, child_uri);

            const out_of_scope_symbols: OutOfScopeSymbol[] = [{
                name: 'country_name',
                type: 'local',
                source_uri: 'file:///parent.do',
                defined_line: 2,
                call_site_line: 0,
                reason: 'inheritance_excludes_locals',
            }];

            const resolved_scope: ResolvedScope = {
                chain: [],
                symbols: {
                    programs: new Map(),
                    localMacros: new Map(),
                    globalMacros: new Map(),
                    variables: new Map(),
                    scalars: new Map(),
                    matrices: new Map(),
                },
                out_of_scope_symbols,
                diagnostics: [],
                has_directives: true, has_auto_parents: false, is_standalone: false,
            };

            const mock_scope_resolver = {
                resolve: async () => resolved_scope,
            } as unknown as ScopeResolver;

            // Test hovering at MIDDLE of word (position 15 = 'r' in 'country_name')
            // This is the real scenario - user hovers somewhere in the middle
            const position: Position = { line: 1, character: 15 };

            const hover = await hover_provider.get_hover(
                child_document,
                position,
                undefined,
                mock_scope_resolver,
                undefined,
                undefined,
                temp_dir
            );

            expect(hover).not.toBeNull();
            const content = hover!.contents as { kind: string; value: string };
            
            // Should detect local macro syntax even when cursor is in middle
            expect(content.value).toContain('(out of scope)');
            expect(content.value).toContain('Local Macro');
        });

        test('global macro reference should NOT show variable hover even when undefined', async () => {
            // When hovering over $country_name (global macro syntax), should NOT show
            // variable info even if a variable with that name exists
            const child_uri = `file://${path.join(temp_dir, 'child.do')}`;
            const child_content = `display $country_name
`;

            // Document has a variable with this name
            const child_symbols: SymbolTable = {
                programs: new Map(),
                localMacros: new Map(),
                globalMacros: new Map(),
                variables: new Map([
                    ['country_name', {
                        name: 'country_name',
                        location: {
                            uri: child_uri,
                            range: { start: { line: 0, character: 8 }, end: { line: 0, character: 20 } }
                        },
                        sourceUri: child_uri,
                        source: 'gen' as const,
                    }]
                ]),
                scalars: new Map(),
                matrices: new Map(),
            };

            const child_document = create_document_state(child_content, child_uri, child_symbols);

            // No out-of-scope symbols, no resolved scope - just workspace symbols
            const workspace_symbols: SymbolTable = {
                programs: new Map(),
                localMacros: new Map(),
                globalMacros: new Map(),
                variables: new Map([
                    ['country_name', {
                        name: 'country_name',
                        location: {
                            uri: 'file:///other/file.do',
                            range: { start: { line: 22, character: 0 }, end: { line: 22, character: 12 } }
                        },
                        sourceUri: 'file:///other/file.do',
                        source: 'gen' as const,
                    }]
                ]),
                scalars: new Map(),
                matrices: new Map(),
            };

            // Position at 'country_name' after $
            // Line 0: display $country_name
            // $ is at position 8, 'c' is at position 9
            const position: Position = { line: 0, character: 9 };

            const hover = await hover_provider.get_hover(
                child_document,
                position,
                workspace_symbols,
                undefined, // No scope resolver
                undefined,
                undefined,
                temp_dir
            );

            // Should return null - no global macro defined, and we shouldn't fall through to variable
            expect(hover).toBeNull();
        });

        test('local macro reference should NOT show variable hover even when undefined', async () => {
            // When hovering over `country_name' (local macro syntax), should NOT show
            // variable info even if a variable with that name exists
            const child_uri = `file://${path.join(temp_dir, 'child.do')}`;
            const child_content = "display `country_name'\n";

            // Document has a variable with this name
            const child_symbols: SymbolTable = {
                programs: new Map(),
                localMacros: new Map(),
                globalMacros: new Map(),
                variables: new Map([
                    ['country_name', {
                        name: 'country_name',
                        location: {
                            uri: child_uri,
                            range: { start: { line: 0, character: 8 }, end: { line: 0, character: 20 } }
                        },
                        sourceUri: child_uri,
                        source: 'gen' as const,
                    }]
                ]),
                scalars: new Map(),
                matrices: new Map(),
            };

            const child_document = create_document_state(child_content, child_uri, child_symbols);

            // Position at 'country_name' after `
            // Line 0: display `country_name'
            // ` is at position 8, 'c' is at position 9
            const position: Position = { line: 0, character: 9 };

            const hover = await hover_provider.get_hover(
                child_document,
                position,
                undefined, // No workspace symbols
                undefined, // No scope resolver
                undefined,
                undefined,
                temp_dir
            );

            // Should return null - no local macro defined, and we shouldn't fall through to variable
            expect(hover).toBeNull();
        });
    });
});
