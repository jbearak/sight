import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { DocumentStore, DocumentState } from '../../src/document-store';
import { Token, TokenType } from '../../src/types';

/**
 * Reference linear scan implementation for verifying the
 * line-bucketed index.  Uses the same [start, end) boundary
 * semantics as `get_token_at_position`.
 */
function linear_scan(
    tokens: Token[],
    line: number,
    character: number
): Token | undefined {
    for (const my_token of tokens) {
        const start = my_token.range.start;
        const end = my_token.range.end;
        const after_start =
            line > start.line
            || (line === start.line
                && character >= start.character);
        const before_end =
            line < end.line
            || (line === end.line
                && character < end.character);
        if (after_start && before_end) return my_token;
    }
    return undefined;
}

// ── Generators ──────────────────────────────────────────────

const THE_TOKEN_TYPES: TokenType[] = [
    'WORD',
    'NUMBER',
    'STRING',
    'OPERATOR',
    'COMMENT_LINE',
    'COMMENT_BLOCK',
    'WHITESPACE',
];

/**
 * Generate a single-line token starting at the given position.
 * The token occupies [start_char, start_char + length) on the
 * given line.
 */
function arbitrary_single_line_token(
    line: number,
    start_char: number
): fc.Arbitrary<Token> {
    return fc
        .record({
            type: fc.constantFrom(...THE_TOKEN_TYPES),
            length: fc.integer({ min: 1, max: 20 }),
        })
        .map(({ type, length }) => ({
            type,
            value: 'x'.repeat(length),
            range: {
                start: { line, character: start_char },
                end: { line, character: start_char + length },
            },
        }));
}

/**
 * Generate a multi-line token starting at (start_line,
 * start_char) and spanning `extra_lines` additional lines.
 */
function arbitrary_multi_line_token(
    start_line: number,
    start_char: number,
    extra_lines: number
): fc.Arbitrary<Token> {
    return fc
        .record({
            type: fc.constantFrom(
                'STRING' as TokenType,
                'COMMENT_BLOCK' as TokenType
            ),
            end_char: fc.integer({ min: 0, max: 40 }),
        })
        .map(({ type, end_char }) => ({
            type,
            value: 'x',
            range: {
                start: {
                    line: start_line,
                    character: start_char,
                },
                end: {
                    line: start_line + extra_lines,
                    character: end_char,
                },
            },
        }));
}

/**
 * Generate a list of non-overlapping tokens laid out across
 * multiple lines.  Tokens may be single-line or multi-line.
 *
 * Strategy: walk forward through lines, placing tokens with
 * gaps between them so they never overlap.
 */
function arbitrary_token_list(): fc.Arbitrary<Token[]> {
    return fc
        .record({
            num_tokens: fc.integer({ min: 0, max: 15 }),
            multi_line_chance: fc.double({
                min: 0,
                max: 0.4,
                noNaN: true,
            }),
            seed: fc.integer({ min: 0, max: 1_000_000 }),
        })
        .chain(({ num_tokens, multi_line_chance, seed }) => {
            // Build tokens deterministically from the seed
            // so fast-check can shrink them.
            const the_tokens: Token[] = [];
            let current_line = 0;
            let current_char = 0;

            // Use a simple LCG seeded by `seed` for
            // deterministic pseudo-random decisions
            let rng = seed;
            function next_rng(): number {
                rng = (rng * 1103515245 + 12345) & 0x7fffffff;
                return rng;
            }

            for (let i = 0; i < num_tokens; i++) {
                const is_multi =
                    (next_rng() % 100) / 100
                    < multi_line_chance;

                const type_idx =
                    next_rng() % THE_TOKEN_TYPES.length;
                const token_type = is_multi
                    ? (next_rng() % 2 === 0
                        ? 'STRING'
                        : 'COMMENT_BLOCK') as TokenType
                    : THE_TOKEN_TYPES[type_idx];

                if (is_multi) {
                    const extra_lines =
                        1 + (next_rng() % 4);
                    const end_char = next_rng() % 30;
                    the_tokens.push({
                        type: token_type,
                        value: 'x',
                        range: {
                            start: {
                                line: current_line,
                                character: current_char,
                            },
                            end: {
                                line: current_line
                                    + extra_lines,
                                character: end_char,
                            },
                        },
                    });
                    current_line += extra_lines;
                    current_char = end_char + 1;
                } else {
                    const length = 1 + (next_rng() % 15);
                    the_tokens.push({
                        type: token_type,
                        value: 'x'.repeat(length),
                        range: {
                            start: {
                                line: current_line,
                                character: current_char,
                            },
                            end: {
                                line: current_line,
                                character: current_char
                                    + length,
                            },
                        },
                    });
                    current_char += length + 1;
                }

                // Occasionally advance to the next line
                if (next_rng() % 3 === 0) {
                    current_line++;
                    current_char = next_rng() % 10;
                }
            }

            return fc.constant(the_tokens);
        });
}

/**
 * Given a list of tokens, generate a random position that
 * falls strictly inside one of the tokens.
 */
function arbitrary_position_inside_token(
    tokens: Token[]
): fc.Arbitrary<{
    line: number;
    character: number;
    expected_token: Token;
}> {
    if (tokens.length === 0) {
        // No tokens — return a position that should yield
        // undefined from both methods
        return fc.constant({
            line: 0,
            character: 0,
            expected_token: undefined as unknown as Token,
        });
    }

    return fc
        .integer({ min: 0, max: tokens.length - 1 })
        .chain((token_idx) => {
            const my_token = tokens[token_idx];
            const start = my_token.range.start;
            const end = my_token.range.end;

            if (
                start.line === end.line
                && start.character >= end.character
            ) {
                // Zero-width token — skip
                return fc.constant({
                    line: start.line,
                    character: start.character,
                    expected_token: my_token,
                });
            }

            // Generate a position within [start, end)
            return fc
                .integer({
                    min: start.line,
                    max: end.line,
                })
                .chain((line) => {
                    let min_char: number;
                    let max_char: number;

                    if (line === start.line
                        && line === end.line) {
                        // Single-line token
                        min_char = start.character;
                        // end is exclusive, so max valid
                        // char is end.character - 1
                        max_char = Math.max(
                            start.character,
                            end.character - 1
                        );
                    } else if (line === start.line) {
                        min_char = start.character;
                        // On the start line of a multi-line
                        // token, any char >= start is valid
                        max_char = Math.max(
                            start.character,
                            start.character + 20
                        );
                    } else if (line === end.line) {
                        min_char = 0;
                        // end is exclusive
                        max_char = Math.max(
                            0,
                            end.character - 1
                        );
                    } else {
                        // Middle line of multi-line token
                        min_char = 0;
                        max_char = 40;
                    }

                    if (min_char > max_char) {
                        min_char = max_char;
                    }

                    return fc
                        .integer({
                            min: min_char,
                            max: max_char,
                        })
                        .map((character) => ({
                            line,
                            character,
                            expected_token: my_token,
                        }));
                });
        });
}

/**
 * Generate a position that does NOT fall inside any token.
 * Strategy: pick a line and character in a gap between tokens.
 */
function arbitrary_position_outside_tokens(
    tokens: Token[]
): fc.Arbitrary<{ line: number; character: number }> {
    if (tokens.length === 0) {
        return fc.record({
            line: fc.integer({ min: 0, max: 10 }),
            character: fc.integer({ min: 0, max: 40 }),
        });
    }

    // Find the max line across all tokens
    let max_line = 0;
    for (const my_token of tokens) {
        if (my_token.range.end.line > max_line) {
            max_line = my_token.range.end.line;
        }
    }

    // Pick a line beyond all tokens — guaranteed gap
    return fc.record({
        line: fc.constant(max_line + 5),
        character: fc.integer({ min: 0, max: 40 }),
    });
}

// ── Helpers ─────────────────────────────────────────────────

/**
 * Build a minimal DocumentState with the given tokens and a
 * precomputed token_line_index.  We call the DocumentStore's
 * public `get_token_at_position` method, which reads from
 * `state.token_line_index`.
 */
function build_state_with_tokens(
    tokens: Token[]
): DocumentState {
    // Build the line index the same way DocumentStore does
    const index = new Map<number, Token[]>();
    for (const my_token of tokens) {
        const start_line = my_token.range.start.line;
        const end_line = my_token.range.end.line;
        for (
            let my_line = start_line;
            my_line <= end_line;
            my_line++
        ) {
            let bucket = index.get(my_line);
            if (!bucket) {
                bucket = [];
                index.set(my_line, bucket);
            }
            bucket.push(my_token);
        }
    }

    // Minimal stub — only fields needed by
    // get_token_at_position
    return {
        uri: 'file:///test.do',
        version: 1,
        content: '',
        tokens,
        ast: null,
        symbols: {
            programs: new Map(),
            localMacros: new Map(),
            globalMacros: new Map(),
            variables: new Map(),
            scalars: new Map(),
            matrices: new Map(),
        },
        diagnostics: [],
        context_ranges: [],
        context_tracker: null as any,
        line_offsets: [0],
        forward_calls: [],
        token_line_index: index,
    } as DocumentState;
}

// ── Property Tests ──────────────────────────────────────────

describe('Token Position Index Property Tests', () => {
    /**
     * Property 6: Token position index matches linear scan
     *
     * For any list of tokens (including multi-line tokens)
     * and any position (line, character) within a token's
     * range, `get_token_at_position` using the line-bucketed
     * index shall return the same token as a linear scan
     * over all tokens.
     *
     * **Validates: Requirements 6.1, 12.1, 12.2**
     */
    it(
        'index lookup matches linear scan for positions'
            + ' inside tokens',
        () => {
            const my_store = new DocumentStore();
            fc.assert(
                fc.property(
                    arbitrary_token_list().filter(
                        (t) => t.length > 0
                    ),
                    (tokens) => {
                        const my_state =
                            build_state_with_tokens(tokens);

                        // Test every token at its start
                        // position
                        for (const my_token of tokens) {
                            const start =
                                my_token.range.start;
                            const end = my_token.range.end;

                            // Skip zero-width tokens
                            if (
                                start.line === end.line
                                && start.character
                                    >= end.character
                            ) {
                                continue;
                            }

                            const index_result =
                                my_store
                                    .get_token_at_position(
                                        my_state,
                                        start.line,
                                        start.character
                                    );
                            const scan_result =
                                linear_scan(
                                    tokens,
                                    start.line,
                                    start.character
                                );

                            expect(index_result).toBe(
                                scan_result
                            );
                        }
                    }
                ),
                { numRuns: 200 }
            );
        }
    );

    /**
     * Property 6 (continued): random positions inside tokens
     *
     * For any randomly chosen position within a token's
     * range, the index lookup and linear scan agree.
     *
     * **Validates: Requirements 6.1, 12.1, 12.2**
     */
    it(
        'index lookup matches linear scan for random'
            + ' positions inside tokens',
        () => {
            const my_store = new DocumentStore();
            fc.assert(
                fc.property(
                    arbitrary_token_list()
                        .filter((t) => t.length > 0)
                        .chain((tokens) =>
                            arbitrary_position_inside_token(
                                tokens
                            ).map((pos) => ({
                                tokens,
                                ...pos,
                            }))
                        ),
                    ({ tokens, line, character }) => {
                        const my_state =
                            build_state_with_tokens(tokens);

                        const index_result =
                            my_store.get_token_at_position(
                                my_state,
                                line,
                                character
                            );
                        const scan_result = linear_scan(
                            tokens,
                            line,
                            character
                        );

                        expect(index_result).toBe(
                            scan_result
                        );
                    }
                ),
                { numRuns: 200 }
            );
        }
    );

    /**
     * Property 6 (continued): positions outside all tokens
     *
     * For any position that does not fall within any token's
     * range, both the index lookup and linear scan shall
     * return undefined.
     *
     * **Validates: Requirements 6.1, 12.1, 12.2**
     */
    it(
        'index lookup and linear scan both return undefined'
            + ' for positions outside all tokens',
        () => {
            const my_store = new DocumentStore();
            fc.assert(
                fc.property(
                    arbitrary_token_list().chain(
                        (tokens) =>
                            arbitrary_position_outside_tokens(
                                tokens
                            ).map((pos) => ({
                                tokens,
                                ...pos,
                            }))
                    ),
                    ({ tokens, line, character }) => {
                        const my_state =
                            build_state_with_tokens(tokens);

                        const index_result =
                            my_store.get_token_at_position(
                                my_state,
                                line,
                                character
                            );
                        const scan_result = linear_scan(
                            tokens,
                            line,
                            character
                        );

                        expect(index_result).toBeUndefined();
                        expect(scan_result).toBeUndefined();
                    }
                ),
                { numRuns: 200 }
            );
        }
    );

    /**
     * Property 6 (continued): multi-line tokens found on
     * every spanned line
     *
     * For any multi-line token, querying any line it spans
     * (with a valid character) shall return that token from
     * both the index and the linear scan.
     *
     * **Validates: Requirements 12.1, 12.2**
     */
    it(
        'multi-line tokens are found on every line they'
            + ' span',
        () => {
            const my_store = new DocumentStore();
            fc.assert(
                fc.property(
                    arbitrary_token_list().filter(
                        (tokens) =>
                            tokens.some(
                                (t) =>
                                    t.range.end.line
                                    > t.range.start.line
                            )
                    ),
                    (tokens) => {
                        const my_state =
                            build_state_with_tokens(tokens);

                        for (const my_token of tokens) {
                            const start =
                                my_token.range.start;
                            const end = my_token.range.end;

                            if (
                                end.line <= start.line
                            ) {
                                continue;
                            }

                            // Test each line the token spans
                            for (
                                let my_line = start.line;
                                my_line <= end.line;
                                my_line++
                            ) {
                                let test_char: number;
                                if (
                                    my_line === start.line
                                ) {
                                    test_char =
                                        start.character;
                                } else if (
                                    my_line === end.line
                                ) {
                                    // end is exclusive;
                                    // only test if
                                    // end.character > 0
                                    if (
                                        end.character <= 0
                                    ) {
                                        continue;
                                    }
                                    test_char = 0;
                                } else {
                                    // Middle line — char 0
                                    // is always inside
                                    test_char = 0;
                                }

                                const index_result =
                                    my_store
                                        .get_token_at_position(
                                            my_state,
                                            my_line,
                                            test_char
                                        );
                                const scan_result =
                                    linear_scan(
                                        tokens,
                                        my_line,
                                        test_char
                                    );

                                expect(
                                    index_result
                                ).toBe(scan_result);
                                expect(
                                    index_result
                                ).toBe(my_token);
                            }
                        }
                    }
                ),
                { numRuns: 200 }
            );
        }
    );

    /**
     * Property 6 (continued): empty token list
     *
     * For an empty token list, any position query shall
     * return undefined from both methods.
     *
     * **Validates: Requirements 6.1, 12.2**
     */
    it(
        'empty token list returns undefined for any'
            + ' position',
        () => {
            const my_store = new DocumentStore();
            fc.assert(
                fc.property(
                    fc.integer({ min: 0, max: 100 }),
                    fc.integer({ min: 0, max: 100 }),
                    (line, character) => {
                        const my_state =
                            build_state_with_tokens([]);

                        const index_result =
                            my_store.get_token_at_position(
                                my_state,
                                line,
                                character
                            );
                        const scan_result = linear_scan(
                            [],
                            line,
                            character
                        );

                        expect(
                            index_result
                        ).toBeUndefined();
                        expect(
                            scan_result
                        ).toBeUndefined();
                    }
                ),
                { numRuns: 100 }
            );
        }
    );
});
