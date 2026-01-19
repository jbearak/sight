/**
 * Property tests for LSP Working Directory Option - Server Response Correctness
 *
 * Feature: lsp-working-directory-option
 * Property 1: Server Response Correctness
 *
 * Tests that the sight/getWorkingDirectory custom request returns the correct
 * working directory based on document state.
 */

import { describe, test, expect } from 'bun:test';
import * as fc from 'fast-check';
import { DocumentStore } from '../../src/document-store';
import { create_get_working_directory_handler, HandlerDependencies, GetWorkingDirectoryParams } from '../../src/server-handlers';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('LSP Working Directory Option - Server Response Correctness', () => {
    
    // Generator for valid URIs
    const uri_gen = fc.string({ minLength: 1, maxLength: 50 })
        .map(s => `file:///test/${s.replace(/[^a-zA-Z0-9_-]/g, '_')}.do`);

    // Generator for document content without working directory directive
    const content_without_wd_gen = fc.string({ maxLength: 200 })
        .filter(s => !s.includes('@lsp-cd') && !s.includes('@lsp-working-directory') && !s.includes('@lsp-wd'));

    /**
     * Property 1: Server Response Correctness
     * For any document URI, the sight/getWorkingDirectory request should return:
     * - The resolved working directory if the document has a working directory directive
     * - The inherited working directory if the document has backward directives and a parent has a working directory
     * - null if no working directory is set or inherited
     */
    describe('Property 1: Server Response Correctness', () => {
        
        test('returns resolved working directory when document has @lsp-cd directive with existing path', async () => {
            await fc.assert(
                fc.asyncProperty(
                    uri_gen,
                    async (uri) => {
                        // Use a workspace-relative path that exists (tmp directory under workspace root)
                        const workspace_root = os.tmpdir();
                        const workspace_relative_path = '/tmp'; // This will resolve to workspace_root + 'tmp'
                        
                        // Create the directory to ensure it exists
                        const target_dir = path.join(workspace_root, 'tmp');
                        if (!fs.existsSync(target_dir)) {
                            fs.mkdirSync(target_dir, { recursive: true });
                        }
                        
                        // Setup document store with workspace root
                        const document_store = new DocumentStore();
                        document_store.set_workspace_root(workspace_root);
                        
                        // Create mock dependencies
                        const deps: HandlerDependencies = {
                            document_store,
                            diagnostics_provider: null,
                            completion_provider: null,
                            hover_provider: null,
                            definition_provider: null,
                            references_provider: null,
                            symbol_provider: null,
                            formatter_provider: null,
                            workspace_indexer: null,
                            scope_resolver: null,
                            forward_scope_resolver: null,
                            rename_handler: null,
                            get_document_settings: async () => ({} as any),
                            connection: {
                                sendDiagnostics: () => {},
                                console: { log: () => {} }
                            }
                        };

                        // Open document with working directory directive using workspace-relative path
                        const content_with_directive = `// @lsp-cd: "${workspace_relative_path}"\ngen x = 1`;
                        await document_store.open(uri, content_with_directive, 1);

                        // Create handler and test
                        const handler = create_get_working_directory_handler(deps);
                        const params: GetWorkingDirectoryParams = { uri };
                        const result = await handler(params);

                        // Should return the resolved working directory
                        expect(result.workingDirectory).toBe(target_dir);
                    }
                ),
                { numRuns: 20 }
            );
        });

        test('returns null when document has @lsp-cd directive with non-existent path', async () => {
            await fc.assert(
                fc.asyncProperty(
                    uri_gen,
                    async (uri) => {
                        // Use a path that doesn't exist
                        const non_existent_path = '/this/path/does/not/exist/12345';
                        
                        // Setup document store
                        const document_store = new DocumentStore();
                        
                        // Create mock dependencies
                        const deps: HandlerDependencies = {
                            document_store,
                            diagnostics_provider: null,
                            completion_provider: null,
                            hover_provider: null,
                            definition_provider: null,
                            references_provider: null,
                            symbol_provider: null,
                            formatter_provider: null,
                            workspace_indexer: null,
                            scope_resolver: null,
                            forward_scope_resolver: null,
                            rename_handler: null,
                            get_document_settings: async () => ({} as any),
                            connection: {
                                sendDiagnostics: () => {},
                                console: { log: () => {} }
                            }
                        };

                        // Open document with working directory directive using non-existent path
                        const content_with_directive = `// @lsp-cd: "${non_existent_path}"\ngen x = 1`;
                        await document_store.open(uri, content_with_directive, 1);

                        // Create handler and test
                        const handler = create_get_working_directory_handler(deps);
                        const params: GetWorkingDirectoryParams = { uri };
                        const result = await handler(params);

                        // Should return null for non-existent path
                        expect(result.workingDirectory).toBeNull();
                    }
                ),
                { numRuns: 20 }
            );
        });

        test('returns null when document has no working directory directive', async () => {
            await fc.assert(
                fc.asyncProperty(
                    uri_gen,
                    content_without_wd_gen,
                    async (uri, content) => {
                        // Setup document store
                        const document_store = new DocumentStore();
                        
                        // Create mock dependencies
                        const deps: HandlerDependencies = {
                            document_store,
                            diagnostics_provider: null,
                            completion_provider: null,
                            hover_provider: null,
                            definition_provider: null,
                            references_provider: null,
                            symbol_provider: null,
                            formatter_provider: null,
                            workspace_indexer: null,
                            scope_resolver: null,
                            forward_scope_resolver: null,
                            rename_handler: null,
                            get_document_settings: async () => ({} as any),
                            connection: {
                                sendDiagnostics: () => {},
                                console: { log: () => {} }
                            }
                        };

                        // Open document without working directory directive
                        await document_store.open(uri, content, 1);

                        // Create handler and test
                        const handler = create_get_working_directory_handler(deps);
                        const params: GetWorkingDirectoryParams = { uri };
                        const result = await handler(params);

                        // Should return null
                        expect(result.workingDirectory).toBeNull();
                    }
                ),
                { numRuns: 50 }
            );
        });

        test('returns null when document does not exist', async () => {
            await fc.assert(
                fc.asyncProperty(
                    uri_gen,
                    async (uri) => {
                        // Setup empty document store
                        const document_store = new DocumentStore();
                        
                        // Create mock dependencies
                        const deps: HandlerDependencies = {
                            document_store,
                            diagnostics_provider: null,
                            completion_provider: null,
                            hover_provider: null,
                            definition_provider: null,
                            references_provider: null,
                            symbol_provider: null,
                            formatter_provider: null,
                            workspace_indexer: null,
                            scope_resolver: null,
                            forward_scope_resolver: null,
                            rename_handler: null,
                            get_document_settings: async () => ({} as any),
                            connection: {
                                sendDiagnostics: () => {},
                                console: { log: () => {} }
                            }
                        };

                        // Create handler and test with non-existent document
                        const handler = create_get_working_directory_handler(deps);
                        const params: GetWorkingDirectoryParams = { uri };
                        const result = await handler(params);

                        // Should return null for non-existent document
                        expect(result.workingDirectory).toBeNull();
                    }
                ),
                { numRuns: 30 }
            );
        });

        test('waits for pending document updates before returning result', async () => {
            await fc.assert(
                fc.asyncProperty(
                    uri_gen,
                    async (uri) => {
                        // Use workspace-relative path that exists
                        const workspace_root = os.tmpdir();
                        const workspace_relative_path = '/tmp';
                        
                        // Create the directory to ensure it exists
                        const target_dir = path.join(workspace_root, 'tmp');
                        if (!fs.existsSync(target_dir)) {
                            fs.mkdirSync(target_dir, { recursive: true });
                        }
                        
                        // Setup document store
                        const document_store = new DocumentStore();
                        document_store.set_workspace_root(workspace_root);
                        
                        // Create mock dependencies
                        const deps: HandlerDependencies = {
                            document_store,
                            diagnostics_provider: null,
                            completion_provider: null,
                            hover_provider: null,
                            definition_provider: null,
                            references_provider: null,
                            symbol_provider: null,
                            formatter_provider: null,
                            workspace_indexer: null,
                            scope_resolver: null,
                            forward_scope_resolver: null,
                            rename_handler: null,
                            get_document_settings: async () => ({} as any),
                            connection: {
                                sendDiagnostics: () => {},
                                console: { log: () => {} }
                            }
                        };

                        // Open document initially without working directory
                        await document_store.open(uri, 'gen x = 1', 1);

                        // Create handler
                        const handler = create_get_working_directory_handler(deps);
                        
                        // Start an update that adds working directory directive
                        const update_promise = document_store.update(uri, [{
                            text: `// @lsp-cd: "${workspace_relative_path}"\ngen x = 1`
                        }], 2);

                        // Call handler while update is in progress
                        const params: GetWorkingDirectoryParams = { uri };
                        const result_promise = handler(params);

                        // Wait for both to complete
                        await Promise.all([update_promise, result_promise]);
                        const result = await result_promise;

                        // Should return the updated working directory
                        expect(result.workingDirectory).toBe(target_dir);
                    }
                ),
                { numRuns: 20 }
            );
        });
    });
});