import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { URI } from 'vscode-uri';

import { ScopeResolver } from '../../src/scope-resolver';

describe('Call-site mismatch diagnostics with explicit call sites', () => {
    let temp_dir: string;
    let resolver: ScopeResolver;

    beforeEach(() => {
        temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sight-explicit-callsite-'));
        resolver = new ScopeResolver();
    });

    afterEach(() => {
        fs.rmSync(temp_dir, { recursive: true, force: true });
    });

    function create_file(filename: string, content: string): string {
        const file_path = path.join(temp_dir, filename);
        fs.mkdirSync(path.dirname(file_path), { recursive: true });
        fs.writeFileSync(file_path, content, 'utf8');
        return file_path;
    }

    it('emits warning for included-by when explicit line= points to do call', async () => {
        const parent_path = create_file(
            'parent.do',
            ['* parent', 'do "child.do"'].join('\n')
        );

        const child_content = [
            '* @lsp-included-by: "parent.do" line=2',
            'display "hi"',
        ].join('\n');
        const child_path = create_file('child.do', child_content);

        const result = await resolver.resolve(URI.file(child_path).toString(), child_content);

        const mismatch_warning = result.diagnostics.find(
            (d) => d.severity === 'warning' && d.message.includes('# sight: included-by')
        );
        expect(mismatch_warning).toBeDefined();
    });

    it('emits info for done-by when explicit line= points to include call, and respects suppression', async () => {
        const parent_path = create_file(
            'parent.do',
            ['* parent', 'include "child.do"'].join('\n')
        );

        const child_content = [
            '* @lsp-done-by: "parent.do" line=2',
            'display "hi"',
        ].join('\n');
        const child_path = create_file('child.do', child_content);

        // Suppress call-site identification info diagnostics.
        const result = await resolver.resolve(
            URI.file(child_path).toString(),
            child_content,
            {
                diagnostics: {
                    call_site_identification: 'off',
                },
            }
        );

        const done_by_include_info = result.diagnostics.find(
            (d) => d.message.includes('# sight: done-by') && d.message.includes('include')
        );
        expect(done_by_include_info).toBeUndefined();
    });

    it('emits mismatch diagnostics when match= resolves to an include line', async () => {
        create_file(
            'parent.do',
            ['* parent', 'include "child.do"  // MARKER'].join('\n')
        );

        const child_content = [
            '* @lsp-done-by: "parent.do" match="MARKER"',
            'display "hi"',
        ].join('\n');
        const child_path = create_file('child.do', child_content);

        const result = await resolver.resolve(URI.file(child_path).toString(), child_content);

        const info_diag = result.diagnostics.find(
            (d) => d.severity === 'information' && d.message.includes('Full inheritance')
        );
        expect(info_diag).toBeDefined();
    });
});
