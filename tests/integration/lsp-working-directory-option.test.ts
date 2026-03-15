/**
 * Integration tests for LSP Working Directory Option
 *
 * Feature: lsp-working-directory-option
 * Tests end-to-end LSP request handling and inheritance chain behavior.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DocumentStore } from '../../src/document-store';
import { ScopeResolver } from '../../src/scope-resolver';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';
import {
    create_get_working_directory_handler,
    HandlerDependencies,
    GetWorkingDirectoryParams,
} from '../../src/server-handlers';

/**
 * Creates mock dependencies for testing handlers.
 */
function create_mock_dependencies(document_store: DocumentStore): HandlerDependencies {
    return {
        debounce_manager: null,
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
        dependency_graph: null,
        rename_handler: null,
        get_document_settings: async () => ({} as any),
        connection: {
            sendDiagnostics: () => {},
            console: { log: () => {} },
        },
    };
}

describe('LSP Working Directory Option - Integration Tests', () => {
    let test_dir: string;
    let document_store: DocumentStore;
    let scope_resolver: ScopeResolver;
    let forward_scope_resolver: ForwardScopeResolver;

    beforeEach(() => {
        test_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsp-wd-integration-'));
        scope_resolver = new ScopeResolver();
        forward_scope_resolver = new ForwardScopeResolver(scope_resolver, { max_forward_depth: 10 });
        scope_resolver.set_forward_scope_resolver(forward_scope_resolver);
        document_store = new DocumentStore();
        document_store.set_workspace_root(test_dir);
        document_store.set_scope_resolver(scope_resolver);
    });

    afterEach(() => {
        fs.rmSync(test_dir, { recursive: true, force: true });
    });

    /**
     * Helper to write a file in the test directory
     */
    function write_file(relative_path: string, content: string): string {
        const full_path = path.join(test_dir, relative_path);
        const dir = path.dirname(full_path);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(full_path, content);
        return full_path;
    }

    describe('6.1 End-to-end LSP request', () => {
        it('should return working directory for document with @lsp-cd directive', async () => {
            // Create a subdirectory for the working directory
            const wd_dir = path.join(test_dir, 'data');
            fs.mkdirSync(wd_dir, { recursive: true });

            // Create document with @lsp-cd directive
            const file_path = write_file('scripts/analysis.do', `// @lsp-cd: "../data"
display "hello"`);
            const uri = `file://${file_path}`;

            // Open document in store
            const content = fs.readFileSync(file_path, 'utf-8');
            await document_store.open(uri, content, 1);

            // Create handler and send request
            const deps = create_mock_dependencies(document_store);
            const handler = create_get_working_directory_handler(deps);
            const params: GetWorkingDirectoryParams = { uri };
            const result = await handler(params);

            // Should return the resolved working directory
            expect(result.workingDirectory).toBe(wd_dir);
        });

        it('should return null for document without @lsp-cd directive', async () => {
            // Create document without @lsp-cd directive
            const file_path = write_file('scripts/simple.do', `display "hello"`);
            const uri = `file://${file_path}`;

            // Open document in store
            const content = fs.readFileSync(file_path, 'utf-8');
            await document_store.open(uri, content, 1);

            // Create handler and send request
            const deps = create_mock_dependencies(document_store);
            const handler = create_get_working_directory_handler(deps);
            const params: GetWorkingDirectoryParams = { uri };
            const result = await handler(params);

            // Should return null
            expect(result.workingDirectory).toBeNull();
        });

        it('should return null for non-existent document', async () => {
            const uri = `file://${test_dir}/nonexistent.do`;

            // Create handler and send request
            const deps = create_mock_dependencies(document_store);
            const handler = create_get_working_directory_handler(deps);
            const params: GetWorkingDirectoryParams = { uri };
            const result = await handler(params);

            // Should return null
            expect(result.workingDirectory).toBeNull();
        });

        it('should support @lsp-working-directory directive', async () => {
            // Create a subdirectory for the working directory
            const wd_dir = path.join(test_dir, 'output');
            fs.mkdirSync(wd_dir, { recursive: true });

            // Create document with @lsp-working-directory directive
            const file_path = write_file('scripts/report.do', `// @lsp-working-directory: "../output"
display "generating report"`);
            const uri = `file://${file_path}`;

            // Open document in store
            const content = fs.readFileSync(file_path, 'utf-8');
            await document_store.open(uri, content, 1);

            // Create handler and send request
            const deps = create_mock_dependencies(document_store);
            const handler = create_get_working_directory_handler(deps);
            const params: GetWorkingDirectoryParams = { uri };
            const result = await handler(params);

            // Should return the resolved working directory
            expect(result.workingDirectory).toBe(wd_dir);
        });

        it('should support @lsp-wd directive', async () => {
            // Create a subdirectory for the working directory
            const wd_dir = path.join(test_dir, 'results');
            fs.mkdirSync(wd_dir, { recursive: true });

            // Create document with @lsp-wd directive
            const file_path = write_file('scripts/compute.do', `// @lsp-wd: "../results"
gen x = 1`);
            const uri = `file://${file_path}`;

            // Open document in store
            const content = fs.readFileSync(file_path, 'utf-8');
            await document_store.open(uri, content, 1);

            // Create handler and send request
            const deps = create_mock_dependencies(document_store);
            const handler = create_get_working_directory_handler(deps);
            const params: GetWorkingDirectoryParams = { uri };
            const result = await handler(params);

            // Should return the resolved working directory
            expect(result.workingDirectory).toBe(wd_dir);
        });
    });

    describe('6.2 Inheritance chain', () => {
        it('should inherit working directory via @lsp-done-by', async () => {
            // Create directory structure:
            // test_dir/
            //   data/
            //   scripts/
            //     parent.do (has @lsp-cd: "../data")
            //     child.do (has @lsp-done-by: "parent.do")

            const data_dir = path.join(test_dir, 'data');
            fs.mkdirSync(data_dir, { recursive: true });

            // Create parent.do with @lsp-cd directive
            write_file('scripts/parent.do', `// @lsp-cd: "../data"
local myvar = 1
do "child.do"`);

            // Create child.do with @lsp-done-by directive
            const child_path = write_file('scripts/child.do', `// @lsp-done-by: "parent.do"
display \`myvar'`);
            const child_uri = `file://${child_path}`;

            // Open child document in store
            const child_content = fs.readFileSync(child_path, 'utf-8');
            await document_store.open(child_uri, child_content, 1);

            // Create handler and send request
            const deps = create_mock_dependencies(document_store);
            const handler = create_get_working_directory_handler(deps);
            const params: GetWorkingDirectoryParams = { uri: child_uri };
            const result = await handler(params);

            // Should inherit working directory from parent
            expect(result.workingDirectory).toBe(data_dir);
        });

        it('should inherit working directory via @lsp-included-by', async () => {
            // Create directory structure:
            // test_dir/
            //   output/
            //   scripts/
            //     main.do (has @lsp-cd: "../output")
            //     helper.do (has @lsp-included-by: "main.do")

            const output_dir = path.join(test_dir, 'output');
            fs.mkdirSync(output_dir, { recursive: true });

            // Create main.do with @lsp-cd directive
            write_file('scripts/main.do', `// @lsp-cd: "../output"
include "helper.do"`);

            // Create helper.do with @lsp-included-by directive
            const helper_path = write_file('scripts/helper.do', `// @lsp-included-by: "main.do"
display "helper"`);
            const helper_uri = `file://${helper_path}`;

            // Open helper document in store
            const helper_content = fs.readFileSync(helper_path, 'utf-8');
            await document_store.open(helper_uri, helper_content, 1);

            // Create handler and send request
            const deps = create_mock_dependencies(document_store);
            const handler = create_get_working_directory_handler(deps);
            const params: GetWorkingDirectoryParams = { uri: helper_uri };
            const result = await handler(params);

            // Should inherit working directory from main
            expect(result.workingDirectory).toBe(output_dir);
        });

        it('should return null when parent has no working directory', async () => {
            // Create parent.do without @lsp-cd directive
            write_file('scripts/parent.do', `local myvar = 1
do "child.do"`);

            // Create child.do with @lsp-done-by directive
            const child_path = write_file('scripts/child.do', `// @lsp-done-by: "parent.do"
display \`myvar'`);
            const child_uri = `file://${child_path}`;

            // Open child document in store
            const child_content = fs.readFileSync(child_path, 'utf-8');
            await document_store.open(child_uri, child_content, 1);

            // Create handler and send request
            const deps = create_mock_dependencies(document_store);
            const handler = create_get_working_directory_handler(deps);
            const params: GetWorkingDirectoryParams = { uri: child_uri };
            const result = await handler(params);

            // Should return null since parent has no working directory
            expect(result.workingDirectory).toBeNull();
        });
    });
});
