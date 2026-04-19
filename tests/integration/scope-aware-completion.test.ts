/**
 * Mirrors the examples/demo/ layout in miniature: the main file defines
 * `local color` and `local fruit`, a sibling file defines `local cwd`.
 * Typing `di "\`c` in the main file must suggest `color` and must not
 * suggest `cwd` (locals are file-scoped in Global Mode).
 *
 * Regression guard for the original bug report where local macros from
 * unrelated workspace files leaked into completions.
 */

import { describe, it, expect, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { URI } from 'vscode-uri';
import { CompletionProvider } from '../../src/providers/completion';
import { WorkspaceIndexer } from '../../src/indexer';
import { CommandDatabase } from '../../src/commands';
import { DocumentStore } from '../../src/document-store';
import { DependencyGraph } from '../../src/dependency-graph';

describe('Scope-aware completion (integration): demo scenario', () => {
    let tmp_root: string | null = null;

    afterEach(() => {
        if (tmp_root) {
            fs.rmSync(tmp_root, { recursive: true, force: true });
            tmp_root = null;
        }
    });

    it('should not suggest local macros from unrelated workspace files', async () => {
        tmp_root = fs.mkdtempSync(path.join(os.tmpdir(), 'sight-scope-'));
        const main_path = path.join(tmp_root, 'demo_completions.do');
        const other_path = path.join(tmp_root, 'other.do');

        fs.writeFileSync(main_path, [
            'local fruit "apple banana cherry"',
            'local color "red blue green"',
            'di "`c',
        ].join('\n'));
        fs.writeFileSync(other_path, 'local cwd = c(pwd)\n');

        const command_db = new CommandDatabase();
        const indexer = new WorkspaceIndexer();
        indexer.set_dependency_graph(new DependencyGraph());
        await indexer.initialize([tmp_root]);

        const document_store = new DocumentStore();
        const main_uri = URI.file(main_path).toString();
        const main_content = fs.readFileSync(main_path, 'utf8');
        await document_store.open(
            main_uri,
            main_content,
            1,
            indexer.get_all_symbols()
        );
        const doc = document_store.get(main_uri)!;

        const provider = new CompletionProvider(command_db);
        const completions = await provider.get_completions(
            doc,
            { line: 2, character: 6 }, // after `c in `di "`c`
            '`',
            undefined,
            indexer.get_all_symbols()
        );

        const labels = completions.map(c => c.label);
        expect(labels).toContain('color');
        expect(labels).not.toContain('cwd');
    });
});
