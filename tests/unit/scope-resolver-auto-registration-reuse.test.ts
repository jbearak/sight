/**
 * A file with no directives of its own takes its backward edges from the
 * dependency graph. A file called by many files is re-registered on every
 * cache hit, and each registration resolves every parent's path with a
 * case-aware walk that lists directories. `sight check` turns on reuse:
 * while the graph is unchanged the result is too, so the repeat is
 * skipped; a graph change redoes it. The language server leaves reuse
 * off, so a parent's on-disk spelling is read again every time.
 *
 * `create_listing_cache_resolve_fs` (also `sight check`) reuses a
 * directory's listing only while the directory is unchanged.
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
    create_listing_cache_resolve_fs,
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
        resolver.enable_auto_registration_reuse();
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
        resolver.enable_auto_registration_reuse();
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

    it('re-registers every time unless reuse is on', () => {
        const root = make_workspace(['Parent.do', 'child.do']);
        const uri = (name: string) =>
            URI.file(path.join(root, name)).toString();
        const graph = new DependencyGraph();
        graph.set_workspace_roots([root]);
        const resolver = new ScopeResolver();
        resolver.set_workspace_roots([root]);
        resolver.set_dependency_graph(graph);
        const counter = counting_fs();
        resolver.set_resolve_fs(counter.fs);
        graph.update_caller(
            uri('Parent.do'), [call_to(uri('Parent.do'), 'child.do')]);

        resolver.apply_backward_directive_registration(
            uri('child.do'), [], { backward_dependencies: 'auto' }, false);
        const after_first = counter.listings();
        resolver.apply_backward_directive_registration(
            uri('child.do'), [], { backward_dependencies: 'auto' }, false);
        expect(counter.listings()).toBeGreaterThan(after_first);

        // On a case-insensitive volume a case-only rename of the parent,
        // before the graph hears of it, moves the registration to the
        // spelling on disk at once.
        fs.renameSync(path.join(root, 'Parent.do'), path.join(root, 'PARENT.do'));
        const case_insensitive = fs.existsSync(path.join(root, 'Parent.do'));
        resolver.apply_backward_directive_registration(
            uri('child.do'), [], { backward_dependencies: 'auto' }, false);
        if (case_insensitive) {
            expect(resolver.get_backward_directive_children(uri('PARENT.do')))
                .toEqual(new Set([uri('child.do')]));
            expect(resolver.get_backward_directive_children(uri('Parent.do'))
                .size).toBe(0);
        }
    });
});

describe('create_listing_cache_resolve_fs', () => {
    it('reuses an unchanged listing and sees a new file at once', () => {
        const root = make_workspace(['a.do']);
        // Settled long ago, so the listing may be cached.
        const past = new Date(Date.now() - 60_000);
        fs.utimesSync(root, past, past);
        const listing = create_listing_cache_resolve_fs({ settle_ms: 0 });
        const first = listing.readdirSync(root, { withFileTypes: true });
        expect(listing.readdirSync(root, { withFileTypes: true }))
            .toBe(first);

        fs.writeFileSync(path.join(root, 'b.do'), '');
        const after = listing.readdirSync(root, { withFileTypes: true });
        expect(after.map((my_entry) => my_entry.name).sort())
            .toEqual(['a.do', 'b.do']);
    });

    it('does not cache a directory that changed moments ago', () => {
        const root = make_workspace(['a.do']);
        const listing = create_listing_cache_resolve_fs();
        const first = listing.readdirSync(root, { withFileTypes: true });
        expect(listing.readdirSync(root, { withFileTypes: true }))
            .not.toBe(first);
    });

    it('checks existence and stats on disk every time', () => {
        const root = make_workspace([]);
        const listing = create_listing_cache_resolve_fs({ settle_ms: 0 });
        const missing = path.join(root, 'missing');
        expect(listing.existsSync(missing)).toBe(false);
        expect(() => listing.statSync(missing)).toThrow();
        fs.mkdirSync(missing);
        expect(listing.existsSync(missing)).toBe(true);
        expect(listing.statSync(missing).isDirectory()).toBe(true);
        expect(() => listing.readdirSync(path.join(root, 'nope'),
            { withFileTypes: true })).toThrow();
    });
});
