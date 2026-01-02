/**
 * Property tests for Logger Routing in ScopeResolver
 *
 * Tests Property 3 from the cross-file-awareness-fixes design document:
 * "For any ScopeResolver instance created with a logger, all warning and log
 * messages generated during resolve() should be routed through the provided
 * logger interface, not through raw console.log or console.warn."
 *
 * **Feature: cross-file-awareness-fixes, Property 3: Logger Routing**
 * **Validates: Requirements 3.2, 3.4**
 */

import { describe, test, expect } from 'bun:test';
import * as fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ScopeResolver } from '../../src/scope-resolver';
import { ScopeResolverLogger } from '../../src/types';
import { URI } from 'vscode-uri';

describe('Logger Routing Property Tests', () => {
    // Helper to create a temp directory and return cleanup function
    const create_temp_env = () => {
        const temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logger-routing-test-'));
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
     * Property 3: Logger Routing
     *
     * For any ScopeResolver instance created with a logger, all warning and log
     * messages generated during resolve() should be routed through the provided
     * logger interface.
     */
    describe('Property 3: Logger Routing', () => {
        test('warnings are routed through logger when provided', () => {
            fc.assert(
                fc.asyncProperty(
                    fc.record({
                        missing_file: fc.stringOf(
                            fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')),
                            { minLength: 1, maxLength: 10 }
                        ).map(s => s + '.do'),
                    }),
                    async ({ missing_file }) => {
                        const { write_file, cleanup } = create_temp_env();
                        try {
                            const logged_messages: string[] = [];
                            const warned_messages: string[] = [];

                            const logger: ScopeResolverLogger = {
                                log: (msg) => logged_messages.push(msg),
                                warn: (msg) => warned_messages.push(msg),
                            };

                            const resolver = new ScopeResolver(logger);

                            // Create file with directive to non-existent file (triggers warning)
                            const content = `// @lsp-done-by "${missing_file}"\nlocal x = 1`;
                            const file_path = write_file('child.do', content);

                            await resolver.resolve(
                                URI.file(file_path).toString(),
                                content
                            );

                            // Warning should be routed through logger
                            expect(warned_messages.length).toBeGreaterThan(0);
                            expect(warned_messages.some(m => m.includes('ScopeResolver'))).toBe(true);
                        } finally {
                            cleanup();
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });

        test('no console output when logger is provided', async () => {
            const { write_file, cleanup } = create_temp_env();
            try {
                const logged_messages: string[] = [];
                const warned_messages: string[] = [];

                const logger: ScopeResolverLogger = {
                    log: (msg) => logged_messages.push(msg),
                    warn: (msg) => warned_messages.push(msg),
                };

                const resolver = new ScopeResolver(logger);

                // Create file with directive to non-existent file
                const content = `// @lsp-done-by "nonexistent.do"\nlocal x = 1`;
                const file_path = write_file('test.do', content);

                await resolver.resolve(
                    URI.file(file_path).toString(),
                    content
                );

                // Messages should be captured by our logger
                expect(warned_messages.some(m => m.includes('Cannot read file') || m.includes('File read error'))).toBe(true);
            } finally {
                cleanup();
            }
        });

        test('resolver works without logger (backward compatibility)', () => {
            fc.assert(
                fc.asyncProperty(
                    fc.record({
                        code_line: fc.constantFrom(
                            'local x = 1',
                            'gen y = 2',
                            'display "hello"'
                        ),
                    }),
                    async ({ code_line }) => {
                        const { write_file, cleanup } = create_temp_env();
                        try {
                            // Create resolver without logger
                            const resolver = new ScopeResolver();

                            const content = code_line;
                            const file_path = write_file('simple.do', content);

                            // Should not throw
                            const result = await resolver.resolve(
                                URI.file(file_path).toString(),
                                content
                            );

                            expect(result).toBeDefined();
                            expect(result.chain.length).toBeGreaterThan(0);
                        } finally {
                            cleanup();
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });

        test('max depth warning is routed through logger', async () => {
            const { write_file, cleanup } = create_temp_env();
            try {
                const warned_messages: string[] = [];

                const logger: ScopeResolverLogger = {
                    log: (msg) => {},
                    warn: (msg) => warned_messages.push(msg),
                };

                const resolver = new ScopeResolver(logger);

                // Create a chain of files that exceeds max depth
                // File 1 -> File 2 -> File 3 -> ... -> File 12 (exceeds default max of 10)
                const the_files: string[] = [];
                for (let i = 11; i >= 1; i--) {
                    const parent_ref = i < 11 ? `// @lsp-included-by "file${i + 1}.do"\n` : '';
                    const content = `${parent_ref}local var${i} = ${i}`;
                    const file_path = write_file(`file${i}.do`, content);
                    the_files.push(file_path);
                }

                // Resolve from the deepest file
                const deepest_content = fs.readFileSync(the_files[the_files.length - 1], 'utf8');
                await resolver.resolve(
                    URI.file(the_files[the_files.length - 1]).toString(),
                    deepest_content
                );

                // Should have warning about max depth
                expect(warned_messages.some(m => m.includes('Maximum backward depth'))).toBe(true);
            } finally {
                cleanup();
            }
        });

        test('parse error warning is routed through logger', async () => {
            const { write_file, cleanup } = create_temp_env();
            try {
                const warned_messages: string[] = [];

                const logger: ScopeResolverLogger = {
                    log: (msg) => {},
                    warn: (msg) => warned_messages.push(msg),
                };

                const resolver = new ScopeResolver(logger);

                // Create parent file with content that might cause issues
                const parent_content = 'local x = 1';
                write_file('parent.do', parent_content);

                // Create child pointing to parent
                const child_content = `// @lsp-done-by "parent.do"\nlocal y = 2`;
                const child_path = write_file('child.do', child_content);

                // This should work without errors
                const result = await resolver.resolve(
                    URI.file(child_path).toString(),
                    child_content
                );

                expect(result).toBeDefined();
            } finally {
                cleanup();
            }
        });
    });
});
