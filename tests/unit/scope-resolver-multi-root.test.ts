/**
 * Unit tests for ScopeResolver multi-root workspace support.
 *
 * Verifies that @lsp-working-directory directives with workspace-relative
 * paths resolve against the correct root when a file is in the second
 * (or deeper) workspace root.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { URI } from 'vscode-uri';
import { ScopeResolver } from '../../src/scope-resolver';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';

describe('ScopeResolver multi-root workspace support', () => {
    let base_dir: string;
    let root_a: string;
    let root_b: string;
    let scope_resolver: ScopeResolver;

    beforeEach(() => {
        base_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-root-test-'));
        root_a = path.join(base_dir, 'project-a');
        root_b = path.join(base_dir, 'project-b');
        fs.mkdirSync(root_a, { recursive: true });
        fs.mkdirSync(root_b, { recursive: true });

        scope_resolver = new ScopeResolver();
        scope_resolver.set_workspace_roots([root_a, root_b]);
        const forward_resolver = new ForwardScopeResolver(scope_resolver);
        scope_resolver.set_forward_scope_resolver(forward_resolver);
    });

    afterEach(() => {
        fs.rmSync(base_dir, { recursive: true, force: true });
    });

    test('resolves @lsp-cd against root-a for file in root-a', async () => {
        // Create data directory in root-a
        const data_dir = path.join(root_a, 'data');
        fs.mkdirSync(data_dir, { recursive: true });

        // Parent file in root-a with workspace-relative @lsp-cd
        const parent_path = path.join(root_a, 'master.do');
        fs.writeFileSync(parent_path, [
            '* @lsp-cd /data',
            'do analysis.do',
        ].join('\n'));

        // Child file referencing parent
        const child_path = path.join(root_a, 'analysis.do');
        const child_content = [
            `* @lsp-done-by "${parent_path}"`,
            'display "hello"',
        ].join('\n');
        fs.writeFileSync(child_path, child_content);

        const child_uri = URI.file(child_path).toString();
        const result = await scope_resolver.resolve(child_uri, child_content);

        expect(result.inherited_working_directory).toBe(data_dir);
    });

    test('resolves @lsp-cd against root-b for file in root-b', async () => {
        // Create data directory in root-b
        const data_dir = path.join(root_b, 'data');
        fs.mkdirSync(data_dir, { recursive: true });

        // Parent file in root-b with workspace-relative @lsp-cd
        const parent_path = path.join(root_b, 'master.do');
        fs.writeFileSync(parent_path, [
            '* @lsp-cd /data',
            'do analysis.do',
        ].join('\n'));

        // Child file referencing parent
        const child_path = path.join(root_b, 'analysis.do');
        const child_content = [
            `* @lsp-done-by "${parent_path}"`,
            'display "hello"',
        ].join('\n');
        fs.writeFileSync(child_path, child_content);

        const child_uri = URI.file(child_path).toString();
        const result = await scope_resolver.resolve(child_uri, child_content);

        // Should resolve against root-b, not root-a
        expect(result.inherited_working_directory).toBe(data_dir);
    });

    test('does NOT resolve @lsp-cd /data in root-b against root-a', async () => {
        // Create /data only in root-a (not in root-b)
        const data_dir_a = path.join(root_a, 'data');
        fs.mkdirSync(data_dir_a, { recursive: true });
        // root-b has no /data directory

        // Parent file in root-b with workspace-relative @lsp-cd
        const parent_path = path.join(root_b, 'master.do');
        fs.writeFileSync(parent_path, [
            '* @lsp-cd /data',
            'do analysis.do',
        ].join('\n'));

        // Child file in root-b
        const child_path = path.join(root_b, 'analysis.do');
        const child_content = [
            `* @lsp-done-by "${parent_path}"`,
            'display "hello"',
        ].join('\n');
        fs.writeFileSync(child_path, child_content);

        const child_uri = URI.file(child_path).toString();
        const result = await scope_resolver.resolve(child_uri, child_content);

        // The directory doesn't exist in root-b, but ScopeResolver
        // still reports the declared path. If resolved at all, it should
        // point to root-b/data, NOT root-a/data.
        if (result.inherited_working_directory) {
            expect(result.inherited_working_directory).not.toBe(data_dir_a);
            expect(result.inherited_working_directory).toBe(
                path.join(root_b, 'data')
            );
        }
    });
});
