/**
 * A file with no directives of its own takes its backward edges from the
 * dependency graph. A file called by many files is re-registered on every
 * cache hit, and each registration resolves every parent's path with a
 * case-aware walk that lists directories. While the graph is unchanged
 * the result is too, so the repeat is skipped; a graph change redoes it.
 *
 * `create_snapshot_resolve_fs` (used by `sight check`) lists each
 * directory once per run.
 */

import { describe, it, expect, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { URI } from 'vscode-uri';
import { ScopeResolver } from '../../src/scope-resolver';
import { DependencyGraph } from '../../src/dependency-graph';
import type { ForwardCall } from '../../src/types';
import {
    create_snapshot_resolve_fs,
    type RichResolveFs,
} from '../../src/utils/file-path-utils';

let tmp_dir: string | undefined;

afterEach(() => {
    if (tmp_dir) {
        fs.rmSync(tmp_dir, { recursive: true, force: true });
        tmp_dir = undefined;
    }
});

function make_workspace(the_names: string[]): string {
    tmp_dir = fs.realpathSync(
        fs.mkdtempSync(path.join(os.tmpdir(), 'auto-registration-')));
    for (const my_name of the_names) {
        fs.writeFileSync(path.join(tmp_dir, my_name), '');
    }
    return tmp_dir;
}

function call_to(caller_uri: string, raw_path: string): ForwardCall {
    return {
        type: 'do',
        raw_path,
        call_site_line: 0,
        range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 10 },
        },
        source: 'command',
        is_static: true,
        caller_uri,
    };
}

/** Node fs that counts directory listings. */
function counting_fs(): { fs: RichResolveFs; listings: () => number } {
    let listings = 0;
    return {
        fs: {
            readdirSync: (p, opts) => {
                listings++;
                return fs.readdirSync(p, opts);
            },
            existsSync: (p) => fs.existsSync(p),
            statSync: (p) => fs.statSync(p),
        },
        listings: () => listings,
    };
}

describe('auto-discovered backward registration reuse', () => {
    it('skips an unchanged re-registration and redoes a changed one', () => {
        const root = make_workspace(['p1.do', 'p2.do', 'child.do']);
        const uri = (name: string) =>
            URI.file(path.join(root, name)).toString();
        const graph = new DependencyGraph();
        graph.set_workspace_roots([root]);
        const resolver = new ScopeResolver();
        resolver.set_workspace_roots([root]);
        resolver.set_dependency_graph(graph);
        const counter = counting_fs();
        resolver.set_resolve_fs(counter.fs);
        graph.update_caller(uri('p1.do'), [call_to(uri('p1.do'), 'child.do')]);

        resolver.apply_backward_directive_registration(
            uri('child.do'), [], { backward_dependencies: 'auto' }, false);
        expect(resolver.get_backward_directive_children(uri('p1.do')))
            .toEqual(new Set([uri('child.do')]));
        const after_first = counter.listings();
        expect(after_first).toBeGreaterThan(0);

        resolver.apply_backward_directive_registration(
            uri('child.do'), [], { backward_dependencies: 'auto' }, false);
        expect(counter.listings()).toBe(after_first);

        graph.update_caller(uri('p2.do'), [call_to(uri('p2.do'), 'child.do')]);
        resolver.apply_backward_directive_registration(
            uri('child.do'), [], { backward_dependencies: 'auto' }, false);
        expect(counter.listings()).toBeGreaterThan(after_first);
        expect(resolver.get_backward_directive_children(uri('p2.do')))
            .toEqual(new Set([uri('child.do')]));
    });

    it('redoes the registration after another one replaced it', () => {
        const root = make_workspace(['p1.do', 'other.do', 'child.do']);
        const uri = (name: string) =>
            URI.file(path.join(root, name)).toString();
        const graph = new DependencyGraph();
        graph.set_workspace_roots([root]);
        const resolver = new ScopeResolver();
        resolver.set_workspace_roots([root]);
        resolver.set_dependency_graph(graph);
        graph.update_caller(uri('p1.do'), [call_to(uri('p1.do'), 'child.do')]);

        resolver.apply_backward_directive_registration(
            uri('child.do'), [], { backward_dependencies: 'auto' }, false);
        // An explicit registration replaces the auto-discovered edges.
        resolver.apply_backward_directive_registration(
            uri('child.do'), [], { backward_dependencies: 'explicit' }, false);
        expect(resolver.get_backward_directive_children(uri('p1.do')).size)
            .toBe(0);
        // The graph has not changed, but the edges must come back.
        resolver.apply_backward_directive_registration(
            uri('child.do'), [], { backward_dependencies: 'auto' }, false);
        expect(resolver.get_backward_directive_children(uri('p1.do')))
            .toEqual(new Set([uri('child.do')]));
    });
});

describe('create_snapshot_resolve_fs', () => {
    it('lists, stats, and checks each path once, failures included', () => {
        const root = make_workspace(['a.do']);
        const snapshot = create_snapshot_resolve_fs();
        const first = snapshot.readdirSync(root, { withFileTypes: true });
        fs.writeFileSync(path.join(root, 'b.do'), '');
        expect(snapshot.readdirSync(root, { withFileTypes: true }))
            .toBe(first);
        expect(first.map((my_entry) => my_entry.name)).toEqual(['a.do']);

        const missing = path.join(root, 'missing');
        expect(snapshot.existsSync(missing)).toBe(false);
        expect(() => snapshot.statSync(missing)).toThrow();
        fs.mkdirSync(missing);
        expect(snapshot.existsSync(missing)).toBe(false);
        expect(() => snapshot.statSync(missing)).toThrow();
        expect(() => snapshot.readdirSync(path.join(root, 'nope'),
            { withFileTypes: true })).toThrow();
    });
});
