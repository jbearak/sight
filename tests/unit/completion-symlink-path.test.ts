/**
 * Path completion (after `do "…/`) must offer symlinked directories and
 * symlinked source files (issue #219). An absolute partial path bypasses
 * workspace-root resolution, so the completion's `base_dir` is the temp dir
 * directly. No recursion is involved, so there is no cycle/boundary concern —
 * only classification.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CompletionProvider } from '../../src/providers/completion';
import { CommandDatabase } from '../../src/commands';
import { DocumentState } from '../../src/document-store';

let tmp_dir: string;

function doc_for(content: string): DocumentState {
    return {
        uri: 'file:///test.do',
        version: 1,
        content,
        ast: null,
        symbols: {
            programs: new Map(),
            localMacros: new Map(),
            globalMacros: new Map(),
            variables: new Map(),
            scalars: new Map(),
            matrices: new Map(),
        },
        diagnostics: [],
    } as unknown as DocumentState;
}

function try_symlink(target: string, link_path: string): boolean {
    try {
        fs.symlinkSync(target, link_path);
        return true;
    } catch {
        return false;
    }
}

describe('path completion offers symlinked entries (#219)', () => {
    let provider: CompletionProvider;

    beforeEach(() => {
        provider = new CompletionProvider(new CommandDatabase(), {
            snippet_support: true,
        });
        tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'symlink-comp-'));
    });
    afterEach(() => {
        fs.rmSync(tmp_dir, { recursive: true, force: true });
    });

    it('lists a symlinked directory and a symlinked .do file', async () => {
        // A real dir + a symlink to it; a real .do + a symlink to it.
        const real_dir = path.join(tmp_dir, 'realdir');
        fs.mkdirSync(real_dir);
        const real_do = path.join(tmp_dir, 'real.do');
        fs.writeFileSync(real_do, 'display 1\n');
        const have_dir_link = try_symlink(real_dir, path.join(tmp_dir, 'linkdir'));
        const have_file_link = try_symlink(real_do, path.join(tmp_dir, 'aliased.do'));
        if (!have_dir_link || !have_file_link) return; // platform skip

        const content = `do "${tmp_dir}/`;
        const completions = await provider.get_completions(doc_for(content), {
            line: 0,
            character: content.length,
        });
        const labels = completions.map((c) => c.label);

        // Symlinked directory offered with trailing slash.
        expect(labels).toContain('linkdir/');
        // Symlinked .do file offered like a regular file.
        expect(labels).toContain('aliased.do');
        // Sanity: the non-symlinked siblings are present too.
        expect(labels).toContain('realdir/');
        expect(labels).toContain('real.do');
    });
});
