import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { create_shared_ihlp_resolver } from '../../src/server-handlers';
import type { HandlerDependencies } from '../../src/server-handlers';

interface FakeIndexer {
    resolve_ihlp_file(name: string): Promise<string | null>;
}

function make_deps(the_map: Map<string, string>): HandlerDependencies {
    const fake_indexer: FakeIndexer = {
        async resolve_ihlp_file(name: string) {
            return the_map.get(name) ?? null;
        },
    };
    return {
        workspace_indexer: fake_indexer,
    } as unknown as HandlerDependencies;
}

describe('create_shared_ihlp_resolver', () => {
    let tmp_dir: string;
    const the_files: string[] = [];

    beforeEach(() => {
        tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ihlp-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmp_dir, { recursive: true, force: true });
        the_files.length = 0;
    });

    test('cache hit returns cached content without re-reading', async () => {
        const my_path = path.join(tmp_dir, 'a.ihlp');
        fs.writeFileSync(my_path, 'original');
        const past_time = new Date(Date.now() - 60_000);
        fs.utimesSync(my_path, past_time, past_time);

        const the_map = new Map<string, string>([['a', my_path]]);
        const { resolver, cache } = create_shared_ihlp_resolver(
            make_deps(the_map)
        );

        const r1 = await resolver('a');
        expect(r1?.content).toBe('original');
        expect(cache.size).toBe(1);

        // Mutate file content but keep mtime unchanged.
        fs.writeFileSync(my_path, 'changed');
        fs.utimesSync(my_path, past_time, past_time);

        const r2 = await resolver('a');
        expect(r2?.content).toBe('original');
    });

    test('mtime change invalidates cache', async () => {
        const my_path = path.join(tmp_dir, 'b.ihlp');
        fs.writeFileSync(my_path, 'v1');
        const t0 = new Date(Date.now() - 60_000);
        fs.utimesSync(my_path, t0, t0);

        const the_map = new Map<string, string>([['b', my_path]]);
        const { resolver } = create_shared_ihlp_resolver(make_deps(the_map));

        const r1 = await resolver('b');
        expect(r1?.content).toBe('v1');

        fs.writeFileSync(my_path, 'v2');
        const t1 = new Date(Date.now() + 60_000);
        fs.utimesSync(my_path, t1, t1);

        const r2 = await resolver('b');
        expect(r2?.content).toBe('v2');
    });

    test('LRU eviction: hit on A keeps A, evicts B (least recently used)',
    async () => {
        const make = (name: string, content: string) => {
            const p = path.join(tmp_dir, `${name}.ihlp`);
            fs.writeFileSync(p, content);
            return p;
        };
        const pa = make('a', 'A');
        const pb = make('b', 'B');
        const pc = make('c', 'C');
        const pd = make('d', 'D');

        const the_map = new Map<string, string>([
            ['a', pa], ['b', pb], ['c', pc], ['d', pd],
        ]);
        const { resolver, cache } = create_shared_ihlp_resolver(
            make_deps(the_map),
            3
        );

        await resolver('a');
        await resolver('b');
        await resolver('c');
        // Access A so B becomes least-recently-used.
        await resolver('a');
        // Insert D, should evict B.
        await resolver('d');

        expect(cache.size).toBe(3);
        expect(cache.has(pa)).toBe(true);
        expect(cache.has(pb)).toBe(false);
        expect(cache.has(pc)).toBe(true);
        expect(cache.has(pd)).toBe(true);
    });

    test('cache value shape includes content and mtime_ms', async () => {
        const my_path = path.join(tmp_dir, 'e.ihlp');
        fs.writeFileSync(my_path, 'hello');

        const the_map = new Map<string, string>([['e', my_path]]);
        const { resolver, cache } = create_shared_ihlp_resolver(
            make_deps(the_map)
        );
        await resolver('e');

        const my_entry = cache.get(my_path);
        expect(my_entry).toBeDefined();
        expect(my_entry?.content).toBe('hello');
        expect(typeof my_entry?.mtime_ms).toBe('number');
    });
});
