/**
 * Property tests for Directive Presence Detection
 *
 * Tests Property 1 from the cross-file-awareness-fixes design document:
 * "For any Stata file content, the has_directives field in ResolvedScope
 * should be true if and only if the file contains @lsp-done-by or
 * @lsp-included-by directive comments in its header, regardless of whether
 * the target files exist or can be resolved."
 *
 * **Feature: cross-file-awareness-fixes, Property 1: Directive Presence Detection Accuracy**
 * **Validates: Requirements 1.1, 1.2, 1.3**
 */

import { describe, test, expect } from 'bun:test';
import * as fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ScopeResolver } from '../../src/scope-resolver';
import { URI } from 'vscode-uri';

describe('Directive Presence Detection Property Tests', () => {
    // Helper to create a temp directory and return cleanup function
    const create_temp_env = () => {
        const temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'directive-presence-test-'));
        const write_file = (name: string, content: string): string => {
            const file_path = path.join(temp_dir, name);
            fs.writeFileSync(file_path, content);
            return file_path;
        };
        const cleanup = () => {
            fs.rmSync(temp_dir, { recursive: true, force: true });
        };
        return { temp_dir, write_file, cleanup };
    };

    /**
     * Property 1: Directive Presence Detection Accuracy
     *
     * For any Stata file content, has_directives should be true if and only if
     * the file contains valid @lsp-done-by or @lsp-included-by directive comments
     * in its header, regardless of whether target files exist.
     */
    describe('Property 1: Directive Presence Detection Accuracy', () => {
        test('has_directives is true when file has valid directives (target exists)', () => {
            fc.assert(
                fc.asyncProperty(
                    fc.record({
                        directive_type: fc.constantFrom('done-by', 'included-by'),
                        comment_style: fc.constantFrom('*', '//'),
                        code_line: fc.constantFrom(
                            'local x = 1',
                            'gen y = 2',
                            'display "hello"'
                        ),
                    }),
                    async ({ directive_type, comment_style, code_line }) => {
                        const { write_file, cleanup } = create_temp_env();
                        const resolver = new ScopeResolver();
                        try {
                            // Create parent file that exists
                            write_file('parent.do', 'local parent_var = 1');

                            // Create child with directive pointing to existing file
                            const child_content = `${comment_style} @lsp-${directive_type} "parent.do"\n${code_line}`;
                            const child_path = write_file('child.do', child_content);

                            const result = await resolver.resolve(
                                URI.file(child_path).toString(),
                                child_content
                            );

                            expect(result.has_directives).toBe(true);
                        } finally {
                            cleanup();
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });

        test('has_directives is true when file has directives but target is missing', () => {
            fc.assert(
                fc.asyncProperty(
                    fc.record({
                        directive_type: fc.constantFrom('done-by', 'included-by'),
                        comment_style: fc.constantFrom('*', '//'),
                        missing_file: fc.stringOf(
                            fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')),
                            { minLength: 1, maxLength: 10 }
                        ).map(s => s + '.do'),
                        code_line: fc.constantFrom(
                            'local x = 1',
                            'gen y = 2',
                            'display "hello"'
                        ),
                    }),
                    async ({ directive_type, comment_style, missing_file, code_line }) => {
                        const { write_file, cleanup } = create_temp_env();
                        const resolver = new ScopeResolver();
                        try {
                            // Create child with directive pointing to non-existent file
                            const child_content = `${comment_style} @lsp-${directive_type} "${missing_file}"\n${code_line}`;
                            const child_path = write_file('child.do', child_content);

                            const result = await resolver.resolve(
                                URI.file(child_path).toString(),
                                child_content
                            );

                            // has_directives should be true even though target doesn't exist
                            expect(result.has_directives).toBe(true);
                        } finally {
                            cleanup();
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });

        test('has_directives is false when file has no directives', () => {
            fc.assert(
                fc.asyncProperty(
                    fc.record({
                        num_comment_lines: fc.integer({ min: 0, max: 5 }),
                        code_lines: fc.array(
                            fc.constantFrom(
                                'local x = 1',
                                'gen y = 2',
                                'display "hello"',
                                'regress y x',
                                'summarize x'
                            ),
                            { minLength: 1, maxLength: 5 }
                        ),
                    }),
                    async ({ num_comment_lines, code_lines }) => {
                        const { write_file, cleanup } = create_temp_env();
                        const resolver = new ScopeResolver();
                        try {
                            // Create file with regular comments (no directives)
                            const comments = Array(num_comment_lines)
                                .fill(0)
                                .map((_, i) => `// Regular comment ${i}`)
                                .join('\n');
                            const code = code_lines.join('\n');
                            const content = comments + (comments ? '\n' : '') + code;
                            const file_path = write_file('no_directives.do', content);

                            const result = await resolver.resolve(
                                URI.file(file_path).toString(),
                                content
                            );

                            expect(result.has_directives).toBe(false);
                        } finally {
                            cleanup();
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });

        test('has_directives is false for empty files', async () => {
            const { write_file, cleanup } = create_temp_env();
            const resolver = new ScopeResolver();
            try {
                const content = '';
                const file_path = write_file('empty.do', content);

                const result = await resolver.resolve(
                    URI.file(file_path).toString(),
                    content
                );

                expect(result.has_directives).toBe(false);
            } finally {
                cleanup();
            }
        });

        test('has_directives is false for files with only code (no header)', () => {
            fc.assert(
                fc.asyncProperty(
                    fc.array(
                        fc.constantFrom(
                            'local x = 1',
                            'gen y = 2',
                            'display "hello"',
                            'regress y x'
                        ),
                        { minLength: 1, maxLength: 5 }
                    ),
                    async (code_lines) => {
                        const { write_file, cleanup } = create_temp_env();
                        const resolver = new ScopeResolver();
                        try {
                            const content = code_lines.join('\n');
                            const file_path = write_file('code_only.do', content);

                            const result = await resolver.resolve(
                                URI.file(file_path).toString(),
                                content
                            );

                            expect(result.has_directives).toBe(false);
                        } finally {
                            cleanup();
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });

        test('has_directives reflects directive presence, not chain resolution', async () => {
            const { write_file, cleanup } = create_temp_env();
            const resolver = new ScopeResolver();
            try {
                // Create a file with a directive to a non-existent file
                const child_content = `// @lsp-done-by "nonexistent_parent.do"\nlocal x = 1`;
                const child_path = write_file('child_missing_parent.do', child_content);

                const result = await resolver.resolve(
                    URI.file(child_path).toString(),
                    child_content
                );

                // Chain should only have the current file (parent couldn't be resolved)
                expect(result.chain.length).toBe(1);

                // But has_directives should still be true because directive was declared
                expect(result.has_directives).toBe(true);

                // There should be a diagnostic about the missing file
                expect(result.diagnostics.some(d => d.message.includes('Cannot read file'))).toBe(true);
            } finally {
                cleanup();
            }
        });

        test('has_directives is true with multiple directives (some missing)', async () => {
            const { write_file, cleanup } = create_temp_env();
            const resolver = new ScopeResolver();
            try {
                // Create one existing parent
                write_file('existing_parent.do', 'local parent_var = 1');

                // Create child with two directives: one to existing, one to missing
                const child_content = `// @lsp-done-by "existing_parent.do"
// @lsp-included-by "missing_parent.do"
local x = 1`;
                const child_path = write_file('child_mixed.do', child_content);

                const result = await resolver.resolve(
                    URI.file(child_path).toString(),
                    child_content
                );

                // has_directives should be true (directives were declared)
                expect(result.has_directives).toBe(true);
            } finally {
                cleanup();
            }
        });
    });
});
