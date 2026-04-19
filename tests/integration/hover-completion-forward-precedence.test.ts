import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { URI } from 'vscode-uri';
import { HoverProvider } from '../../src/providers/hover';
import { CompletionProvider } from '../../src/providers/completion';
import { DocumentStore } from '../../src/document-store';
import { ScopeResolver } from '../../src/scope-resolver';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';
import { CommandDatabase } from '../../src/command-database';
import { create_empty_symbol_table } from '../../src/analyzer';
import type { SymbolTable } from '../../src/types';

function build_pipeline() {
    const the_command_db = new CommandDatabase();
    const the_scope_resolver = new ScopeResolver();
    const the_forward_scope_resolver = new ForwardScopeResolver(
        the_scope_resolver,
        { max_forward_depth: 10 },
    );
    the_scope_resolver.set_forward_scope_resolver(the_forward_scope_resolver);

    return {
        command_db: the_command_db,
        hover_provider: new HoverProvider(the_command_db),
        completion_provider: new CompletionProvider(the_command_db),
        document_store: new DocumentStore(),
        scope_resolver: the_scope_resolver,
        forward_scope_resolver: the_forward_scope_resolver,
    };
}

describe('hover/completion forward-call precedence', () => {
    let test_temp_dir: string;
    let pipeline: ReturnType<typeof build_pipeline>;

    beforeEach(() => {
        test_temp_dir = mkdtempSync(
            join(tmpdir(), 'hover-completion-forward-precedence-'),
        );
        pipeline = build_pipeline();
    });

    afterEach(() => {
        try { pipeline?.scope_resolver?.dispose(); } catch {}
        try { pipeline?.forward_scope_resolver?.dispose(); } catch {}
        if (existsSync(test_temp_dir)) {
            rmSync(test_temp_dir, { recursive: true, force: true });
        }
    });

    it('hover resolves a same-name program to the later visible forward callee', async () => {
        const first_path = join(test_temp_dir, 'first.do');
        writeFileSync(first_path, 'program define shared_prog\nend\n');

        const second_path = join(test_temp_dir, 'second.do');
        writeFileSync(second_path, 'program define shared_prog\nend\n');

        const main_path = join(test_temp_dir, 'main.do');
        const main_content =
            'do "first.do"\n' +
            'do "second.do"\n' +
            'shared_prog\n';
        writeFileSync(main_path, main_content);

        const main_uri = URI.file(main_path).toString();
        await pipeline.document_store.open(main_uri, main_content, 1);
        const document_state = pipeline.document_store.get(main_uri)!;

        const hover = await pipeline.hover_provider.get_hover(
            document_state,
            {
                line: 2,
                character: main_content.split('\n')[2].indexOf('shared_prog') + 3,
            },
            undefined,
            pipeline.scope_resolver,
        );

        expect(hover).toBeDefined();
        const content = hover?.contents as { kind: string; value: string };
        expect(content.value).toContain('Program');
        expect(content.value).toContain('shared_prog');
        expect(content.value).toContain('second.do');
        expect(content.value).not.toContain('first.do');
    });

    it('hover resolves a same-name global macro to the later visible forward callee', async () => {
        const first_path = join(test_temp_dir, 'first.do');
        writeFileSync(first_path, 'global SHARED "from_first"\n');

        const second_path = join(test_temp_dir, 'second.do');
        writeFileSync(second_path, 'global SHARED "from_second"\n');

        const main_path = join(test_temp_dir, 'main.do');
        const main_content =
            'do "first.do"\n' +
            'do "second.do"\n' +
            'display "$SHARED"\n';
        writeFileSync(main_path, main_content);

        const main_uri = URI.file(main_path).toString();
        await pipeline.document_store.open(main_uri, main_content, 1);
        const document_state = pipeline.document_store.get(main_uri)!;

        const hover = await pipeline.hover_provider.get_hover(
            document_state,
            {
                line: 2,
                character: main_content.split('\n')[2].indexOf('SHARED') + 2,
            },
            undefined,
            pipeline.scope_resolver,
        );

        expect(hover).toBeDefined();
        const content = hover?.contents as { kind: string; value: string };
        expect(content.value).toContain('Global Macro');
        expect(content.value).toContain('SHARED');
        expect(content.value).toContain('from_second');
        expect(content.value).toContain('second.do');
        expect(content.value).not.toContain('from_first');
    });

    it('completion resolves a same-name program to the later visible forward callee', async () => {
        const first_path = join(test_temp_dir, 'first.do');
        writeFileSync(first_path, 'program define shared_prog\nend\n');

        const second_path = join(test_temp_dir, 'second.do');
        writeFileSync(second_path, 'program define shared_prog\nend\n');

        const workspace_uri = URI.file(join(test_temp_dir, 'workspace.do')).toString();
        const workspace_symbols: SymbolTable = {
            ...create_empty_symbol_table(),
            programs: new Map([[
                'shared_prog',
                {
                    name: 'shared_prog',
                    location: {
                        uri: workspace_uri,
                        range: {
                            start: { line: 0, character: 0 },
                            end: { line: 0, character: 11 },
                        },
                    },
                    sourceUri: workspace_uri,
                },
            ]]),
        };

        const main_path = join(test_temp_dir, 'main.do');
        const main_content =
            'do "first.do"\n' +
            'do "second.do"\n' +
            'sha\n';
        writeFileSync(main_path, main_content);

        const main_uri = URI.file(main_path).toString();
        await pipeline.document_store.open(main_uri, main_content, 1);
        const document_state = pipeline.document_store.get(main_uri)!;

        const completions = await pipeline.completion_provider.get_completions(
            document_state,
            { line: 2, character: 3 },
            undefined,
            pipeline.scope_resolver,
            workspace_symbols,
        );

        const shared_prog = completions.find(item => item.label === 'shared_prog');
        expect(shared_prog).toBeDefined();
        expect(shared_prog?.detail).toContain('second.do');
        expect(String(shared_prog?.documentation)).toContain('second.do');
    });

    it('hover keeps current-file local redefined after forward include', async () => {
        const child_path = join(test_temp_dir, 'child.do');
        writeFileSync(child_path, 'local a 2\n');

        const main_path = join(test_temp_dir, 'main.do');
        const main_content =
            'local a 1\n' +
            'include "child.do"\n' +
            'local a 3\n' +
            'display `a\'\n';
        writeFileSync(main_path, main_content);

        const main_uri = URI.file(main_path).toString();
        await pipeline.document_store.open(main_uri, main_content, 1);
        const document_state = pipeline.document_store.get(main_uri)!;

        const hover = await pipeline.hover_provider.get_hover(
            document_state,
            {
                line: 3,
                character: main_content.split('\n')[3].indexOf('`a') + 1,
            },
            undefined,
            pipeline.scope_resolver,
        );

        expect(hover).toBeDefined();
        const content = hover?.contents as { kind: string; value: string };
        expect(content.value).toContain('Local Macro');
        expect(content.value).toContain('`a`');
        // Source should be the current file (main.do), not the forward callee.
        expect(content.value).toContain('this file');
        expect(content.value).not.toContain('child.do');
    });

    it('completion keeps current-file local redefined after forward include', async () => {
        const child_path = join(test_temp_dir, 'child.do');
        writeFileSync(child_path, 'local a "from_child"\n');

        const main_path = join(test_temp_dir, 'main.do');
        const main_content =
            'local a "from_main_early"\n' +
            'include "child.do"\n' +
            'local a "from_main_late"\n' +
            'display "`a\'"\n';
        writeFileSync(main_path, main_content);

        const main_uri = URI.file(main_path).toString();
        await pipeline.document_store.open(main_uri, main_content, 1);
        const document_state = pipeline.document_store.get(main_uri)!;

        const completions = await pipeline.completion_provider.get_completions(
            document_state,
            { line: 3, character: main_content.split('\n')[3].indexOf('`a') + 1 },
            undefined,
            pipeline.scope_resolver,
        );

        const macro_a = completions.find(item => item.label === 'a');
        expect(macro_a).toBeDefined();
        // Documentation should reflect the current-file definition, not the
        // forward callee's. (Docs embed the macro's expansion value.)
        expect(String(macro_a?.documentation)).not.toContain('from_child');
    });

    it('completion keeps current-file macro when directives route through get_visible_symbols_at', async () => {
        // Exercises the has_directives branch in CompletionProvider.get_completions:
        // get_visible_symbols_at already resolves forward-call precedence, so the
        // completion provider must NOT re-overlay the annotated forward symbols
        // on top (that would make forward-call values win a second time).
        const parent_path = join(test_temp_dir, 'parent.do');
        writeFileSync(parent_path, '* parent file\n');

        const child_path = join(test_temp_dir, 'child.do');
        writeFileSync(child_path, 'local a "from_child"\n');

        const main_path = join(test_temp_dir, 'main.do');
        const main_content =
            '// @lsp-done-by: "parent.do"\n' +
            'local a "from_main_early"\n' +
            'include "child.do"\n' +
            'local a "from_main_late"\n' +
            'display "`a\'"\n';
        writeFileSync(main_path, main_content);

        const main_uri = URI.file(main_path).toString();
        await pipeline.document_store.open(main_uri, main_content, 1);
        const document_state = pipeline.document_store.get(main_uri)!;

        const completions = await pipeline.completion_provider.get_completions(
            document_state,
            { line: 4, character: main_content.split('\n')[4].indexOf('`a') + 1 },
            undefined,
            pipeline.scope_resolver,
        );

        const macro_a = completions.find(item => item.label === 'a');
        expect(macro_a).toBeDefined();
        // Without the fix, the double-overlay lets the forward-call version
        // win again and the doc shows "from_child". After the fix, the
        // current file's definition wins; the completion item embeds the
        // primary `local a` expansion (matching the sibling workspace test).
        expect(String(macro_a?.documentation)).not.toContain('from_child');
        expect(String(macro_a?.documentation)).toContain('from_main_early');
    });

    it('completion resolves a same-name global macro to the later visible forward callee', async () => {
        const first_path = join(test_temp_dir, 'first.do');
        writeFileSync(first_path, 'global SHARED "from_first"\n');

        const second_path = join(test_temp_dir, 'second.do');
        writeFileSync(second_path, 'global SHARED "from_second"\n');

        const workspace_uri = URI.file(join(test_temp_dir, 'workspace.do')).toString();
        const workspace_symbols: SymbolTable = {
            ...create_empty_symbol_table(),
            globalMacros: new Map([[
                'SHARED',
                {
                    name: 'SHARED',
                    scope: 'global',
                    location: {
                        uri: workspace_uri,
                        range: {
                            start: { line: 0, character: 0 },
                            end: { line: 0, character: 6 },
                        },
                    },
                    sourceUri: workspace_uri,
                    value: 'workspace_value',
                },
            ]]),
        };

        const main_path = join(test_temp_dir, 'main.do');
        const main_content =
            'do "first.do"\n' +
            'do "second.do"\n' +
            'display $S\n';
        writeFileSync(main_path, main_content);

        const main_uri = URI.file(main_path).toString();
        await pipeline.document_store.open(main_uri, main_content, 1);
        const document_state = pipeline.document_store.get(main_uri)!;

        const completions = await pipeline.completion_provider.get_completions(
            document_state,
            { line: 2, character: main_content.split('\n')[2].length },
            undefined,
            pipeline.scope_resolver,
            workspace_symbols,
        );

        const shared = completions.find(item => item.label === 'SHARED');
        expect(shared).toBeDefined();
        expect(shared?.detail).toContain('second.do');
        expect(String(shared?.documentation)).toContain('from_second');
    });
});
