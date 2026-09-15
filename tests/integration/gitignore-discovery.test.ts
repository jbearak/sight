import {
    afterEach, beforeEach, describe, expect, it, spyOn,
} from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { URI } from 'vscode-uri';
import {
    build_check_context, load_check_config, run_check_with_cwd,
} from '../../src/cli/check';
import { collect_report_targets } from '../../src/cli/source-files';
import { EXIT_CHECK_FAILED, EXIT_OK } from '../../src/cli/shared';
import { DependencyGraph } from '../../src/dependency-graph';
import { WorkspaceIndexer } from '../../src/indexer';
import { DEFAULT_SETTINGS } from '../../src/server-handlers';

describe('Git-ignore discovery in CLI and workspace indexing', () => {
    let root: string;
    let indexer: WorkspaceIndexer;

    beforeEach(() => {
        root = fs.realpathSync.native(fs.mkdtempSync(
            path.join(os.tmpdir(), 'sight-gitignore-discovery-')
        ));
        indexer = new WorkspaceIndexer();
        indexer.configure(DEFAULT_SETTINGS);
    });

    afterEach(() => {
        indexer.cancel();
        fs.rmSync(root, { recursive: true, force: true });
    });

    /** Write a project-relative fixture, creating its containing directory. */
    function write_file(relative: string, content: string): string {
        const file_path = path.join(root, relative);
        fs.mkdirSync(path.dirname(file_path), { recursive: true });
        fs.writeFileSync(file_path, content);
        return file_path;
    }

    /** Capture the public CLI's output and exit status. */
    async function check(the_paths: string[] = []) {
        const stdout: string[] = [];
        const stderr: string[] = [];
        const code = await run_check_with_cwd(
            ['--workspace', root, '--quiet', ...the_paths], root,
            {
                stdout: text => stdout.push(text),
                stderr: text => stderr.push(text),
            }
        );
        return { code, stdout: stdout.join(''), stderr: stderr.join('') };
    }

    it('applies nested rules identically to discovery and cold indexing', async () => {
        write_file('.gitignore', '*.generated.do\narchive/\n');
        write_file('analysis/.gitignore', '!keep.generated.do\nlocal.do\n');
        write_file('main.do', 'display 1\n');
        write_file('omit.generated.do', 'display 1\n');
        write_file('analysis/omit.generated.do', 'display 1\n');
        write_file('analysis/keep.generated.do', 'display 1\n');
        write_file('analysis/local.do', 'display 1\n');
        write_file('archive/old.do', 'display 1\n');
        const result = collect_report_targets([], root, root);
        await indexer.initialize([root]);

        expect(result.operator_errors).toEqual([]);
        expect(result.targets.map(my_target => my_target.relative_path)).toEqual([
            'analysis/keep.generated.do', 'main.do',
        ]);
        expect(new Set(indexer.get_indexed_files().keys())).toEqual(new Set(
            result.targets.map(my_target => URI.file(my_target.path).toString())
        ));
    });

    it('prunes ignored directories before reading their contents', async () => {
        write_file('.gitignore', 'archive/\n');
        const ignored_dir = path.dirname(write_file(
            'archive/old.do', 'display 1\n'
        ));
        write_file('main.do', 'display 1\n');
        const sync_read = spyOn(fs, 'readdirSync');
        const async_read = spyOn(fs.promises, 'readdir');
        try {
            collect_report_targets([], root, root);
            await indexer.initialize([root]);
            expect(sync_read.mock.calls.some(
                my_call => String(my_call[0]) === ignored_dir
            )).toBe(false);
            expect(async_read.mock.calls.some(
                my_call => String(my_call[0]) === ignored_dir
            )).toBe(false);
        } finally {
            sync_read.mockRestore();
            async_read.mockRestore();
        }
    });

    it('checks explicit files while directory inputs still honor ignore rules', async () => {
        write_file('.gitignore', 'archive/\n');
        write_file('main.do', 'display 1\n');
        write_file('archive/old.do', "display \"`missing'\"\n");
        expect(collect_report_targets(['archive'], root, root).targets).toEqual([]);
        expect((await check()).code).toBe(EXIT_OK);
        const result = await check(['archive/old.do']);
        expect(result.stderr).toBe('');
        expect(result.code).toBe(EXIT_CHECK_FAILED);
        expect(result.stdout).toContain('archive/old.do:1:');
    });

    it('honors false in TOML without disabling other discovery exclusions', async () => {
        write_file('sight.toml', [
            'exclude = ["excluded/**"]',
            '[workspace]',
            'respectGitignore = false',
            '',
        ].join('\n'));
        write_file('.gitignore', 'ignored.do\n');
        write_file('ignored.do', "display \"`missing'\"\n");
        write_file('excluded/other.do', "display \"`excluded_macro'\"\n");
        write_file('.hidden/other.do', "display \"`hidden_macro'\"\n");
        const result = await check();
        expect(result.stderr).toBe('');
        expect(result.code).toBe(EXIT_CHECK_FAILED);
        expect(result.stdout).toContain('ignored.do:1:');
        expect(result.stdout).not.toContain('other.do');

        indexer.configure({
            ...DEFAULT_SETTINGS,
            workspace: { respectGitignore: false },
            exclude: ['excluded/**'],
        });
        await indexer.initialize([root]);
        expect(new Set(indexer.get_indexed_files().keys())).toEqual(new Set([
            URI.file(path.join(root, 'ignored.do')).toString(),
        ]));
    });

    it('does not infer an ignored parent but still resolves explicit includes', async () => {
        write_file('.gitignore', 'archive/\nlocal/\n');
        const main_path = write_file('main.do', [
            'include "local/setup.do"',
            'display "`from_setup\'"',
            'display $from_archive',
            '',
        ].join('\n'));
        write_file('local/setup.do', 'local from_setup = 1\n');
        const parent_path = write_file('archive/master.do', [
            'global from_archive = 1',
            `do "${main_path}"`,
            '',
        ].join('\n'));
        const graph = new DependencyGraph();
        graph.set_workspace_roots([root]);
        indexer.set_dependency_graph(graph);
        await indexer.initialize([root]);
        expect(graph.get_callees(URI.file(parent_path).toString()).size).toBe(0);

        const result = await check(['main.do']);
        expect(result.code).toBe(EXIT_CHECK_FAILED);
        expect(result.stdout).toContain('from_archive');
        expect(result.stdout).not.toContain('from_setup');
        expect(result.stdout).not.toContain('setup.do:');
    });

    it('checks an explicit ignored file even after the index reaches its cap', async () => {
        write_file('sight.toml', '[crossFile]\nmaxIndexedFiles = 1\n');
        write_file('.gitignore', 'ignored.do\n');
        write_file('main.do', 'display 1\n');
        write_file('ignored.do', "display \"`missing'\"\n");
        const config_result = load_check_config({
            cwd: root, workspace_root: root, no_config: false,
        });
        if (config_result.kind !== 'loaded') {
            throw new Error('Expected fixture configuration to load');
        }
        const context = await build_check_context(root, config_result.config);
        try {
            expect(context.workspace_indexer.get_metrics().files_indexed).toBe(1);
            expect(context.workspace_indexer.is_gitignored(
                path.join(root, 'ignored.do')
            )).toBe(true);
        } finally {
            context.workspace_indexer.cancel();
            await context.document_store.dispose();
        }
        const result = await check(['ignored.do']);
        expect(result.code).toBe(EXIT_CHECK_FAILED);
        expect(result.stdout).toContain('ignored.do:1:');
        expect(result.stdout).not.toContain('was not indexed');
    });

    it('leaves external ADO roots unaffected by workspace Git-ignore rules', async () => {
        const workspace_root = path.join(root, 'project');
        const ado_root = path.join(root, 'external');
        write_file('project/.gitignore', '*.ado\n');
        write_file('external/.gitignore', '*.ado\n');
        write_file('project/local.ado', 'program define local_program\nend\n');
        const external_path = write_file(
            'external/tool.ado', 'program define external_program\nend\n'
        );
        await indexer.initialize([workspace_root], [ado_root]);
        expect(new Set(indexer.get_indexed_files().keys())).toEqual(new Set([
            URI.file(external_path).toString(),
        ]));
    });

    it('loads changed ignore rules on the next scan generation', async () => {
        const source_path = write_file('main.do', 'display 1\n');
        write_file('.gitignore', 'main.do\n');
        await indexer.initialize([root]);
        expect(indexer.is_gitignored(source_path)).toBe(true);
        write_file('.gitignore', '');
        indexer.reset();
        await indexer.initialize([root]);
        expect(indexer.is_gitignored(source_path)).toBe(false);
        expect(indexer.get_indexed_files().has(
            URI.file(source_path).toString()
        )).toBe(true);
    });

    it('tracks ignore rules even when automatic indexing is disabled', async () => {
        const source_path = write_file('main.do', 'display 1\n');
        write_file('.gitignore', 'main.do\n');
        indexer.configure({ ...DEFAULT_SETTINGS, indexWorkspace: false });
        await indexer.initialize([root]);
        expect(indexer.is_gitignored(source_path)).toBe(true);
        expect(indexer.get_indexed_files().size).toBe(0);
    });
});
