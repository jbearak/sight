/**
 * Integration tests for the `sight: standalone` directive (issue #208).
 *
 * A header-only, no-argument marker that opts a file out of inherited
 * backward parent scope: auto-discovered parents, explicit backward
 * directives (ignored with a warning), inherited working directory, and —
 * per the cut-everywhere decision — the file's own ancestors when it is
 * walked as a mid-chain ancestor of another file's resolution. Forward
 * calls FROM the standalone file keep working unchanged.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ScopeResolver } from '../../src/scope-resolver';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';
import { DependencyGraph } from '../../src/dependency-graph';
import { WorkspaceIndexer } from '../../src/indexer';
import { URI } from 'vscode-uri';

let tmp_dir: string;

function create_tmp_dir(): string {
    return fs.mkdtempSync(
        path.join(os.tmpdir(), 'standalone-directive-test-')
    );
}

function write_file(dir: string, name: string, content: string): string {
    const file_path = path.join(dir, name);
    fs.mkdirSync(path.dirname(file_path), { recursive: true });
    fs.writeFileSync(file_path, content, 'utf8');
    return file_path;
}

function create_scope_resolver(): ScopeResolver {
    return new ScopeResolver(undefined, {
        read_file: async (uri: string) => {
            return fs.promises.readFile(URI.parse(uri).fsPath, 'utf8');
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
                const stats = await fs.promises.stat(URI.parse(uri).fsPath);
                return { mtimeMs: stats.mtimeMs, size: stats.size };
            } catch {
                return undefined;
            }
        },
    });
}

function create_resolver_with_forward(): ScopeResolver {
    const resolver = create_scope_resolver();
    const forward_resolver = new ForwardScopeResolver(resolver);
    resolver.set_forward_scope_resolver(forward_resolver);
    return resolver;
}

async function build_graph(dir: string): Promise<DependencyGraph> {
    const graph = new DependencyGraph();
    const indexer = new WorkspaceIndexer();
    indexer.set_dependency_graph(graph);
    await indexer.initialize([dir]);
    return graph;
}

describe('Standalone directive (issue #208)', () => {
    beforeEach(() => {
        tmp_dir = create_tmp_dir();
    });

    afterEach(() => {
        fs.rmSync(tmp_dir, { recursive: true, force: true });
    });

    describe('auto-discovered parents', () => {
        it('cuts auto-discovered parent scope for a standalone file', async () => {
            write_file(tmp_dir, 'parent.do', [
                'global my_global "hello"',
                'do child.do',
            ].join('\n'));
            const child_path = write_file(tmp_dir, 'child.do', [
                '// sight: standalone',
                'display $my_global',
            ].join('\n'));
            const child_uri = URI.file(child_path).toString();
            const child_content = fs.readFileSync(child_path, 'utf8');

            const graph = await build_graph(tmp_dir);
            // The dep-graph edge is a raw fact about the caller and must
            // exist regardless of the child's standalone marker.
            expect(graph.get_parents(child_uri)).toHaveLength(1);

            const resolver = create_resolver_with_forward();
            resolver.set_dependency_graph(graph);

            const scope = await resolver.resolve(
                child_uri, child_content, { backward_dependencies: 'auto' }
            );

            expect(scope.is_standalone).toBe(true);
            expect(scope.has_auto_parents).toBe(false);
            expect(scope.has_directives).toBe(false);
            expect(scope.chain).toHaveLength(1);
            expect(scope.symbols.globalMacros.has('my_global')).toBe(false);
        });

        it('control: without standalone the same file inherits the parent', async () => {
            write_file(tmp_dir, 'parent.do', [
                'global my_global "hello"',
                'do child.do',
            ].join('\n'));
            const child_path = write_file(tmp_dir, 'child.do', [
                'display $my_global',
            ].join('\n'));
            const child_uri = URI.file(child_path).toString();
            const child_content = fs.readFileSync(child_path, 'utf8');

            const graph = await build_graph(tmp_dir);
            const resolver = create_resolver_with_forward();
            resolver.set_dependency_graph(graph);

            const scope = await resolver.resolve(
                child_uri, child_content, { backward_dependencies: 'auto' }
            );

            expect(scope.is_standalone).toBe(false);
            expect(scope.has_auto_parents).toBe(true);
            expect(scope.symbols.globalMacros.has('my_global')).toBe(true);
        });
    });

    describe('explicit backward directives', () => {
        it('standalone wins over an explicit done-by, with one warning per ignored directive', async () => {
            const parent_path = write_file(tmp_dir, 'parent.do', [
                'global parent_global "yes"',
                'do child.do',
            ].join('\n'));
            const child_path = write_file(tmp_dir, 'child.do', [
                '// sight: standalone',
                `// sight: done-by: "${parent_path}"`,
                'display $parent_global',
            ].join('\n'));
            const child_uri = URI.file(child_path).toString();
            const child_content = fs.readFileSync(child_path, 'utf8');

            const resolver = create_resolver_with_forward();
            const scope = await resolver.resolve(child_uri, child_content);

            expect(scope.is_standalone).toBe(true);
            // The raw directive is still present textually …
            expect(scope.has_directives).toBe(true);
            // … but never followed.
            expect(scope.chain).toHaveLength(1);
            expect(scope.symbols.globalMacros.has('parent_global')).toBe(false);

            const the_ignored_warnings = scope.diagnostics.filter(
                d => d.message.includes('sight: standalone') &&
                     d.message.includes('done-by')
            );
            expect(the_ignored_warnings).toHaveLength(1);
            expect(the_ignored_warnings[0].severity).toBe('warning');
            // Anchored on the ignored directive's line (line 1).
            expect(the_ignored_warnings[0].range.start.line).toBe(1);
        });

        it('directive order does not matter: done-by before standalone is still ignored', async () => {
            const parent_path = write_file(tmp_dir, 'parent.do', [
                'global parent_global "yes"',
                'do child.do',
            ].join('\n'));
            const child_path = write_file(tmp_dir, 'child.do', [
                `// sight: done-by: "${parent_path}"`,
                '// sight: standalone',
                'display $parent_global',
            ].join('\n'));
            const child_uri = URI.file(child_path).toString();
            const child_content = fs.readFileSync(child_path, 'utf8');

            const resolver = create_resolver_with_forward();
            const scope = await resolver.resolve(child_uri, child_content);

            expect(scope.is_standalone).toBe(true);
            expect(scope.symbols.globalMacros.has('parent_global')).toBe(false);
            expect(scope.diagnostics.some(
                d => d.message.includes('sight: standalone')
            )).toBe(true);
        });
    });

    describe('mid-chain cut (cut-everywhere semantics)', () => {
        // D done-by P, P done-by C (standalone), C done-by G.
        // D inherits P's and C's OWN symbols but never G's.
        async function setup_chain(c_is_standalone: boolean) {
            const g_path = write_file(tmp_dir, 'g.do', [
                'global g_global "g"',
                'do c.do',
            ].join('\n'));
            const c_header = c_is_standalone
                ? ['// sight: standalone',
                   `// sight: done-by: "${g_path}"`]
                : [`// sight: done-by: "${g_path}"`];
            const c_path = write_file(tmp_dir, 'c.do', [
                ...c_header,
                'global c_global "c"',
                'do p.do',
            ].join('\n'));
            const p_path = write_file(tmp_dir, 'p.do', [
                `// sight: done-by: "${c_path}"`,
                'global p_global "p"',
                'do d.do',
            ].join('\n'));
            const d_path = write_file(tmp_dir, 'd.do', [
                `// sight: done-by: "${p_path}"`,
                'display $p_global $c_global $g_global',
            ].join('\n'));
            return {
                d_uri: URI.file(d_path).toString(),
                d_content: fs.readFileSync(d_path, 'utf8'),
                c_path,
            };
        }

        it('a standalone mid-chain ancestor contributes its own symbols but cuts its ancestors', async () => {
            const { d_uri, d_content } = await setup_chain(true);
            const resolver = create_resolver_with_forward();
            const scope = await resolver.resolve(d_uri, d_content);

            expect(scope.symbols.globalMacros.has('p_global')).toBe(true);
            expect(scope.symbols.globalMacros.has('c_global')).toBe(true);
            expect(scope.symbols.globalMacros.has('g_global')).toBe(false);
            // C itself is still in the chain (and thus in dependent_uris).
            expect(scope.chain.some(e => e.uri.endsWith('c.do'))).toBe(true);
            expect(scope.chain.some(e => e.uri.endsWith('g.do'))).toBe(false);
        });

        it('control: without standalone the grandparent symbols flow through', async () => {
            const { d_uri, d_content } = await setup_chain(false);
            const resolver = create_resolver_with_forward();
            const scope = await resolver.resolve(d_uri, d_content);

            expect(scope.symbols.globalMacros.has('g_global')).toBe(true);
        });

        it('a standalone ancestor\'s ignored-directive warning stays in that file, not descendants', async () => {
            const { d_uri, d_content, c_path } = await setup_chain(true);
            const resolver = create_resolver_with_forward();

            const d_scope = await resolver.resolve(d_uri, d_content);
            expect(d_scope.diagnostics.some(
                d => d.message.includes('sight: standalone')
            )).toBe(false);

            // C's own resolution DOES carry the warning.
            const c_uri = URI.file(c_path).toString();
            const c_content = fs.readFileSync(c_path, 'utf8');
            const c_scope = await resolver.resolve(c_uri, c_content);
            expect(c_scope.diagnostics.some(
                d => d.message.includes('sight: standalone')
            )).toBe(true);
        });
    });

    describe('working directory', () => {
        it('does not inherit a parent working directory', async () => {
            const wd_dir = path.join(tmp_dir, 'wd_target');
            fs.mkdirSync(wd_dir, { recursive: true });
            const parent_path = write_file(tmp_dir, 'parent.do', [
                `// sight: cd "${wd_dir}"`,
                'do child.do',
            ].join('\n'));
            const child_path = write_file(tmp_dir, 'child.do', [
                '// sight: standalone',
                `// sight: done-by: "${parent_path}"`,
                'display "hi"',
            ].join('\n'));
            const child_uri = URI.file(child_path).toString();
            const child_content = fs.readFileSync(child_path, 'utf8');

            const resolver = create_resolver_with_forward();
            const scope = await resolver.resolve(child_uri, child_content);
            expect(scope.inherited_working_directory).toBeUndefined();
        });

        it('keeps the standalone file\'s own working-directory directive', async () => {
            const wd_dir = path.join(tmp_dir, 'own_wd');
            fs.mkdirSync(wd_dir, { recursive: true });
            // Note: the cd path is script-relative (a leading / would mean
            // workspace-relative in directive syntax).
            const child_path = write_file(tmp_dir, 'child.do', [
                '// sight: standalone',
                '// sight: cd "own_wd"',
                'do data/sub.do',
            ].join('\n'));
            write_file(wd_dir, path.join('data', 'sub.do'),
                'global sub_global "s"\n');
            const child_uri = URI.file(child_path).toString();
            const child_content = fs.readFileSync(child_path, 'utf8');

            const resolver = create_resolver_with_forward();
            const scope = await resolver.resolve(child_uri, child_content);

            // Own WD applies: the forward call resolves under own_wd.
            expect(scope.forward_call_symbols).toBeDefined();
            expect(scope.forward_call_symbols!.some(
                cs => cs.callee_uri.includes('own_wd')
            )).toBe(true);
        });

        it('does not leak an earlier sibling parent\'s WD into a standalone parent\'s forward calls', async () => {
            // root has two backward parents at the same level: p1 (supplies
            // a WD) then p2 (standalone, no own WD). p2 forward-calls
            // data/sub.do, which exists only under p1's WD. Without the
            // sibling guard, p2's forward call would resolve via p1's WD.
            const wd_dir = path.join(tmp_dir, 'p1_wd');
            write_file(wd_dir, path.join('data', 'sub.do'),
                'global sub_global "s"\n');
            // Script-relative cd path (leading / means workspace-relative).
            const p1_path = write_file(tmp_dir, 'p1.do', [
                '// sight: cd "p1_wd"',
                'global p1_global "1"',
                'do root.do',
            ].join('\n'));
            const p2_path = write_file(tmp_dir, 'p2.do', [
                '// sight: standalone',
                'do data/sub.do',
                'global p2_global "2"',
                'do root.do',
            ].join('\n'));
            const root_path = write_file(tmp_dir, 'root.do', [
                `// sight: done-by: "${p1_path}"`,
                `// sight: done-by: "${p2_path}"`,
                'display $p1_global $p2_global',
            ].join('\n'));
            const root_uri = URI.file(root_path).toString();
            const root_content = fs.readFileSync(root_path, 'utf8');

            const resolver = create_resolver_with_forward();
            const scope = await resolver.resolve(root_uri, root_content);

            // Both parents' own symbols are inherited.
            expect(scope.symbols.globalMacros.has('p1_global')).toBe(true);
            expect(scope.symbols.globalMacros.has('p2_global')).toBe(true);
            // p2's forward call must NOT have resolved via p1's WD.
            expect(scope.symbols.globalMacros.has('sub_global')).toBe(false);
            // The root still inherits p1's WD (nearest non-standalone
            // parent) — the guard must not clear the level-wide value.
            expect(scope.inherited_working_directory).toBe(wd_dir);
        });
    });

    describe('forward calls from a standalone file', () => {
        it('keeps the standalone file\'s own do/run/include working', async () => {
            write_file(tmp_dir, 'sub.do', 'global sub_global "s"\n');
            const main_path = write_file(tmp_dir, 'main.do', [
                '// sight: standalone',
                'do sub.do',
                'display $sub_global',
            ].join('\n'));
            const main_uri = URI.file(main_path).toString();
            const main_content = fs.readFileSync(main_path, 'utf8');

            const resolver = create_resolver_with_forward();
            const scope = await resolver.resolve(main_uri, main_content);

            expect(scope.is_standalone).toBe(true);
            expect(scope.forward_call_symbols).toBeDefined();
            expect(scope.forward_call_symbols!.some(
                cs => cs.symbols.globalMacros.has('sub_global')
            )).toBe(true);
        });
    });

    describe('cache invalidation on toggling', () => {
        // D done-by C, C done-by G. Toggle standalone on mid-chain C and
        // verify D's cached resolution is invalidated through BOTH
        // invalidation entry points.
        async function setup_toggle_chain() {
            const g_path = write_file(tmp_dir, 'g.do', [
                'global g_global "g"',
                'do c.do',
            ].join('\n'));
            const c_path = write_file(tmp_dir, 'c.do', [
                `// sight: done-by: "${g_path}"`,
                'global c_global "c"',
                'do d.do',
            ].join('\n'));
            const d_path = write_file(tmp_dir, 'd.do', [
                `// sight: done-by: "${c_path}"`,
                'display $c_global $g_global',
            ].join('\n'));
            return { g_path, c_path, d_path };
        }

        function standalone_c_content(g_path: string): string {
            return [
                '// sight: standalone',
                `// sight: done-by: "${g_path}"`,
                'global c_global "c"',
                'do d.do',
            ].join('\n');
        }

        it('invalidate_file_cache path (watcher/close)', async () => {
            const { g_path, c_path, d_path } = await setup_toggle_chain();
            const d_uri = URI.file(d_path).toString();
            const c_uri = URI.file(c_path).toString();
            const d_content = fs.readFileSync(d_path, 'utf8');

            const resolver = create_resolver_with_forward();
            const before = await resolver.resolve(d_uri, d_content);
            expect(before.symbols.globalMacros.has('g_global')).toBe(true);

            fs.writeFileSync(c_path, standalone_c_content(g_path), 'utf8');
            resolver.invalidate_file_cache(c_uri);

            const after = await resolver.resolve(d_uri, d_content);
            expect(after.symbols.globalMacros.has('g_global')).toBe(false);
            expect(after.symbols.globalMacros.has('c_global')).toBe(true);
        });

        it('invalidate_scope_cache path (didChange)', async () => {
            const { g_path, c_path, d_path } = await setup_toggle_chain();
            const d_uri = URI.file(d_path).toString();
            const c_uri = URI.file(c_path).toString();
            const d_content = fs.readFileSync(d_path, 'utf8');

            const resolver = create_resolver_with_forward();
            const before = await resolver.resolve(d_uri, d_content);
            expect(before.symbols.globalMacros.has('g_global')).toBe(true);

            fs.writeFileSync(c_path, standalone_c_content(g_path), 'utf8');
            resolver.invalidate_scope_cache(c_uri);

            const after = await resolver.resolve(d_uri, d_content);
            expect(after.symbols.globalMacros.has('g_global')).toBe(false);
            expect(after.symbols.globalMacros.has('c_global')).toBe(true);
        });
    });

    describe('backward-directive registration', () => {
        it('a standalone child registers no backward edges (effective = empty)', async () => {
            const parent_path = write_file(tmp_dir, 'parent.do',
                'global x "1"\n');
            const child_path = write_file(tmp_dir, 'child.do', [
                '// sight: standalone',
                `// sight: done-by: "${parent_path}"`,
                'display "hi"',
            ].join('\n'));
            const parent_uri = URI.file(parent_path).toString();
            const child_uri = URI.file(child_path).toString();
            const child_content = fs.readFileSync(child_path, 'utf8');

            const resolver = create_scope_resolver();
            const parse = resolver['directive_parser'].parse(
                child_content, child_uri
            );

            // Control: non-standalone registration creates the edge.
            resolver.apply_backward_directive_registration(
                child_uri, parse.directives, {}, false
            );
            expect(
                resolver.get_backward_directive_children(parent_uri)
                    .has(child_uri)
            ).toBe(true);

            // Standalone registration clears it (effective directives are
            // empty; clear-then-register registers nothing).
            resolver.apply_backward_directive_registration(
                child_uri, parse.directives, {}, true
            );
            expect(
                resolver.get_backward_directive_children(parent_uri)
                    .has(child_uri)
            ).toBe(false);
        });
    });
});
