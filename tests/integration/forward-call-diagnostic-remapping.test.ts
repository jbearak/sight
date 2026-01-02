/**
 * Integration test for forward-call diagnostic remapping.
 *
 * Tests that forward-call diagnostics (e.g., missing include targets) are NOT
 * remapped to the backward-directive line when a file has @lsp-done-by/@lsp-included-by.
 *
 * The bug was that all diagnostics with source attribution were being remapped
 * to the first directive line, hiding the real call site for forward-call errors.
 *
 * Directory structure:
 * test_dir/
 * ├── parent.do       // Parent file with a global
 * └── child.do        // @lsp-done-by: "parent.do" + do "missing.do"
 *
 * Expected behavior:
 * - The "Cannot read file: missing.do" diagnostic should appear on the
 *   `do "missing.do"` line (line 4), NOT on the @lsp-done-by line (line 1).
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { URI } from 'vscode-uri';
import { ScopeResolver } from '../../src/scope-resolver';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';
import { create_test_scope_resolver_logger } from '../test-logger';

describe('Forward-call diagnostic remapping', () => {
    let test_dir: string;
    let scope_resolver: ScopeResolver;
    let forward_resolver: ForwardScopeResolver;

    beforeEach(() => {
        test_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fwd-diag-test-'));
        scope_resolver = new ScopeResolver(create_test_scope_resolver_logger());
        forward_resolver = new ForwardScopeResolver(scope_resolver);
        scope_resolver.set_forward_scope_resolver(forward_resolver);
    });

    afterEach(() => {
        fs.rmSync(test_dir, { recursive: true, force: true });
    });

    function write_file(relative_path: string, content: string): string {
        const full_path = path.join(test_dir, relative_path);
        const dir = path.dirname(full_path);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(full_path, content);
        return full_path;
    }

    function file_uri(file_path: string): string {
        return URI.file(file_path).toString();
    }

    it('should keep forward-call diagnostic on call site line, not directive line', async () => {
        // Create parent.do
        const parent_content = `* Parent file
global parent_var = 1
`;
        write_file('parent.do', parent_content);

        // Create child.do with backward directive AND a missing forward call
        // Line 1: @lsp-done-by directive
        // Line 4: do "missing.do" (the forward call that will fail)
        const child_content = `// @lsp-done-by: "parent.do"
* Child file
local child_var = 1
do "missing.do"
`;
        const child_path = write_file('child.do', child_content);
        const child_uri = file_uri(child_path);

        const result = await scope_resolver.resolve(child_uri, child_content);

        // Should have a diagnostic for the missing file
        expect(result.diagnostics.length).toBeGreaterThan(0);

        const missing_file_diag = result.diagnostics.find(d =>
            d.message.includes('Cannot read file') && d.message.includes('missing.do')
        );
        expect(missing_file_diag).toBeDefined();

        // The diagnostic should be on line 3 (0-indexed), where `do "missing.do"` is
        // NOT on line 0 where the @lsp-done-by directive is
        expect(missing_file_diag!.range.start.line).toBe(3);
    });

    it('should still remap backward-directive diagnostics to directive line', async () => {
        // Create child.do with a backward directive pointing to a missing parent
        const child_content = `// @lsp-done-by: "missing_parent.do"
* Child file
local child_var = 1
`;
        const child_path = write_file('child.do', child_content);
        const child_uri = file_uri(child_path);

        const result = await scope_resolver.resolve(child_uri, child_content);

        // Should have a diagnostic for the missing parent file
        expect(result.diagnostics.length).toBeGreaterThan(0);

        const missing_parent_diag = result.diagnostics.find(d =>
            d.message.includes('Cannot read file') && d.message.includes('missing_parent.do')
        );
        expect(missing_parent_diag).toBeDefined();

        // The diagnostic should be on line 0 (the directive line)
        expect(missing_parent_diag!.range.start.line).toBe(0);
    });
});
