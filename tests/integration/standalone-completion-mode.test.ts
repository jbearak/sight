/**
 * Completion-mode selection for standalone files (issue #208).
 *
 * A standalone file uses Scope-Resolved mode (its chain is just itself).
 * Workspace globals/programs are out-of-scope-annotated in BOTH modes, so
 * the observable mode difference is VARIABLES: Global mode offers
 * workspace variables in-scope (dataset columns are workspace-wide),
 * while Scope-Resolved mode offers only the resolved chain's variables.
 * ("Consistent" strictness decision: identical treatment to a file with
 * explicit directives.)
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
import { ScopeResolver } from '../../src/scope-resolver';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';

describe('Standalone completion mode (issue #208)', () => {
    let tmp_root: string | null = null;

    afterEach(() => {
        if (tmp_root) {
            fs.rmSync(tmp_root, { recursive: true, force: true });
            tmp_root = null;
        }
    });

    async function run_scenario(standalone: boolean) {
        tmp_root = fs.mkdtempSync(
            path.join(os.tmpdir(), 'sight-standalone-completion-')
        );
        const main_path = path.join(tmp_root, 'main.do');
        const other_path = path.join(tmp_root, 'other.do');

        const the_main_lines = standalone
            ? ['// sight: standalone', 'gen own_var = 1', 'summarize ']
            : ['gen own_var = 1', 'summarize '];
        fs.writeFileSync(main_path, the_main_lines.join('\n'));
        fs.writeFileSync(other_path, 'gen unrelated_var = 1\n');

        const command_db = new CommandDatabase();
        const graph = new DependencyGraph();
        const indexer = new WorkspaceIndexer();
        indexer.set_dependency_graph(graph);
        await indexer.initialize([tmp_root]);

        const scope_resolver = new ScopeResolver(undefined, {
            read_file: async (uri: string) =>
                fs.promises.readFile(URI.parse(uri).fsPath, 'utf8'),
            exists: async (uri: string) => {
                try {
                    await fs.promises.access(URI.parse(uri).fsPath);
                    return true;
                } catch {
                    return false;
                }
            },
            stat: async (uri: string) => {
                try {
                    const stats =
                        await fs.promises.stat(URI.parse(uri).fsPath);
                    return { mtimeMs: stats.mtimeMs, size: stats.size };
                } catch {
                    return undefined;
                }
            },
        });
        scope_resolver.set_dependency_graph(graph);
        const forward_resolver = new ForwardScopeResolver(scope_resolver);
        scope_resolver.set_forward_scope_resolver(forward_resolver);

        const document_store = new DocumentStore();
        const main_uri = URI.file(main_path).toString();
        const main_content = fs.readFileSync(main_path, 'utf8');
        await document_store.open(
            main_uri, main_content, 1, indexer.get_all_symbols()
        );
        await document_store.wait_for_update(main_uri);
        const doc = document_store.get(main_uri)!;

        const provider = new CompletionProvider(command_db);
        const cursor_line = standalone ? 2 : 1;
        const completions = await provider.get_completions(
            doc,
            // In the varlist position after `summarize `.
            { line: cursor_line, character: 10 },
            undefined,
            scope_resolver,
            indexer.get_all_symbols(),
            { backward_dependencies: 'auto' }
        );
        return completions.map(c => c.label);
    }

    it('a standalone file offers only its own chain\'s variables (Scope-Resolved mode)', async () => {
        const the_labels = await run_scenario(true);
        expect(the_labels).toContain('own_var');
        expect(the_labels).not.toContain('unrelated_var');
    });

    it('control: a non-standalone zero-parent file offers workspace variables (Global mode)', async () => {
        const the_labels = await run_scenario(false);
        expect(the_labels).toContain('own_var');
        expect(the_labels).toContain('unrelated_var');
    });
});
