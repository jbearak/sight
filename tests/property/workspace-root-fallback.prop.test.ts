/**
 * Property tests for Workspace Root Fallback Behavior
 *
 * Tests the analyzer's workspace root fallback resolution for forward calls.
 */

import { describe, test, expect } from 'bun:test';
import * as fc from 'fast-check';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { SemanticAnalyzer } from '../../src/analyzer';
import { StataParser } from '../../src/parser';
import { StataLexer } from '../../src/lexer';

describe('Workspace Root Fallback Property Tests', () => {
    const lexer = new StataLexer();
    const parser = new StataParser();
    const analyzer = new SemanticAnalyzer();

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

    const simple_name_gen = fc.tuple(
        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')),
        fc.stringOf(
            fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_'.split('')),
            { minLength: 0, maxLength: 14 }
        )
    ).map(([first, rest]) => first + rest);

    /**
     * Property 1: Workspace Root Fallback Resolution
     * When a forward call path does not exist relative to the script directory
     * but does exist relative to the workspace root, the analyzer resolves to
     * the workspace-root-relative path.
     */
    describe('Property 1: Workspace Root Fallback Resolution', () => {
        test('resolves to workspace root when file only exists there', () => {
            fc.assert(
                fc.property(
                    simple_name_gen,
                    fc.constantFrom('do', 'run', 'include'),
                    (file_name, command) => {
                        const temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sight-test-'));
                        const workspace_root = temp_dir;
                        const script_dir = path.join(temp_dir, 'scripts');
                        
                        try {
                            fs.mkdirSync(script_dir, { recursive: true });
                            
                            // Create file only at workspace root
                            const test_file = `${file_name}.do`;
                            fs.writeFileSync(path.join(workspace_root, test_file), '// content');
                            
                            const code = `${command} ${file_name}`;
                            const uri = `file://${script_dir}/test.do`;

                            const result = analyze_code(code, uri, {
                                workspace_root: workspace_root,
                            });

                            expect(result.forward_calls.length).toBeGreaterThanOrEqual(1);
                            
                            const expected_path = path.normalize(path.join(workspace_root, test_file));
                            expect(result.forward_calls[0].path).toBe(expected_path);
                        } finally {
                            fs.rmSync(temp_dir, { recursive: true, force: true });
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 2: Script-Relative Precedence
     * When a forward call path exists relative to the script directory,
     * the analyzer uses the script-relative path (no fallback).
     */
    describe('Property 2: Script-Relative Precedence', () => {
        test('prefers script-relative path when it exists', () => {
            fc.assert(
                fc.property(
                    simple_name_gen,
                    fc.constantFrom('do', 'run', 'include'),
                    (file_name, command) => {
                        const temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sight-test-'));
                        const workspace_root = temp_dir;
                        const script_dir = path.join(temp_dir, 'scripts');
                        
                        try {
                            fs.mkdirSync(script_dir, { recursive: true });
                            
                            // Create file at both locations
                            const test_file = `${file_name}.do`;
                            fs.writeFileSync(path.join(workspace_root, test_file), '// workspace');
                            fs.writeFileSync(path.join(script_dir, test_file), '// script');
                            
                            const code = `${command} ${file_name}`;
                            const uri = `file://${script_dir}/test.do`;

                            const result = analyze_code(code, uri, {
                                workspace_root: workspace_root,
                            });

                            expect(result.forward_calls.length).toBeGreaterThanOrEqual(1);
                            
                            const expected_path = path.normalize(path.join(script_dir, test_file));
                            expect(result.forward_calls[0].path).toBe(expected_path);
                        } finally {
                            fs.rmSync(temp_dir, { recursive: true, force: true });
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 3: Missing File Handling
     * When a forward call path does not exist at either location,
     * the analyzer returns the script-relative path (without .do extension
     * since the file doesn't exist to trigger the fallback).
     */
    describe('Property 3: Missing File Handling', () => {
        test('returns script-relative path when file exists nowhere', () => {
            fc.assert(
                fc.property(
                    simple_name_gen,
                    fc.constantFrom('do', 'run', 'include'),
                    (file_name, command) => {
                        const temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sight-test-'));
                        const workspace_root = temp_dir;
                        const script_dir = path.join(temp_dir, 'scripts');
                        
                        try {
                            fs.mkdirSync(script_dir, { recursive: true });
                            
                            // Don't create the file anywhere
                            const code = `${command} ${file_name}`;
                            const uri = `file://${script_dir}/test.do`;

                            const result = analyze_code(code, uri, {
                                workspace_root: workspace_root,
                            });

                            expect(result.forward_calls.length).toBeGreaterThanOrEqual(1);
                            
                            // Path is script-relative (no .do added since file doesn't exist)
                            const expected_path = path.normalize(path.join(script_dir, file_name));
                            expect(result.forward_calls[0].path).toBe(expected_path);
                        } finally {
                            fs.rmSync(temp_dir, { recursive: true, force: true });
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 4: Working Directory Precedence
     * When @lsp-working-directory is set, the analyzer does NOT use
     * workspace root fallback - it resolves relative to working directory.
     */
    describe('Property 4: Working Directory Precedence', () => {
        test('no workspace root fallback when working directory is set', () => {
            fc.assert(
                fc.property(
                    simple_name_gen,
                    fc.constantFrom('do', 'run', 'include'),
                    (file_name, command) => {
                        const temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sight-test-'));
                        const workspace_root = temp_dir;
                        const script_dir = path.join(temp_dir, 'scripts');
                        const working_dir = path.join(temp_dir, 'data');
                        
                        try {
                            fs.mkdirSync(script_dir, { recursive: true });
                            fs.mkdirSync(working_dir, { recursive: true });
                            
                            // Create file only at workspace root
                            const test_file = `${file_name}.do`;
                            fs.writeFileSync(path.join(workspace_root, test_file), '// workspace');
                            
                            const code = `${command} ${file_name}`;
                            const uri = `file://${script_dir}/test.do`;

                            const result = analyze_code(code, uri, {
                                workspace_root: workspace_root,
                                working_directory: working_dir,
                            });

                            expect(result.forward_calls.length).toBeGreaterThanOrEqual(1);
                            
                            // Should resolve relative to working directory, not workspace root
                            // No .do extension since file doesn't exist at working_dir
                            const expected_path = path.normalize(path.join(working_dir, file_name));
                            expect(result.forward_calls[0].path).toBe(expected_path);
                        } finally {
                            fs.rmSync(temp_dir, { recursive: true, force: true });
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });
    });
});