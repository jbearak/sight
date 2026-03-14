/**
 * Integration tests for auto backward dependency resolution.
 *
 * Tests the full pipeline: workspace scan → DependencyGraph → ScopeResolver
 * auto-discovers parent files → undefined symbol diagnostics suppressed.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ScopeResolver } from '../../src/scope-resolver';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';
import { DependencyGraph } from '../../src/dependency-graph';
import { DiagnosticsProvider } from '../../src/providers/diagnostics';
import { WorkspaceIndexer } from '../../src/indexer';
import { URI } from 'vscode-uri';
import { create_empty_symbol_table } from '../../src/analyzer';

let tmp_dir: string;

function create_tmp_dir(): string {
    return fs.mkdtempSync(
        path.join(os.tmpdir(), 'auto-backward-test-')
    );
}

function write_file(dir: string, name: string, content: string): string {
    const file_path = path.join(dir, name);
    fs.writeFileSync(file_path, content, 'utf8');
    return file_path;
}

function create_scope_resolver(): ScopeResolver {
    return new ScopeResolver(undefined, {
        read_file: async (uri: string) => {
            return fs.promises.readFile(
                URI.parse(uri).fsPath,
                'utf8'
            );
        },
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
                const stats = await fs.promises.stat(
                    URI.parse(uri).fsPath
                );
                return { mtimeMs: stats.mtimeMs, size: stats.size };
            } catch {
                return undefined;
            }
        },
    });
}

describe('Auto Backward Resolution', () => {
    beforeEach(() => {
        tmp_dir = create_tmp_dir();
    });

    afterEach(() => {
        fs.rmSync(tmp_dir, { recursive: true, force: true });
    });

    describe('basic auto-discovery', () => {
        it('should auto-discover parent that calls child via do', async () => {
            // parent.do defines a global and calls child.do
            write_file(tmp_dir, 'parent.do', [
                'global my_global "hello"',
                'do child.do',
            ].join('\n'));

            // child.do references the global (no directives)
            const child_path = write_file(tmp_dir, 'child.do', [
                'display $my_global',
            ].join('\n'));
            const child_uri = URI.file(child_path).toString();
            const child_content = fs.readFileSync(child_path, 'utf8');

            // Set up dependency graph via workspace indexer
            const graph = new DependencyGraph();
            const indexer = new WorkspaceIndexer();
            indexer.set_dependency_graph(graph);
            await indexer.initialize([tmp_dir]);

            expect(graph.is_scan_complete()).toBe(true);

            // Verify graph has the edge
            const the_parents = graph.get_parents(child_uri);
            expect(the_parents).toHaveLength(1);
            expect(the_parents[0].call_type).toBe('do');

            // Resolve scope for child with auto mode
            const resolver = create_scope_resolver();
            resolver.set_dependency_graph(graph);
            const forward_resolver = new ForwardScopeResolver(resolver);
            resolver.set_forward_scope_resolver(forward_resolver);

            const scope = await resolver.resolve(
                child_uri,
                child_content,
                { backward_dependencies: 'auto' }
            );

            // Should have auto parents
            expect(scope.has_auto_parents).toBe(true);
            expect(scope.has_directives).toBe(false);

            // Should have parent's global in scope
            expect(scope.symbols.globalMacros.has('my_global')).toBe(true);
        });

        it('should auto-discover parent that calls child via include', async () => {
            write_file(tmp_dir, 'parent.do', [
                'local my_local "world"',
                'include child.do',
            ].join('\n'));

            const child_path = write_file(tmp_dir, 'child.do', [
                'display `my_local\'',
            ].join('\n'));
            const child_uri = URI.file(child_path).toString();
            const child_content = fs.readFileSync(child_path, 'utf8');

            const graph = new DependencyGraph();
            const indexer = new WorkspaceIndexer();
            indexer.set_dependency_graph(graph);
            await indexer.initialize([tmp_dir]);

            const the_parents = graph.get_parents(child_uri);
            expect(the_parents).toHaveLength(1);
            expect(the_parents[0].call_type).toBe('include');

            const resolver = create_scope_resolver();
            resolver.set_dependency_graph(graph);
            const forward_resolver = new ForwardScopeResolver(resolver);
            resolver.set_forward_scope_resolver(forward_resolver);

            const scope = await resolver.resolve(
                child_uri,
                child_content,
                { backward_dependencies: 'auto' }
            );

            expect(scope.has_auto_parents).toBe(true);
            // include → included-by → local macros inherited
            expect(scope.symbols.localMacros.has('my_local')).toBe(true);
        });

        it('should map do/run to done-by (no local macros)', async () => {
            write_file(tmp_dir, 'parent.do', [
                'local parent_local "no"',
                'global parent_global "yes"',
                'do child.do',
            ].join('\n'));

            const child_path = write_file(tmp_dir, 'child.do', [
                'display "test"',
            ].join('\n'));
            const child_uri = URI.file(child_path).toString();
            const child_content = fs.readFileSync(child_path, 'utf8');

            const graph = new DependencyGraph();
            const indexer = new WorkspaceIndexer();
            indexer.set_dependency_graph(graph);
            await indexer.initialize([tmp_dir]);

            const resolver = create_scope_resolver();
            resolver.set_dependency_graph(graph);
            const forward_resolver = new ForwardScopeResolver(resolver);
            resolver.set_forward_scope_resolver(forward_resolver);

            const scope = await resolver.resolve(
                child_uri,
                child_content,
                { backward_dependencies: 'auto' }
            );

            // do → done-by: globals inherited, locals not
            expect(scope.symbols.globalMacros.has('parent_global'))
                .toBe(true);
            expect(scope.symbols.localMacros.has('parent_local'))
                .toBe(false);
        });
    });

    describe('per-file opt-out', () => {
        it('should use explicit directives when present (not auto)', async () => {
            // parent_a defines global_a and calls child
            write_file(tmp_dir, 'parent_a.do', [
                'global from_a "hello"',
                'do child.do',
            ].join('\n'));

            // parent_b defines global_b — child explicitly declares parent_b
            const parent_b_path = write_file(tmp_dir, 'parent_b.do', [
                'global from_b "world"',
            ].join('\n'));

            // child.do has explicit @lsp-done-by parent_b.do
            const child_path = write_file(tmp_dir, 'child.do', [
                `// @lsp-done-by "${parent_b_path}"`,
                'display $from_b',
            ].join('\n'));
            const child_uri = URI.file(child_path).toString();
            const child_content = fs.readFileSync(child_path, 'utf8');

            const graph = new DependencyGraph();
            const indexer = new WorkspaceIndexer();
            indexer.set_dependency_graph(graph);
            await indexer.initialize([tmp_dir]);

            const resolver = create_scope_resolver();
            resolver.set_dependency_graph(graph);
            const forward_resolver = new ForwardScopeResolver(resolver);
            resolver.set_forward_scope_resolver(forward_resolver);

            const scope = await resolver.resolve(
                child_uri,
                child_content,
                { backward_dependencies: 'auto' }
            );

            // Should use directive mode, not auto
            expect(scope.has_directives).toBe(true);
            expect(scope.has_auto_parents).toBe(false);

            // Should have parent_b's symbol, not parent_a's
            expect(scope.symbols.globalMacros.has('from_b')).toBe(true);
            expect(scope.symbols.globalMacros.has('from_a')).toBe(false);
        });
    });

    describe('explicit mode', () => {
        it('should disable auto-discovery when backward_dependencies=explicit', async () => {
            write_file(tmp_dir, 'parent.do', [
                'global my_global "hello"',
                'do child.do',
            ].join('\n'));

            const child_path = write_file(tmp_dir, 'child.do', [
                'display $my_global',
            ].join('\n'));
            const child_uri = URI.file(child_path).toString();
            const child_content = fs.readFileSync(child_path, 'utf8');

            const graph = new DependencyGraph();
            const indexer = new WorkspaceIndexer();
            indexer.set_dependency_graph(graph);
            await indexer.initialize([tmp_dir]);

            // Graph has the edge
            expect(graph.get_parents(child_uri)).toHaveLength(1);

            const resolver = create_scope_resolver();
            resolver.set_dependency_graph(graph);
            const forward_resolver = new ForwardScopeResolver(resolver);
            resolver.set_forward_scope_resolver(forward_resolver);

            // But with explicit mode, auto-discovery is disabled
            const scope = await resolver.resolve(
                child_uri,
                child_content,
                { backward_dependencies: 'explicit' }
            );

            expect(scope.has_auto_parents).toBe(false);
            expect(scope.has_directives).toBe(false);
            expect(scope.symbols.globalMacros.has('my_global'))
                .toBe(false);
        });
    });

    describe('call-site filtering', () => {
        it('should only inherit symbols defined before call site', async () => {
            write_file(tmp_dir, 'parent.do', [
                'global before_call "yes"',
                'do child.do',
                'global after_call "no"',
            ].join('\n'));

            const child_path = write_file(tmp_dir, 'child.do', [
                'display "test"',
            ].join('\n'));
            const child_uri = URI.file(child_path).toString();
            const child_content = fs.readFileSync(child_path, 'utf8');

            const graph = new DependencyGraph();
            const indexer = new WorkspaceIndexer();
            indexer.set_dependency_graph(graph);
            await indexer.initialize([tmp_dir]);

            const resolver = create_scope_resolver();
            resolver.set_dependency_graph(graph);
            const forward_resolver = new ForwardScopeResolver(resolver);
            resolver.set_forward_scope_resolver(forward_resolver);

            const scope = await resolver.resolve(
                child_uri,
                child_content,
                { backward_dependencies: 'auto' }
            );

            // Symbol before call site should be in scope
            expect(scope.symbols.globalMacros.has('before_call'))
                .toBe(true);
            // Symbol after call site should be out of scope
            expect(scope.symbols.globalMacros.has('after_call'))
                .toBe(false);
        });
    });

    describe('multiple parents', () => {
        it('should handle multiple auto-discovered parents', async () => {
            write_file(tmp_dir, 'parent_a.do', [
                'global from_a "hello"',
                'do child.do',
            ].join('\n'));

            write_file(tmp_dir, 'parent_b.do', [
                'global from_b "world"',
                'include child.do',
            ].join('\n'));

            const child_path = write_file(tmp_dir, 'child.do', [
                'display "test"',
            ].join('\n'));
            const child_uri = URI.file(child_path).toString();
            const child_content = fs.readFileSync(child_path, 'utf8');

            const graph = new DependencyGraph();
            const indexer = new WorkspaceIndexer();
            indexer.set_dependency_graph(graph);
            await indexer.initialize([tmp_dir]);

            expect(graph.get_parents(child_uri)).toHaveLength(2);

            const resolver = create_scope_resolver();
            resolver.set_dependency_graph(graph);
            const forward_resolver = new ForwardScopeResolver(resolver);
            resolver.set_forward_scope_resolver(forward_resolver);

            const scope = await resolver.resolve(
                child_uri,
                child_content,
                { backward_dependencies: 'auto' }
            );

            expect(scope.has_auto_parents).toBe(true);
            expect(scope.symbols.globalMacros.has('from_a')).toBe(true);
            expect(scope.symbols.globalMacros.has('from_b')).toBe(true);
        });
    });

    describe('diagnostic deferral', () => {
        it('should not set has_auto_parents when scan is incomplete and no parents found yet', async () => {
            const child_path = write_file(tmp_dir, 'child.do', [
                'display $my_global',
            ].join('\n'));
            const child_uri = URI.file(child_path).toString();
            const child_content = fs.readFileSync(child_path, 'utf8');

            // Graph not yet scanned
            const graph = new DependencyGraph();
            expect(graph.is_scan_complete()).toBe(false);

            const resolver = create_scope_resolver();
            resolver.set_dependency_graph(graph);

            const scope = await resolver.resolve(
                child_uri,
                child_content,
                { backward_dependencies: 'auto' }
            );

            // No parents found yet, has_auto_parents should be false
            expect(scope.has_auto_parents).toBe(false);
            expect(scope.has_directives).toBe(false);
        });
    });

    describe('workspace indexer integration', () => {
        it('should populate graph during workspace scan', async () => {
            write_file(tmp_dir, 'a.do', [
                'do b.do',
                'include c.do',
            ].join('\n'));
            write_file(tmp_dir, 'b.do', 'display "b"');
            write_file(tmp_dir, 'c.do', 'display "c"');

            const graph = new DependencyGraph();
            const indexer = new WorkspaceIndexer();
            indexer.set_dependency_graph(graph);
            await indexer.initialize([tmp_dir]);

            const a_uri = URI.file(
                path.join(tmp_dir, 'a.do')
            ).toString();
            const b_uri = URI.file(
                path.join(tmp_dir, 'b.do')
            ).toString();
            const c_uri = URI.file(
                path.join(tmp_dir, 'c.do')
            ).toString();

            expect(graph.get_callees(a_uri).size).toBe(2);
            expect(graph.get_parents(b_uri)).toHaveLength(1);
            expect(graph.get_parents(b_uri)[0].call_type).toBe('do');
            expect(graph.get_parents(c_uri)).toHaveLength(1);
            expect(graph.get_parents(c_uri)[0].call_type).toBe('include');
            expect(graph.is_scan_complete()).toBe(true);
        });

        it('should remove edges when file is removed', async () => {
            write_file(tmp_dir, 'a.do', 'do b.do');
            write_file(tmp_dir, 'b.do', 'display "b"');

            const graph = new DependencyGraph();
            const indexer = new WorkspaceIndexer();
            indexer.set_dependency_graph(graph);
            await indexer.initialize([tmp_dir]);

            const b_uri = URI.file(
                path.join(tmp_dir, 'b.do')
            ).toString();
            expect(graph.get_parents(b_uri)).toHaveLength(1);

            indexer.remove_file(path.join(tmp_dir, 'a.do'));
            expect(graph.get_parents(b_uri)).toHaveLength(0);
        });
    });

    describe('config wiring', () => {
        it('should default backward_dependencies to auto', async () => {
            // Resolve with no backward_dependencies in config (uses default)
            write_file(tmp_dir, 'parent.do', [
                'global my_global "hello"',
                'do child.do',
            ].join('\n'));
            const child_path = write_file(tmp_dir, 'child.do', [
                'display $my_global',
            ].join('\n'));
            const child_uri = URI.file(child_path).toString();
            const child_content = fs.readFileSync(child_path, 'utf8');

            const graph = new DependencyGraph();
            const indexer = new WorkspaceIndexer();
            indexer.set_dependency_graph(graph);
            await indexer.initialize([tmp_dir]);

            const resolver = create_scope_resolver();
            resolver.set_dependency_graph(graph);
            const forward_resolver = new ForwardScopeResolver(resolver);
            resolver.set_forward_scope_resolver(forward_resolver);

            // No backward_dependencies in config → defaults to auto
            const scope = await resolver.resolve(
                child_uri,
                child_content,
                {}
            );

            expect(scope.has_auto_parents).toBe(true);
            expect(scope.symbols.globalMacros.has('my_global')).toBe(true);
        });
    });
});
