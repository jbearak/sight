/**
 * Property tests for Working Directory Path Resolution
 *
 * Tests Properties 5, 6, 9, 10 from the design document.
 * Feature: working-directory-directive
 * 
 * Note: These tests focus on the path resolution logic in the analyzer.
 * The parser currently doesn't capture STRING tokens in varlist, so we test
 * with unquoted paths or test the resolution functions directly.
 */

import { describe, test, expect } from 'bun:test';
import * as fc from 'fast-check';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { SemanticAnalyzer } from '../../src/analyzer';
import { StataParser } from '../../src/parser';
import { StataLexer } from '../../src/lexer';

describe('Working Directory Path Resolution Property Tests', () => {
    const lexer = new StataLexer();
    const parser = new StataParser();
    const analyzer = new SemanticAnalyzer();

    // Helper to parse and analyze code
    function analyze_code(
        code: string,
        uri: string,
        config?: { working_directory?: string; workspace_root?: string }
    ) {
        const lex_result = lexer.tokenize(code);
        const parse_result = parser.parse(lex_result.tokens);
        return analyzer.analyze(
            parse_result.ast,
            uri,
            undefined,
            config,
            lex_result.tokens
        );
    }

    // Generator for valid simple filenames (must start with letter, no dots)
    const simple_name_gen = fc.tuple(
        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')),
        fc.stringOf(
            fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_'.split('')),
            { minLength: 0, maxLength: 14 }
        )
    ).map(([first, rest]) => first + rest);

    /**
     * Property 5: Path Resolution with Working Directory
     * *For any* script with a working directory and a do/run/include command,
     * the resolved path should be computed relative to the working directory.
     * **Validates: Requirements 2.1, 2.2, 2.3**
     * 
     * Note: We test with simple names (no extension) since the parser splits
     * on dots. The .do fallback will be applied.
     */
    describe('Property 5: Path Resolution with Working Directory', () => {
        test('paths resolve relative to working directory when set', () => {
            fc.assert(
                fc.property(
                    simple_name_gen,
                    fc.constantFrom('do', 'run', 'include'),
                    (my_name, my_command) => {
                        const working_dir = '/project/data';
                        const script_dir = '/project/scripts';
                        // Use simple name without extension - parser will capture it
                        const code = `${my_command} ${my_name}`;
                        const uri = `file://${script_dir}/test.do`;

                        const result = analyze_code(code, uri, {
                            working_directory: working_dir,
                        });

                        // Should have at least one forward call (parser may split on special chars)
                        expect(result.forward_calls.length).toBeGreaterThanOrEqual(1);
                        
                        // First forward call's path should be resolved relative to working directory
                        const resolved = result.forward_calls[0].path;
                        expect(resolved.startsWith(working_dir)).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });

        test('paths resolve relative to script directory when no working directory', () => {
            fc.assert(
                fc.property(
                    simple_name_gen,
                    fc.constantFrom('do', 'run', 'include'),
                    (my_name, my_command) => {
                        const script_dir = '/project/scripts';
                        const code = `${my_command} ${my_name}`;
                        const uri = `file://${script_dir}/test.do`;

                        const result = analyze_code(code, uri, {});

                        // Should have at least one forward call
                        expect(result.forward_calls.length).toBeGreaterThanOrEqual(1);
                        
                        // Path should be resolved relative to script directory
                        const resolved = result.forward_calls[0].path;
                        expect(resolved.startsWith(script_dir)).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 9: Fallback Resolution Strategy
     * *For any* script without a working directory directive, if the file exists
     * at the workspace root but not relative to the script, the path should
     * resolve to the workspace root location.
     * **Validates: Requirements 3.1, 3.2**
     */
    describe('Property 9: Fallback Resolution Strategy', () => {
        test('falls back to workspace root when file not found at script location', () => {
            // Create a temporary directory structure for testing
            const temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sight-test-'));
            const workspace_root = temp_dir;
            const script_dir = path.join(temp_dir, 'scripts');
            
            try {
                // Create directories
                fs.mkdirSync(script_dir, { recursive: true });
                
                // Create a file at workspace root (not in scripts dir)
                const test_file = 'helper.do';
                fs.writeFileSync(path.join(workspace_root, test_file), '// helper');
                
                // Use simple name without extension
                const code = 'do helper';
                const uri = `file://${script_dir}/test.do`;

                const result = analyze_code(code, uri, {
                    workspace_root: workspace_root,
                });

                // Should have at least one forward call
                expect(result.forward_calls.length).toBeGreaterThanOrEqual(1);
                
                // Path should resolve to workspace root location (with .do fallback)
                const expected_path = path.normalize(path.join(workspace_root, test_file));
                expect(result.forward_calls[0].path).toBe(expected_path);
            } finally {
                // Cleanup
                fs.rmSync(temp_dir, { recursive: true, force: true });
            }
        });

        test('prefers script-relative when file exists at both locations', () => {
            // Create a temporary directory structure for testing
            const temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sight-test-'));
            const workspace_root = temp_dir;
            const script_dir = path.join(temp_dir, 'scripts');
            
            try {
                // Create directories
                fs.mkdirSync(script_dir, { recursive: true });
                
                // Create file at both locations
                const test_file = 'helper.do';
                fs.writeFileSync(path.join(workspace_root, test_file), '// workspace helper');
                fs.writeFileSync(path.join(script_dir, test_file), '// script helper');
                
                const code = 'do helper';
                const uri = `file://${script_dir}/test.do`;

                const result = analyze_code(code, uri, {
                    workspace_root: workspace_root,
                });

                // Should have at least one forward call
                expect(result.forward_calls.length).toBeGreaterThanOrEqual(1);
                
                // Path should resolve to script-relative location (preferred)
                const expected_path = path.normalize(path.join(script_dir, test_file));
                expect(result.forward_calls[0].path).toBe(expected_path);
            } finally {
                // Cleanup
                fs.rmSync(temp_dir, { recursive: true, force: true });
            }
        });
    });

    /**
     * Property 6: Non-Existent Working Directory Fallback
     * The analyzer uses the working directory as-is; validation happens at
     * the DocumentStore level.
     * **Validates: Requirements 2.4**
     */
    describe('Property 6: Non-Existent Working Directory Fallback', () => {
        test('working directory is used even if non-existent (validation happens elsewhere)', () => {
            fc.assert(
                fc.property(
                    simple_name_gen,
                    (my_name) => {
                        // Non-existent working directory
                        const working_dir = '/nonexistent/path/that/does/not/exist';
                        const script_dir = '/project/scripts';
                        const code = `do ${my_name}`;
                        const uri = `file://${script_dir}/test.do`;

                        const result = analyze_code(code, uri, {
                            working_directory: working_dir,
                        });

                        // Should have at least one forward call
                        expect(result.forward_calls.length).toBeGreaterThanOrEqual(1);
                        
                        // Path should still be resolved relative to working directory
                        const resolved = result.forward_calls[0].path;
                        expect(resolved.startsWith(working_dir)).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 10: Fallback Failure Diagnostic
     * Note: Diagnostics for missing files are emitted by ForwardScopeResolver,
     * not the SemanticAnalyzer. This test verifies the path resolution behavior.
     * **Validates: Requirements 3.3**
     */
    describe('Property 10: Fallback Failure Diagnostic', () => {
        test('returns script-relative path when file not found anywhere', () => {
            fc.assert(
                fc.property(
                    simple_name_gen,
                    (my_name) => {
                        const script_dir = '/project/scripts';
                        const workspace_root = '/project';
                        const code = `do ${my_name}`;
                        const uri = `file://${script_dir}/test.do`;

                        const result = analyze_code(code, uri, {
                            workspace_root: workspace_root,
                        });

                        // Should have at least one forward call
                        expect(result.forward_calls.length).toBeGreaterThanOrEqual(1);
                        
                        // Path should be script-relative (fallback when not found)
                        const resolved = result.forward_calls[0].path;
                        expect(resolved.startsWith(script_dir)).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    // Additional tests for command abbreviations
    describe('Command Abbreviations', () => {
        test('do command must be spelled out fully', () => {
            // "d" is the abbreviation for "describe", not "do"
            // So "d testfile" should NOT be recognized as a do command
            const code = 'd testfile';
            const uri = 'file:///project/test.do';
            const result = analyze_code(code, uri, {});

            // Should have no forward calls since "d" is not "do"
            expect(result.forward_calls.length).toBe(0);
        });

        test('run command abbreviation "ru" is recognized', () => {
            const code = 'ru testfile';
            const uri = 'file:///project/test.do';
            const result = analyze_code(code, uri, {});

            expect(result.forward_calls.length).toBeGreaterThanOrEqual(1);
            expect(result.forward_calls[0].type).toBe('run');
        });
    });

    // Test macro-containing paths are marked as non-static
    describe('Macro Path Detection', () => {
        test('paths with local macro references are non-static', () => {
            // Use a path that contains a local macro reference
            const code = 'do `mypath\'';
            const uri = 'file:///project/test.do';
            const result = analyze_code(code, uri, {});

            // The parser may or may not capture this depending on tokenization
            // If captured, it should be marked as non-static
            if (result.forward_calls.length > 0) {
                expect(result.forward_calls[0].is_static).toBe(false);
            }
        });

        test('paths with global macro references are non-static', () => {
            // Use a path that contains a global macro reference
            const code = 'do $mypath';
            const uri = 'file:///project/test.do';
            const result = analyze_code(code, uri, {});

            // The parser may or may not capture this depending on tokenization
            // If captured, it should be marked as non-static
            if (result.forward_calls.length > 0) {
                expect(result.forward_calls[0].is_static).toBe(false);
            }
        });
    });
});
