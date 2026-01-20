/**
 * Property tests for LSP Working Directory Option - Content Transformation
 *
 * Feature: lsp-working-directory-option
 * Property 2: Content Transformation Correctness
 * Property 3: Backward Compatibility
 *
 * Tests the pure content transformation logic without VS Code dependencies.
 */

import { describe, test, expect } from 'bun:test';
import * as fc from 'fast-check';
import * as path from 'path';

// Pure function that mirrors the content transformation logic
function transform_content_with_cd(
    content: string,
    working_directory: 'none' | 'file' | 'workspace' | 'lsp',
    lsp_directory: string | null,
    file_directory: string,
    workspace_directory: string | null
): string {
    if (working_directory === 'none') {
        return content;
    }
    
    let directory: string | null = null;
    
    if (working_directory === 'lsp') {
        directory = lsp_directory;
        if (directory === null) {
            return content;  // Fall back to 'none' behavior
        }
    } else if (working_directory === 'file') {
        directory = file_directory;
    } else {
        directory = workspace_directory ?? file_directory;
    }
    
    const escaped_dir = directory.replace(/"/g, '\\"');
    return `cd "${escaped_dir}"\n${content}`;
}

describe('LSP Working Directory Option - Content Transformation', () => {
    
    // Generator for code content
    const code_content_gen = fc.string({ minLength: 0, maxLength: 500 });
    
    // Generator for directory paths (valid paths without newlines)
    const directory_path_gen = fc.string({ minLength: 1, maxLength: 100 })
        .filter(s => !s.includes('\n') && !s.includes('\r'))
        .map(s => `/test/path/${s.replace(/[^a-zA-Z0-9_/-]/g, '_')}`);

    /**
     * Property 2: Content Transformation Correctness
     * For any code content and LSP working directory response:
     * - If the response contains a valid working directory path, the
     *   transformed content SHALL have a `cd "path"` command prepended
     * - If the response is null, the content SHALL remain unchanged
     *
     * Validates: Requirements 3.2, 3.3
     */
    describe('Property 2: Content Transformation Correctness', () => {
        
        test('prepends cd command when LSP returns valid directory', () => {
            fc.assert(
                fc.property(
                    code_content_gen,
                    directory_path_gen,
                    (content, lsp_dir) => {
                        const result = transform_content_with_cd(
                            content,
                            'lsp',
                            lsp_dir,
                            '/file/dir',
                            '/workspace/dir'
                        );
                        
                        // Should have cd command prepended
                        expect(result.startsWith('cd "')).toBe(true);
                        expect(result).toContain(lsp_dir);
                        expect(result.endsWith(`\n${content}`)).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });

        test('returns unchanged content when LSP returns null', () => {
            fc.assert(
                fc.property(
                    code_content_gen,
                    (content) => {
                        const result = transform_content_with_cd(
                            content,
                            'lsp',
                            null,  // LSP returns null
                            '/file/dir',
                            '/workspace/dir'
                        );
                        
                        // Content should be unchanged
                        expect(result).toBe(content);
                    }
                ),
                { numRuns: 100 }
            );
        });

        test('escapes quotes in LSP directory path', () => {
            fc.assert(
                fc.property(
                    code_content_gen,
                    fc.string({ minLength: 1, maxLength: 50 })
                        .filter(s => !s.includes('\n') && !s.includes('\r')),
                    (content, path_part) => {
                        const lsp_dir = `/test/"quoted"/${path_part}`;
                        const result = transform_content_with_cd(
                            content,
                            'lsp',
                            lsp_dir,
                            '/file/dir',
                            '/workspace/dir'
                        );
                        
                        // Quotes should be escaped
                        expect(result).toContain('\\"quoted\\"');
                        expect(result.startsWith('cd "')).toBe(true);
                    }
                ),
                { numRuns: 50 }
            );
        });
    });

    /**
     * Property 3: Backward Compatibility
     * For any existing working directory option value ("none", "file",
     * "workspace"), the content transformation behavior SHALL match the
     * original implementation.
     *
     * Validates: Requirements 1.4
     */
    describe('Property 3: Backward Compatibility', () => {
        
        test('"none" option returns content unchanged', () => {
            fc.assert(
                fc.property(
                    code_content_gen,
                    directory_path_gen,
                    directory_path_gen,
                    (content, file_dir, workspace_dir) => {
                        const result = transform_content_with_cd(
                            content,
                            'none',
                            '/lsp/dir',  // Should be ignored
                            file_dir,
                            workspace_dir
                        );
                        
                        // Content should be unchanged
                        expect(result).toBe(content);
                    }
                ),
                { numRuns: 100 }
            );
        });

        test('"file" option prepends cd to file directory', () => {
            fc.assert(
                fc.property(
                    code_content_gen,
                    directory_path_gen,
                    directory_path_gen,
                    (content, file_dir, workspace_dir) => {
                        const result = transform_content_with_cd(
                            content,
                            'file',
                            '/lsp/dir',  // Should be ignored
                            file_dir,
                            workspace_dir
                        );
                        
                        // Should have cd command with file directory
                        expect(result.startsWith('cd "')).toBe(true);
                        expect(result).toContain(file_dir);
                        expect(result.endsWith(`\n${content}`)).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });

        test('"workspace" option prepends cd to workspace directory', () => {
            fc.assert(
                fc.property(
                    code_content_gen,
                    directory_path_gen,
                    directory_path_gen,
                    (content, file_dir, workspace_dir) => {
                        const result = transform_content_with_cd(
                            content,
                            'workspace',
                            '/lsp/dir',  // Should be ignored
                            file_dir,
                            workspace_dir
                        );
                        
                        // Should have cd command with workspace directory
                        expect(result.startsWith('cd "')).toBe(true);
                        expect(result).toContain(workspace_dir);
                        expect(result.endsWith(`\n${content}`)).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });

        test('"workspace" falls back to file directory when no workspace', () => {
            fc.assert(
                fc.property(
                    code_content_gen,
                    directory_path_gen,
                    (content, file_dir) => {
                        const result = transform_content_with_cd(
                            content,
                            'workspace',
                            '/lsp/dir',
                            file_dir,
                            null  // No workspace
                        );
                        
                        // Should fall back to file directory
                        expect(result.startsWith('cd "')).toBe(true);
                        expect(result).toContain(file_dir);
                        expect(result.endsWith(`\n${content}`)).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });
});
