import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { URI } from 'vscode-uri';

import { ScopeResolver } from '../../src/scope-resolver';

/**
 * Regression test:
 * When call-site comes from reverse dependencies and there are mixed call types
 * (do/include) referencing the same callee, the ScopeResolver must use the
 * earliest call site's call type for inheritance behavior.
 */
describe('ScopeResolver reverse deps call type selection', () => {
    let temp_dir: string;
    let resolver: ScopeResolver;

    beforeEach(() => {
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sight-revdeps-test-'));
        resolver = new ScopeResolver();
    });

    afterEach(() => {
        fs.rmSync(temp_dir, { recursive: true, force: true });
    });

    function create_file(filename: string, content: string): string {
        const file_path = path.join(temp_dir, filename);
        const dir = path.dirname(file_path);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(file_path, content, 'utf8');
        return file_path;
    }

    it('uses earliest edge call_type (do) even if a later edge is include', async () => {
        const parent_path = create_file(
            'parent.do',
            [
                '* parent',
                'local secret 123',
                'do "child.do"',
                '* later include exists too',
                'include "child.do"',
            ].join('\n')
        );

        const child_content = [
            '* @lsp-done-by: "parent.do"',
            'display "hello"',
        ].join('\n');
        const child_path = create_file('child.do', child_content);

        const parent_uri = URI.file(parent_path).toString();
        const child_uri = URI.file(child_path).toString();

        // Seed reverse deps to force follow_directives() to pick call_site from edges.
        resolver.update_reverse_dependencies(
            parent_uri,
            [
                {
                    type: 'do',
                    path: child_path,
                    raw_path: 'child.do',
                    call_site_line: 2,
                    range: { start: { line: 2, character: 0 }, end: { line: 2, character: 12 } },
                    source: 'command',
                    is_static: true,
                },
                {
                    type: 'include',
                    path: child_path,
                    raw_path: 'child.do',
                    call_site_line: 4,
                    range: { start: { line: 4, character: 0 }, end: { line: 4, character: 16 } },
                    source: 'command',
                    is_static: true,
                },
            ],
            // symbols don't matter for this test
            {
                programs: new Map(),
                localMacros: new Map(),
                globalMacros: new Map(),
                variables: new Map(),
                scalars: new Map(),
                matrices: new Map(),
            }
        );

        const result = await resolver.resolve(child_uri, child_content);

        // With done/do semantics, parent's local macros must NOT be inherited.
        expect(result.symbols.localMacros.has('secret')).toBe(false);

        // Also sanity-check we warned about mixed call types.
        const mixed_warning = result.diagnostics.find((d) =>
            d.message.includes('multiple call types') && d.severity === 'warning'
        );
        expect(mixed_warning).toBeDefined();
    });
});
