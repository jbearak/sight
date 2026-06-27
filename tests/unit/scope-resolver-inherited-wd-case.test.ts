/**
 * Regression test for #220: discover_working_directory must resolve the
 * backward-directive parent through the case-aware chokepoint
 * (compute_directive_real_path), not the as-typed Directive.path.
 *
 * Layout:
 *   On disk:   parent.do  (declares `// @lsp-cd: "data"`)
 *   Source:    child.do   `// @lsp-done-by: "Parent.do"`  (WRONG case)
 *
 * A child whose @lsp-done-by references a wrong-cased parent must still
 * inherit the parent's working directory. An injected RichResolveFs reports
 * the real on-disk casing so the test is host-filesystem-regime independent
 * (on a case-sensitive host the old code would fail to read "Parent.do").
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ScopeResolver } from '../../src/scope-resolver';
import { URI } from 'vscode-uri';
import type { RichResolveFs } from '../../src/utils/file-path-utils';

function to_uri(file_path: string): string {
    return URI.file(file_path).toString();
}

/**
 * RichResolveFs backed by real Node fs, with per-directory overrides so a
 * directory listing reports a fixed on-disk casing regardless of host.
 */
function make_patched_fs(
    overrides: Map<string, Array<{ name: string; is_file: boolean }>>,
): RichResolveFs {
    return {
        readdirSync(dir: string, _opts: { withFileTypes: true }) {
            const my_norm = path.normalize(dir);
            for (const [my_dir, my_entries] of overrides) {
                if (path.normalize(my_dir) === my_norm) {
                    return my_entries.map(e => ({
                        name: e.name,
                        isFile:         () => e.is_file,
                        isDirectory:    () => !e.is_file,
                        isSymbolicLink: () => false,
                    }));
                }
            }
            return fs.readdirSync(dir, { withFileTypes: true }) as Array<{
                name: string;
                isFile(): boolean;
                isDirectory(): boolean;
                isSymbolicLink(): boolean;
            }>;
        },
        existsSync(p: string) {
            return fs.existsSync(p);
        },
        statSync(p: string) {
            return fs.statSync(p);
        },
    };
}

describe('ScopeResolver inherited WD via case-only backward directive', () => {
    let scope_resolver: ScopeResolver;
    let temp_dir: string;

    beforeEach(() => {
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-inherit-wd-'));
        scope_resolver = new ScopeResolver();
    });

    afterEach(() => {
        fs.rmSync(temp_dir, { recursive: true, force: true });
    });

    function write_file(rel_path: string, content: string): string {
        const full_path = path.join(temp_dir, rel_path);
        fs.mkdirSync(path.dirname(full_path), { recursive: true });
        fs.writeFileSync(full_path, content);
        return full_path;
    }

    it('inherits parent @lsp-cd when @lsp-done-by is wrong-cased', async () => {
        // On disk: parent.do declares a working directory of "data".
        write_file('parent.do', '// @lsp-cd: "data"\nglobal g = 1\n');
        // Child references the parent with the WRONG case.
        const child_content = '// @lsp-done-by: "Parent.do"\n';
        const child_path = write_file('child.do', child_content);
        const child_uri = to_uri(child_path);

        // Inject fs: temp_dir lists parent.do (real casing) + child.do.
        const the_overrides = new Map<
            string,
            Array<{ name: string; is_file: boolean }>
        >();
        the_overrides.set(temp_dir, [
            { name: 'parent.do', is_file: true },
            { name: 'child.do', is_file: true },
        ]);
        scope_resolver.set_resolve_fs(make_patched_fs(the_overrides));
        scope_resolver.set_workspace_roots([temp_dir]);

        const result = await scope_resolver.resolve(child_uri, child_content);

        // The wrong-cased done-by resolved to parent.do (case_only), so the
        // child inherits parent's @lsp-cd ("data" => temp_dir/data).
        const expected_wd = path.normalize(path.join(temp_dir, 'data'));
        const my_inherited =
            result.inherited_working_directory?.replace(/[/\\]$/, '');
        expect(my_inherited).toBe(expected_wd);
    });
});
