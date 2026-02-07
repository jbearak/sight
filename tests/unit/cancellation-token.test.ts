/**
 * Tests for CancellationToken checking in providers and
 * resolvers.
 *
 * Covers:
 * - Property 5: Cancellation causes early exit in token
 *   scan loops
 *   **Validates: Requirements 5.4, 13.3**
 * - Property 13: Cancellation short-circuits cross-file
 *   resolution
 *   **Validates: Requirements 13.1, 13.2**
 * - Unit tests for hover/definition/references returning
 *   null on pre-cancelled token (Req 5.1, 5.2, 5.3)
 */

import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { CancellationToken } from 'vscode-languageserver';
import { HoverProvider } from '../../src/providers/hover';
import { DefinitionProvider } from '../../src/providers/definition';
import { ReferencesProvider } from '../../src/providers/references';
import { CommandDatabase } from '../../src/command-database';
import { ContextTracker } from '../../src/context-tracker';
import { DocumentState } from '../../src/document-store';
import { Token, SymbolTable } from '../../src/types';

// -------------------------------------------------------
// Helpers
// -------------------------------------------------------

/**
 * Create a pre-cancelled CancellationToken.
 * isCancellationRequested is already true before any
 * provider method is called.
 */
function create_cancelled_token(): CancellationToken {
    return {
        isCancellationRequested: true,
        onCancellationRequested: () => ({
            dispose: () => {},
        }),
    };
}

/**
 * Create a CancellationToken that is NOT cancelled.
 */
function create_live_token(): CancellationToken {
    return {
        isCancellationRequested: false,
        onCancellationRequested: () => ({
            dispose: () => {},
        }),
    };
}

/**
 * Create an empty SymbolTable.
 */
function create_empty_symbol_table(): SymbolTable {
    return {
        programs: new Map(),
        localMacros: new Map(),
        globalMacros: new Map(),
        variables: new Map(),
        scalars: new Map(),
        matrices: new Map(),
    };
}

/**
 * Generate a list of WORD tokens on a single line.
 * Each token occupies a unique character range.
 */
function generate_word_tokens(count: number): Token[] {
    const the_tokens: Token[] = [];
    for (let i = 0; i < count; i++) {
        the_tokens.push({
            type: 'WORD',
            value: `var${i}`,
            range: {
                start: { line: 0, character: i * 6 },
                end: { line: 0, character: i * 6 + 4 },
            },
        });
    }
    return the_tokens;
}

/**
 * Build a content string that matches the token layout.
 */
function build_content_for_tokens(
    the_tokens: Token[]
): string {
    if (the_tokens.length === 0) return '';
    const last = the_tokens[the_tokens.length - 1];
    const length =
        last.range.end.character;
    return 'x'.repeat(length);
}

/**
 * Build line offsets for a single-line content string.
 */
function build_line_offsets(content: string): number[] {
    const the_offsets: number[] = [0];
    for (let i = 0; i < content.length; i++) {
        if (content[i] === '\n') {
            the_offsets.push(i + 1);
        }
    }
    return the_offsets;
}

/**
 * Create a minimal DocumentState with the given tokens.
 */
function create_document_with_tokens(
    the_tokens: Token[],
    uri: string = 'file:///test.do'
): DocumentState {
    const content = build_content_for_tokens(the_tokens);
    const my_context_tracker = new ContextTracker();
    return {
        uri,
        version: 1,
        content,
        tokens: the_tokens,
        ast: { nodes: [] },
        symbols: create_empty_symbol_table(),
        diagnostics: [],
        context_ranges: [],
        context_tracker: my_context_tracker,
        line_offsets: build_line_offsets(content),
        forward_calls: [],
        token_line_index: new Map(),
    };
}

// -------------------------------------------------------
// Unit tests: Req 5.1, 5.2, 5.3
// -------------------------------------------------------

describe('CancellationToken in Providers', () => {
    /**
     * Req 5.1: Hover returns null on pre-cancelled token.
     */
    describe('Hover provider (Req 5.1)', () => {
        it(
            'returns null when cancellation token is '
            + 'pre-cancelled',
            async () => {
                const command_db = new CommandDatabase();
                const provider = new HoverProvider(command_db);
                const the_tokens = generate_word_tokens(10);
                const document =
                    create_document_with_tokens(the_tokens);
                const cancelled_token = create_cancelled_token();

                const result = await provider.get_hover(
                    document,
                    { line: 0, character: 0 },
                    undefined,
                    undefined,
                    undefined,
                    cancelled_token
                );

                expect(result).toBeNull();
            }
        );

        it(
            'does not return null when token is not '
            + 'cancelled',
            async () => {
                const command_db = new CommandDatabase();
                const provider = new HoverProvider(command_db);
                // Create a document with a known command
                // so hover returns something
                const the_tokens: Token[] = [
                    {
                        type: 'WORD',
                        value: 'display',
                        range: {
                            start: {
                                line: 0,
                                character: 0,
                            },
                            end: {
                                line: 0,
                                character: 7,
                            },
                        },
                    },
                ];
                const document =
                    create_document_with_tokens(the_tokens);
                document.content = 'display';
                document.line_offsets = [0];
                const live_token = create_live_token();

                // Load a minimal cache so command lookup works
                command_db.load_cache({
                    version: 18,
                    commands: {
                        display: {
                            name: 'display',
                            syntax: 'display ...',
                            min_abbreviation: 2,
                            options: [],
                        },
                    },
                    abbreviations: { di: 'display' },
                });

                const result = await provider.get_hover(
                    document,
                    { line: 0, character: 3 },
                    undefined,
                    undefined,
                    undefined,
                    live_token
                );

                // With a valid command, hover should return
                // something (not null)
                expect(result).not.toBeNull();
            }
        );
    });

    /**
     * Req 5.2: Definition returns null on pre-cancelled
     * token.
     */
    describe('Definition provider (Req 5.2)', () => {
        it(
            'returns null when cancellation token is '
            + 'pre-cancelled',
            async () => {
                const provider = new DefinitionProvider();
                const the_tokens = generate_word_tokens(10);
                const document =
                    create_document_with_tokens(the_tokens);
                const cancelled_token = create_cancelled_token();

                const result = await provider.get_definition(
                    document,
                    { line: 0, character: 0 },
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    cancelled_token
                );

                expect(result).toBeNull();
            }
        );
    });

    /**
     * Req 5.3: References returns empty array on
     * pre-cancelled token.
     */
    describe('References provider (Req 5.3)', () => {
        it(
            'returns empty array when cancellation token '
            + 'is pre-cancelled',
            async () => {
                const provider = new ReferencesProvider();
                const the_tokens = generate_word_tokens(10);
                const document =
                    create_document_with_tokens(the_tokens);
                const cancelled_token = create_cancelled_token();

                const result = await provider.get_references(
                    document,
                    { line: 0, character: 0 },
                    { includeDeclaration: true },
                    undefined,
                    undefined,
                    cancelled_token
                );

                expect(result).toEqual([]);
            }
        );
    });
});

// -------------------------------------------------------
// Property 5: Cancellation causes early exit in token
// scan loops
// -------------------------------------------------------

describe(
    'Property 5: Cancellation causes early exit in '
    + 'token scan loops',
    () => {
        /**
         * For any token list of length > 500 and a
         * pre-cancelled CancellationToken, provider
         * token-scanning loops shall examine fewer than
         * all tokens before returning.
         *
         * **Validates: Requirements 5.4, 13.3**
         */
        it(
            'references scan_tokens_for_references exits '
            + 'early with pre-cancelled token',
            async () => {
                await fc.assert(
                    fc.asyncProperty(
                        fc.integer({
                            min: 501,
                            max: 2000,
                        }),
                        async (token_count) => {
                            const provider =
                                new ReferencesProvider();

                            // Generate a large token list
                            // with MACRO_REF_LOCAL tokens
                            // that match the search
                            const the_tokens: Token[] = [];
                            for (
                                let i = 0;
                                i < token_count;
                                i++
                            ) {
                                the_tokens.push({
                                    type: 'MACRO_REF_LOCAL',
                                    value: "`myvar'",
                                    range: {
                                        start: {
                                            line: i,
                                            character: 0,
                                        },
                                        end: {
                                            line: i,
                                            character: 7,
                                        },
                                    },
                                });
                            }

                            const cancelled_token =
                                create_cancelled_token();

                            // scan_tokens_for_references
                            // checks cancellation every
                            // 500 iterations
                            const matches =
                                provider
                                    .scan_tokens_for_references(
                                        the_tokens,
                                        'file:///test.do',
                                        {
                                            symbol_name:
                                                'myvar',
                                            symbol_type:
                                                'local_macro',
                                            include_declaration:
                                                true,
                                        },
                                        undefined,
                                        cancelled_token
                                    );

                            // With pre-cancelled token,
                            // the loop exits at the first
                            // cancellation check (iteration
                            // 0, since 0 % 500 === 0),
                            // yielding 0 matches.
                            expect(matches.length).toBe(0);
                        }
                    ),
                    { numRuns: 25 }
                );
            },
            10_000
        );

        it(
            'references workspace scan exits early with '
            + 'pre-cancelled token',
            async () => {
                await fc.assert(
                    fc.asyncProperty(
                        fc.integer({
                            min: 501,
                            max: 1500,
                        }),
                        async (token_count) => {
                            const provider =
                                new ReferencesProvider();

                            // Create a document with a
                            // local macro reference at
                            // cursor position
                            const the_tokens: Token[] = [
                                {
                                    type: 'MACRO_REF_LOCAL',
                                    value: "`myvar'",
                                    range: {
                                        start: {
                                            line: 0,
                                            character: 0,
                                        },
                                        end: {
                                            line: 0,
                                            character: 7,
                                        },
                                    },
                                },
                            ];
                            const document =
                                create_document_with_tokens(
                                    the_tokens
                                );
                            document.content = "`myvar'";
                            document.line_offsets = [0];
                            document.symbols
                                .localMacros.set(
                                    'myvar',
                                    {
                                        name: 'myvar',
                                        scope: 'local',
                                        location: {
                                            uri: document.uri,
                                            range: {
                                                start: {
                                                    line: 0,
                                                    character:
                                                        0,
                                                },
                                                end: {
                                                    line: 0,
                                                    character:
                                                        7,
                                                },
                                            },
                                        },
                                        sourceUri:
                                            document.uri,
                                    }
                                );

                            // Create a mock workspace
                            // indexer with many files
                            const indexed_files = new Map<
                                string,
                                {
                                    tokens: Token[];
                                    context_ranges: any[];
                                }
                            >();
                            for (
                                let i = 0;
                                i < 50;
                                i++
                            ) {
                                const file_tokens: Token[] =
                                    [];
                                for (
                                    let j = 0;
                                    j < token_count;
                                    j++
                                ) {
                                    file_tokens.push({
                                        type: 'MACRO_REF_LOCAL',
                                        value: "`myvar'",
                                        range: {
                                            start: {
                                                line: j,
                                                character:
                                                    0,
                                            },
                                            end: {
                                                line: j,
                                                character:
                                                    7,
                                            },
                                        },
                                    });
                                }
                                indexed_files.set(
                                    `file:///ws/file_${i}.do`,
                                    {
                                        tokens: file_tokens,
                                        context_ranges: [],
                                    }
                                );
                            }

                            const mock_indexer = {
                                get_indexed_files: () =>
                                    indexed_files,
                            } as any;

                            const cancelled_token =
                                create_cancelled_token();

                            const result =
                                await provider
                                    .get_references(
                                        document,
                                        {
                                            line: 0,
                                            character: 1,
                                        },
                                        {
                                            includeDeclaration:
                                                false,
                                        },
                                        mock_indexer,
                                        undefined,
                                        cancelled_token
                                    );

                            // Pre-cancelled token should
                            // cause early exit — returns
                            // empty array
                            expect(result).toEqual([]);
                        }
                    ),
                    { numRuns: 50 }
                );
            },
            30_000
        );

        it(
            'definition get_token_at_position exits early '
            + 'with pre-cancelled token',
            async () => {
                await fc.assert(
                    fc.asyncProperty(
                        fc.integer({
                            min: 501,
                            max: 2000,
                        }),
                        async (token_count) => {
                            const provider =
                                new DefinitionProvider();

                            // Generate tokens — the
                            // target position is at the
                            // very end so the loop must
                            // scan many tokens
                            const the_tokens: Token[] = [];
                            for (
                                let i = 0;
                                i < token_count;
                                i++
                            ) {
                                the_tokens.push({
                                    type: 'WORD',
                                    value: `v${i}`,
                                    range: {
                                        start: {
                                            line: i,
                                            character: 0,
                                        },
                                        end: {
                                            line: i,
                                            character: 3,
                                        },
                                    },
                                });
                            }

                            // Build content with enough
                            // lines
                            const the_lines: string[] = [];
                            for (
                                let i = 0;
                                i < token_count;
                                i++
                            ) {
                                the_lines.push(`v${i}`);
                            }
                            const content =
                                the_lines.join('\n');

                            const document =
                                create_document_with_tokens(
                                    the_tokens
                                );
                            document.content = content;
                            document.line_offsets =
                                build_line_offsets(content);

                            const cancelled_token =
                                create_cancelled_token();

                            // get_definition checks
                            // cancellation at entry and
                            // returns null immediately
                            const result =
                                await provider
                                    .get_definition(
                                        document,
                                        {
                                            line: token_count -
                                                1,
                                            character: 1,
                                        },
                                        undefined,
                                        undefined,
                                        undefined,
                                        undefined,
                                        undefined,
                                        cancelled_token
                                    );

                            expect(result).toBeNull();
                        }
                    ),
                    { numRuns: 100 }
                );
            },
            30_000
        );
    }
);

// -------------------------------------------------------
// Property 13: Cancellation short-circuits cross-file
// resolution
// -------------------------------------------------------

describe(
    'Property 13: Cancellation short-circuits '
    + 'cross-file resolution',
    () => {
        /**
         * For any pre-cancelled CancellationToken, scope
         * resolution (backward) and forward-call resolution
         * shall exit before traversing the full call graph.
         *
         * **Validates: Requirements 13.1, 13.2**
         */

        /**
         * Req 13.1: ScopeResolver checks cancellation in
         * traversal loops and returns early.
         *
         * We test this by importing ScopeResolver and
         * calling resolve() with a pre-cancelled token.
         * The resolver should return an empty/partial
         * result without attempting to read parent files.
         */
        it(
            'ScopeResolver.resolve returns early with '
            + 'pre-cancelled token (Req 13.1)',
            async () => {
                // Import ScopeResolver
                const { ScopeResolver } = await import(
                    '../../src/scope-resolver'
                );

                let file_read_count = 0;
                const silent_logger = {
                    log: () => {},
                    warn: () => {},
                };
                const resolver = new ScopeResolver(
                    silent_logger,
                    {
                        read_file: async () => {
                            file_read_count++;
                            return '// parent file';
                        },
                        exists: async () => true,
                    }
                );

                const cancelled_token =
                    create_cancelled_token();

                // Content with a directive that would
                // trigger parent file reads
                const content =
                    '// @lsp-done-by: "parent.do"\n'
                    + 'display "hello"';

                const result = await resolver.resolve(
                    'file:///child.do',
                    content,
                    {},
                    cancelled_token
                );

                // The resolver should return a result
                // (possibly partial) without crashing
                expect(result).toBeDefined();
                expect(result.symbols).toBeDefined();

                // With a pre-cancelled token, the
                // resolver should not have read parent
                // files (or read very few before
                // checking cancellation)
                // Note: it may read the first parent
                // before checking, but should not
                // traverse deeply
                expect(file_read_count).toBeLessThanOrEqual(
                    2
                );
            }
        );

        /**
         * Req 13.2: ForwardScopeResolver checks
         * cancellation in traversal loops and returns
         * early.
         */
        it(
            'ForwardScopeResolver.resolve returns early '
            + 'with pre-cancelled token (Req 13.2)',
            async () => {
                const { ScopeResolver } = await import(
                    '../../src/scope-resolver'
                );
                const { ForwardScopeResolver } = await import(
                    '../../src/forward-scope-resolver'
                );

                let file_read_count = 0;
                const silent_logger = {
                    log: () => {},
                    warn: () => {},
                };
                const scope_resolver = new ScopeResolver(
                    silent_logger,
                    {
                        read_file: async () => {
                            file_read_count++;
                            return 'display "hello"';
                        },
                        exists: async () => true,
                    }
                );
                const resolver = new ForwardScopeResolver(
                    scope_resolver
                );

                const cancelled_token =
                    create_cancelled_token();

                // Create forward calls that would
                // trigger file reads
                const forward_calls = [];
                for (let i = 0; i < 20; i++) {
                    forward_calls.push({
                        path: `/path/to/file_${i}.do`,
                        call_site_line: i,
                        call_type: 'do' as const,
                        is_static: true,
                        source: 'command' as const,
                    });
                }

                const result = await resolver.resolve(
                    'file:///main.do',
                    forward_calls,
                    'include',
                    undefined,
                    undefined,
                    cancelled_token
                );

                // The resolver should return a result
                // without crashing
                expect(result).toBeDefined();
                expect(result.symbols).toBeDefined();

                // With a pre-cancelled token, the
                // resolver should not have read all
                // 20 files
                expect(file_read_count).toBeLessThan(20);
            }
        );

        /**
         * Property test: for any number of forward calls,
         * a pre-cancelled token causes fewer file reads
         * than the total number of calls.
         */
        it(
            'forward resolver reads fewer files than '
            + 'total calls when pre-cancelled',
            async () => {
                const { ScopeResolver } =
                    await import(
                        '../../src/scope-resolver'
                    );
                const { ForwardScopeResolver } =
                    await import(
                        '../../src/forward-scope-resolver'
                    );

                await fc.assert(
                    fc.asyncProperty(
                        fc.integer({
                            min: 5,
                            max: 50,
                        }),
                        async (num_calls) => {
                            let file_read_count = 0;
                            const silent_logger = {
                                log: () => {},
                                warn: () => {},
                            };
                            const scope_resolver =
                                new ScopeResolver(
                                    silent_logger,
                                    {
                                        read_file:
                                            async () => {
                                                file_read_count++;
                                                return 'display "hello"';
                                            },
                                        exists:
                                            async () =>
                                                true,
                                    }
                                );
                            const resolver =
                                new ForwardScopeResolver(
                                    scope_resolver
                                );

                            const cancelled_token =
                                create_cancelled_token();

                            const forward_calls = [];
                            for (
                                let i = 0;
                                i < num_calls;
                                i++
                            ) {
                                forward_calls.push({
                                    path: `/path/file_${i}.do`,
                                    call_site_line: i,
                                    call_type:
                                        'do' as const,
                                    is_static: true,
                                    source: 'command' as const,
                                });
                            }

                            const result =
                                await resolver.resolve(
                                    'file:///main.do',
                                    forward_calls,
                                    'include',
                                    undefined,
                                    undefined,
                                    cancelled_token
                                );

                            expect(
                                result
                            ).toBeDefined();
                            // Pre-cancelled token should
                            // prevent reading all files
                            expect(
                                file_read_count
                            ).toBeLessThan(num_calls);
                        }
                    ),
                    { numRuns: 50 }
                );
            },
            30_000
        );

        /**
         * Property test: for any number of directives,
         * a pre-cancelled token causes the scope resolver
         * to return without full traversal.
         */
        it(
            'scope resolver returns partial result when '
            + 'pre-cancelled',
            async () => {
                const { ScopeResolver } = await import(
                    '../../src/scope-resolver'
                );

                await fc.assert(
                    fc.asyncProperty(
                        fc.integer({
                            min: 2,
                            max: 10,
                        }),
                        async (chain_depth) => {
                            let file_read_count = 0;
                            const silent_logger = {
                                log: () => {},
                                warn: () => {},
                            };

                            // Each parent file points
                            // to another parent, creating
                            // a chain of depth N
                            const resolver =
                                new ScopeResolver(
                                    silent_logger,
                                    {
                                        read_file:
                                            async (
                                                uri: string
                                            ) => {
                                                file_read_count++;
                                                // Each
                                                // parent
                                                // points
                                                // to
                                                // another
                                                const depth =
                                                    file_read_count;
                                                if (
                                                    depth <
                                                    chain_depth
                                                ) {
                                                    return `// @lsp-done-by: "parent_${depth}.do"\ndisplay "level ${depth}"`;
                                                }
                                                return `display "leaf"`;
                                            },
                                        exists:
                                            async () =>
                                                true,
                                    }
                                );

                            const cancelled_token =
                                create_cancelled_token();

                            const content =
                                '// @lsp-done-by: "parent_0.do"\n'
                                + 'display "child"';

                            const result =
                                await resolver.resolve(
                                    'file:///child.do',
                                    content,
                                    {},
                                    cancelled_token
                                );

                            expect(
                                result
                            ).toBeDefined();
                            // With pre-cancelled token,
                            // should not traverse the
                            // full chain
                            expect(
                                file_read_count
                            ).toBeLessThan(
                                chain_depth
                            );
                        }
                    ),
                    { numRuns: 50 }
                );
            },
            30_000
        );
    }
);
