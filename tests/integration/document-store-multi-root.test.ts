/**
 * Integration test for DocumentStore multi-root workspace support.
 *
 * Verifies that documents in different workspace roots resolve
 * workspace-relative @lsp-working-directory against the correct root.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { URI } from 'vscode-uri';
import { DocumentStore } from '../../src/document-store';
import { ScopeResolver } from '../../src/scope-resolver';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';

describe('DocumentStore multi-root workspace support', () => {
    let base_dir: string;
    let root_a: string;
    let root_b: string;
    let document_store: DocumentStore;
    let scope_resolver: ScopeResolver;

    beforeEach(() => {
        base_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-multi-root-'));
        root_a = path.join(base_dir, 'project-a');
        root_b = path.join(base_dir, 'project-b');
        fs.mkdirSync(root_a, { recursive: true });
        fs.mkdirSync(root_b, { recursive: true });

        scope_resolver = new ScopeResolver();
        scope_resolver.set_workspace_roots([root_a, root_b]);
        const forward_resolver = new ForwardScopeResolver(scope_resolver);
        forward_resolver.set_workspace_roots([root_a, root_b]);
        scope_resolver.set_forward_scope_resolver(forward_resolver);

        document_store = new DocumentStore();
        document_store.set_workspace_roots([root_a, root_b]);
        document_store.set_scope_resolver(scope_resolver);
    });

    afterEach(() => {
        fs.rmSync(base_dir, { recursive: true, force: true });
    });

    test('file in root-a resolves @lsp-wd /data against root-a', async () => {
        const data_dir = path.join(root_a, 'data');
        fs.mkdirSync(data_dir, { recursive: true });

        const file_path = path.join(root_a, 'test.do');
        const content = [
            '* @lsp-wd /data',
            'display "hello"',
        ].join('\n');
        fs.writeFileSync(file_path, content);

        const uri = URI.file(file_path).toString();
        await document_store.open(uri, content, 1);
        const state = document_store.get(uri);

        expect(state).toBeDefined();
        expect(state!.working_directory).toBe(data_dir);
    });

    test('file in root-b resolves @lsp-wd /data against root-b', async () => {
        const data_dir = path.join(root_b, 'data');
        fs.mkdirSync(data_dir, { recursive: true });

        const file_path = path.join(root_b, 'test.do');
        const content = [
            '* @lsp-wd /data',
            'display "hello"',
        ].join('\n');
        fs.writeFileSync(file_path, content);

        const uri = URI.file(file_path).toString();
        await document_store.open(uri, content, 1);
        const state = document_store.get(uri);

        expect(state).toBeDefined();
        expect(state!.working_directory).toBe(data_dir);
    });

    test('files in different roots resolve /data to their own root', async () => {
        // Create data directories in both roots
        const data_a = path.join(root_a, 'data');
        const data_b = path.join(root_b, 'data');
        fs.mkdirSync(data_a, { recursive: true });
        fs.mkdirSync(data_b, { recursive: true });

        const content = [
            '* @lsp-wd /data',
            'display "hello"',
        ].join('\n');

        // File in root-a
        const file_a = path.join(root_a, 'test.do');
        fs.writeFileSync(file_a, content);
        const uri_a = URI.file(file_a).toString();
        await document_store.open(uri_a, content, 1);

        // File in root-b
        const file_b = path.join(root_b, 'test.do');
        fs.writeFileSync(file_b, content);
        const uri_b = URI.file(file_b).toString();
        await document_store.open(uri_b, content, 1);

        const state_a = document_store.get(uri_a);
        const state_b = document_store.get(uri_b);

        expect(state_a!.working_directory).toBe(data_a);
        expect(state_b!.working_directory).toBe(data_b);
        expect(state_a!.working_directory).not.toBe(state_b!.working_directory);
    });

    test('get_workspace_root_for_uri returns correct root per file', () => {
        expect(document_store.get_workspace_root_for_uri(
            URI.file(path.join(root_a, 'file.do')).toString()
        )).toBe(path.resolve(root_a));

        expect(document_store.get_workspace_root_for_uri(
            URI.file(path.join(root_b, 'file.do')).toString()
        )).toBe(path.resolve(root_b));
    });

    test('file outside all roots falls back to first root', () => {
        const outside_uri = URI.file('/tmp/outside/file.do').toString();
        expect(document_store.get_workspace_root_for_uri(outside_uri))
            .toBe(root_a);
    });
});
