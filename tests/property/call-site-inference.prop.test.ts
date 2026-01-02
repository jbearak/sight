// Feature: global-macro-execution-order, Property 8, 9, 12: Call Site Inference
// Validates: Requirements 4.1, 4.2, 4.3, 4.6

/**
 * Property tests for call site inference functionality.
 *
 * Tests the `infer_call_site_for_file` method of DirectiveParser which
 * automatically detects where a child file is called from a parent file
 * by scanning for do/include/run statements.
 */

import * as fc from 'fast-check';
import { describe, it, expect } from 'bun:test';
import { DirectiveParser } from '../../src/directive-parser';

describe('Call Site Inference Properties', () => {
    const parser = new DirectiveParser();

    /**
     * Generator for valid Stata filenames (without path).
     * Filenames can contain letters, digits, underscores, and hyphens.
     */
    const arbitrary_filename = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_-]{0,15}$/)
        .filter(s => s.length > 0);

    /**
     * Generator for filler lines that won't match do/include/run patterns.
     * These are safe Stata commands that don't invoke other files.
     */
    const arbitrary_filler_line = fc.oneof(
        fc.constant('display "hello"'),
        fc.constant('local x = 1'),
        fc.constant('global y = 2'),
        fc.constant('gen var1 = 1'),
        fc.constant('replace var1 = 2'),
        fc.constant('summarize var1'),
        fc.constant('* this is a comment'),
        fc.constant('// another comment'),
        fc.constant(''),
        arbitrary_filename.map(name => `local ${name} = "value"`)
    );

    /**
     * Generator for do/include/run command types.
     */
    const arbitrary_command = fc.constantFrom('do', 'include', 'run');

    /**
     * Property 8: Call Site Inference Correctness
     *
     * For any parent file content containing `do "child.do"` at 0-indexed
     * line L, calling `infer_call_site_for_file` with that content and
     * filename "child.do" SHALL return L.
     */
    describe('Property 8: Call Site Inference Correctness', () => {
        // Feature: global-macro-execution-order, Property 8: Call Site Inference Correctness
        // Validates: Requirements 4.1, 4.2

        it('returns correct 0-indexed line for quoted path with suffix', () => {
            fc.assert(
                fc.property(
                    // Number of lines before the do statement (0-indexed position)
                    fc.integer({ min: 0, max: 20 }),
                    // Number of lines after the do statement
                    fc.integer({ min: 0, max: 20 }),
                    // Filename to use
                    arbitrary_filename,
                    // Command type
                    arbitrary_command,
                    (lines_before, lines_after, filename, command) => {
                        // Build content with filler lines
                        const the_lines_before: string[] = [];
                        for (let i = 0; i < lines_before; i++) {
                            the_lines_before.push(`local filler_${i} = ${i}`);
                        }

                        const the_lines_after: string[] = [];
                        for (let i = 0; i < lines_after; i++) {
                            the_lines_after.push(`local trailing_${i} = ${i}`);
                        }

                        // Create the do statement with quoted path and .do suffix
                        const do_statement = `${command} "${filename}.do"`;

                        const content = [
                            ...the_lines_before,
                            do_statement,
                            ...the_lines_after,
                        ].join('\n');

                        const result = parser.infer_call_site_for_file(
                            content,
                            `${filename}.do`
                        );

                        // Should return the 0-indexed line number
                        const expected_line = lines_before;
                        return result === expected_line;
                    }
                ),
                { numRuns: 200 }
            );
        });

        it('returns correct 0-indexed line for unquoted path with suffix', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 0, max: 20 }),
                    fc.integer({ min: 0, max: 20 }),
                    arbitrary_filename,
                    arbitrary_command,
                    (lines_before, lines_after, filename, command) => {
                        const the_lines_before: string[] = [];
                        for (let i = 0; i < lines_before; i++) {
                            the_lines_before.push(`local filler_${i} = ${i}`);
                        }

                        const the_lines_after: string[] = [];
                        for (let i = 0; i < lines_after; i++) {
                            the_lines_after.push(`local trailing_${i} = ${i}`);
                        }

                        // Create the do statement with unquoted path and .do suffix
                        const do_statement = `${command} ${filename}.do`;

                        const content = [
                            ...the_lines_before,
                            do_statement,
                            ...the_lines_after,
                        ].join('\n');

                        const result = parser.infer_call_site_for_file(
                            content,
                            `${filename}.do`
                        );

                        const expected_line = lines_before;
                        return result === expected_line;
                    }
                ),
                { numRuns: 200 }
            );
        });

        it('returns correct line for include command', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 0, max: 15 }),
                    arbitrary_filename,
                    (lines_before, filename) => {
                        const the_lines_before: string[] = [];
                        for (let i = 0; i < lines_before; i++) {
                            the_lines_before.push(`display ${i}`);
                        }

                        const include_statement = `include "${filename}.do"`;

                        const content = [
                            ...the_lines_before,
                            include_statement,
                        ].join('\n');

                        const result = parser.infer_call_site_for_file(
                            content,
                            `${filename}.do`
                        );

                        return result === lines_before;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('returns correct line for run command', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 0, max: 15 }),
                    arbitrary_filename,
                    (lines_before, filename) => {
                        const the_lines_before: string[] = [];
                        for (let i = 0; i < lines_before; i++) {
                            the_lines_before.push(`display ${i}`);
                        }

                        const run_statement = `run "${filename}.do"`;

                        const content = [
                            ...the_lines_before,
                            run_statement,
                        ].join('\n');

                        const result = parser.infer_call_site_for_file(
                            content,
                            `${filename}.do`
                        );

                        return result === lines_before;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('returns 0 when do statement is on first line', () => {
            fc.assert(
                fc.property(
                    arbitrary_filename,
                    arbitrary_command,
                    fc.integer({ min: 0, max: 10 }),
                    (filename, command, trailing_lines) => {
                        const the_trailing: string[] = [];
                        for (let i = 0; i < trailing_lines; i++) {
                            the_trailing.push(`local x_${i} = ${i}`);
                        }

                        const content = [
                            `${command} "${filename}.do"`,
                            ...the_trailing,
                        ].join('\n');

                        const result = parser.infer_call_site_for_file(
                            content,
                            `${filename}.do`
                        );

                        return result === 0;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('returns undefined when file is not referenced', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 10 }),
                    arbitrary_filename,
                    arbitrary_filename.filter(f => f.length > 3),
                    (num_lines, search_filename, other_filename) => {
                        // Ensure filenames are different
                        if (search_filename.toLowerCase() === other_filename.toLowerCase()) {
                            return true; // Skip this case
                        }

                        const the_lines: string[] = [];
                        for (let i = 0; i < num_lines; i++) {
                            the_lines.push(`local var_${i} = ${i}`);
                        }
                        // Add a do statement for a different file
                        the_lines.push(`do "${other_filename}.do"`);

                        const content = the_lines.join('\n');

                        const result = parser.infer_call_site_for_file(
                            content,
                            `${search_filename}.do`
                        );

                        return result === undefined;
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 9: Call Site Inference First Match
     *
     * For any parent file containing multiple `do "child.do"` statements
     * at lines L1, L2, ... (where L1 < L2 < ...), `infer_call_site_for_file`
     * SHALL return L1.
     */
    describe('Property 9: Call Site Inference First Match', () => {
        // Feature: global-macro-execution-order, Property 9: Call Site Inference First Match
        // Validates: Requirements 4.3

        it('returns first occurrence when file is referenced multiple times', () => {
            fc.assert(
                fc.property(
                    // Position of first occurrence (0-indexed)
                    fc.integer({ min: 0, max: 10 }),
                    // Gap between first and second occurrence
                    fc.integer({ min: 1, max: 10 }),
                    // Filename
                    arbitrary_filename,
                    // Commands for each occurrence
                    arbitrary_command,
                    arbitrary_command,
                    (first_line, gap, filename, cmd1, cmd2) => {
                        const the_lines: string[] = [];

                        // Add filler lines before first occurrence
                        for (let i = 0; i < first_line; i++) {
                            the_lines.push(`local before_${i} = ${i}`);
                        }

                        // Add first occurrence
                        the_lines.push(`${cmd1} "${filename}.do"`);

                        // Add gap lines
                        for (let i = 0; i < gap; i++) {
                            the_lines.push(`local gap_${i} = ${i}`);
                        }

                        // Add second occurrence
                        the_lines.push(`${cmd2} "${filename}.do"`);

                        const content = the_lines.join('\n');

                        const result = parser.infer_call_site_for_file(
                            content,
                            `${filename}.do`
                        );

                        // Should return the first occurrence
                        return result === first_line;
                    }
                ),
                { numRuns: 200 }
            );
        });

        it('returns first occurrence with three or more references', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 0, max: 5 }),
                    fc.integer({ min: 1, max: 5 }),
                    fc.integer({ min: 1, max: 5 }),
                    arbitrary_filename,
                    (first_line, gap1, gap2, filename) => {
                        const the_lines: string[] = [];

                        // Add filler lines before first occurrence
                        for (let i = 0; i < first_line; i++) {
                            the_lines.push(`local before_${i} = ${i}`);
                        }

                        // First occurrence
                        the_lines.push(`do "${filename}.do"`);

                        // Gap 1
                        for (let i = 0; i < gap1; i++) {
                            the_lines.push(`local gap1_${i} = ${i}`);
                        }

                        // Second occurrence
                        the_lines.push(`include "${filename}.do"`);

                        // Gap 2
                        for (let i = 0; i < gap2; i++) {
                            the_lines.push(`local gap2_${i} = ${i}`);
                        }

                        // Third occurrence
                        the_lines.push(`run "${filename}.do"`);

                        const content = the_lines.join('\n');

                        const result = parser.infer_call_site_for_file(
                            content,
                            `${filename}.do`
                        );

                        return result === first_line;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('returns first match regardless of command type order', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 0, max: 8 }),
                    arbitrary_filename,
                    // Shuffle command order
                    fc.shuffledSubarray(['do', 'include', 'run'], { minLength: 2, maxLength: 3 }),
                    (first_line, filename, commands) => {
                        const the_lines: string[] = [];

                        for (let i = 0; i < first_line; i++) {
                            the_lines.push(`local filler_${i} = ${i}`);
                        }

                        // Add commands with gaps
                        for (const my_cmd of commands) {
                            the_lines.push(`${my_cmd} "${filename}.do"`);
                            the_lines.push('local spacer = 1');
                        }

                        const content = the_lines.join('\n');

                        const result = parser.infer_call_site_for_file(
                            content,
                            `${filename}.do`
                        );

                        return result === first_line;
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 12: Call Site Inference Suffix Handling
     *
     * For any parent file containing `do child` (without `.do` suffix) and
     * child filename "child.do", `infer_call_site_for_file` SHALL match
     * and return the correct line number.
     */
    describe('Property 12: Call Site Inference Suffix Handling', () => {
        // Feature: global-macro-execution-order, Property 12: Call Site Inference Suffix Handling
        // Validates: Requirements 4.6

        it('matches when parent omits .do suffix but child has it', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 0, max: 20 }),
                    fc.integer({ min: 0, max: 20 }),
                    arbitrary_filename,
                    arbitrary_command,
                    (lines_before, lines_after, filename, command) => {
                        const the_lines_before: string[] = [];
                        for (let i = 0; i < lines_before; i++) {
                            the_lines_before.push(`local filler_${i} = ${i}`);
                        }

                        const the_lines_after: string[] = [];
                        for (let i = 0; i < lines_after; i++) {
                            the_lines_after.push(`local trailing_${i} = ${i}`);
                        }

                        // Parent file uses filename WITHOUT .do suffix
                        const do_statement = `${command} ${filename}`;

                        const content = [
                            ...the_lines_before,
                            do_statement,
                            ...the_lines_after,
                        ].join('\n');

                        // Child filename HAS .do suffix
                        const result = parser.infer_call_site_for_file(
                            content,
                            `${filename}.do`
                        );

                        return result === lines_before;
                    }
                ),
                { numRuns: 200 }
            );
        });

        it('matches quoted path without suffix to child with suffix', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 0, max: 15 }),
                    arbitrary_filename,
                    arbitrary_command,
                    (lines_before, filename, command) => {
                        const the_lines_before: string[] = [];
                        for (let i = 0; i < lines_before; i++) {
                            the_lines_before.push(`display ${i}`);
                        }

                        // Quoted path without .do suffix
                        const do_statement = `${command} "${filename}"`;

                        const content = [
                            ...the_lines_before,
                            do_statement,
                        ].join('\n');

                        // Child filename has .do suffix
                        const result = parser.infer_call_site_for_file(
                            content,
                            `${filename}.do`
                        );

                        return result === lines_before;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('matches when both have .do suffix', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 0, max: 15 }),
                    arbitrary_filename,
                    arbitrary_command,
                    fc.boolean(), // quoted or unquoted
                    (lines_before, filename, command, quoted) => {
                        const the_lines_before: string[] = [];
                        for (let i = 0; i < lines_before; i++) {
                            the_lines_before.push(`local x_${i} = ${i}`);
                        }

                        // Both parent reference and child have .do suffix
                        const do_statement = quoted
                            ? `${command} "${filename}.do"`
                            : `${command} ${filename}.do`;

                        const content = [
                            ...the_lines_before,
                            do_statement,
                        ].join('\n');

                        const result = parser.infer_call_site_for_file(
                            content,
                            `${filename}.do`
                        );

                        return result === lines_before;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('matches when neither has .do suffix', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 0, max: 15 }),
                    arbitrary_filename,
                    arbitrary_command,
                    (lines_before, filename, command) => {
                        const the_lines_before: string[] = [];
                        for (let i = 0; i < lines_before; i++) {
                            the_lines_before.push(`local y_${i} = ${i}`);
                        }

                        // Parent reference without .do suffix
                        const do_statement = `${command} ${filename}`;

                        const content = [
                            ...the_lines_before,
                            do_statement,
                        ].join('\n');

                        // Child filename also without .do suffix
                        const result = parser.infer_call_site_for_file(
                            content,
                            filename
                        );

                        return result === lines_before;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('is case-insensitive for filename matching', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 0, max: 10 }),
                    arbitrary_filename,
                    arbitrary_command,
                    fc.boolean(), // uppercase in parent
                    fc.boolean(), // uppercase in child
                    (lines_before, filename, command, parent_upper, child_upper) => {
                        const the_lines_before: string[] = [];
                        for (let i = 0; i < lines_before; i++) {
                            the_lines_before.push(`local z_${i} = ${i}`);
                        }

                        // Apply case transformation
                        const parent_filename = parent_upper
                            ? filename.toUpperCase()
                            : filename.toLowerCase();
                        const child_filename = child_upper
                            ? filename.toUpperCase()
                            : filename.toLowerCase();

                        const do_statement = `${command} "${parent_filename}.do"`;

                        const content = [
                            ...the_lines_before,
                            do_statement,
                        ].join('\n');

                        const result = parser.infer_call_site_for_file(
                            content,
                            `${child_filename}.do`
                        );

                        return result === lines_before;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('handles mixed suffix scenarios with first match', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 0, max: 5 }),
                    arbitrary_filename,
                    (first_line, filename) => {
                        const the_lines: string[] = [];

                        for (let i = 0; i < first_line; i++) {
                            the_lines.push(`local pre_${i} = ${i}`);
                        }

                        // First: without suffix
                        the_lines.push(`do ${filename}`);
                        the_lines.push('local spacer1 = 1');

                        // Second: with suffix
                        the_lines.push(`do "${filename}.do"`);
                        the_lines.push('local spacer2 = 2');

                        // Third: quoted without suffix
                        the_lines.push(`include "${filename}"`);

                        const content = the_lines.join('\n');

                        const result = parser.infer_call_site_for_file(
                            content,
                            `${filename}.do`
                        );

                        // Should return first match (without suffix)
                        return result === first_line;
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Additional edge case tests
     */
    describe('Edge Cases', () => {
        it('handles leading whitespace in do statements', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 0, max: 10 }),
                    arbitrary_filename,
                    arbitrary_command,
                    fc.integer({ min: 1, max: 8 }), // number of leading spaces
                    (lines_before, filename, command, num_spaces) => {
                        const the_lines_before: string[] = [];
                        for (let i = 0; i < lines_before; i++) {
                            the_lines_before.push(`local w_${i} = ${i}`);
                        }

                        // Add leading whitespace
                        const leading_spaces = ' '.repeat(num_spaces);
                        const do_statement = `${leading_spaces}${command} "${filename}.do"`;

                        const content = [
                            ...the_lines_before,
                            do_statement,
                        ].join('\n');

                        const result = parser.infer_call_site_for_file(
                            content,
                            `${filename}.do`
                        );

                        return result === lines_before;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('handles paths with directories', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 0, max: 10 }),
                    arbitrary_filename,
                    arbitrary_command,
                    (lines_before, filename, command) => {
                        const the_lines_before: string[] = [];
                        for (let i = 0; i < lines_before; i++) {
                            the_lines_before.push(`local p_${i} = ${i}`);
                        }

                        // Path with directory
                        const do_statement = `${command} "subdir/${filename}.do"`;

                        const content = [
                            ...the_lines_before,
                            do_statement,
                        ].join('\n');

                        // Should match just the filename part
                        const result = parser.infer_call_site_for_file(
                            content,
                            `${filename}.do`
                        );

                        return result === lines_before;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('single line content returns 0', () => {
            fc.assert(
                fc.property(
                    arbitrary_filename,
                    arbitrary_command,
                    (filename, command) => {
                        const content = `${command} "${filename}.do"`;

                        const result = parser.infer_call_site_for_file(
                            content,
                            `${filename}.do`
                        );

                        return result === 0;
                    }
                ),
                { numRuns: 50 }
            );
        });

        it('empty content returns undefined', () => {
            fc.assert(
                fc.property(
                    arbitrary_filename,
                    (filename) => {
                        const result = parser.infer_call_site_for_file(
                            '',
                            `${filename}.do`
                        );

                        return result === undefined;
                    }
                ),
                { numRuns: 50 }
            );
        });
    });
});
