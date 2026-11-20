/**
 * `sight check` gives a file the working directory of the callers that
 * actually reach it, through any number of levels, and agrees with
 * `sight graph` on which calls are missing.
 *
 * A file with no `sight: cd` of its own runs in its caller's directory.
 * The caller's own calls resolve against the directory it inherited in
 * turn, so a grandchild is only found once its parent's calls land in
 * the inherited directory. `check` used to pass a directory down one
 * level only and reported `c.do` missing below.
 */

import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { run_check_with_cwd } from '../../src/cli/check';
import { run_graph_with_cwd } from '../../src/cli/graph';

interface MissingCalls {
    /** Calls in a file that `check` cannot find, as `path:line`. */
    check: string[];
    /** Calls `graph` lists as missing, as `path:line`. */
    graph: string[];
    /**
     * Calls `check` cannot find in a file it reaches by walking forward
     * from a caller, reported at the caller's call. `graph` keeps one
     * directory per file, so it has no counterpart for these.
     */
    nested: string[];
}

/** Write `files` to a new workspace and return its root. */
function write_workspace(files: Record<string, string>): string {
    const root = fs.realpathSync(
        fs.mkdtempSync(path.join(os.tmpdir(), 'sight-check-inherit-wd-')));
    for (const [my_name, my_text] of Object.entries(files)) {
        const my_path = path.join(root, my_name);
        fs.mkdirSync(path.dirname(my_path), { recursive: true });
        fs.writeFileSync(my_path, my_text);
    }
    return root;
}

/**
 * The calls `check` reports missing and the calls `graph` lists as
 * missing, each as sorted `path:line` strings.
 */
async function missing_calls(
    files: Record<string, string>,
): Promise<MissingCalls> {
    const root = write_workspace(files);
    try {
        const check_stdout: string[] = [];
        await run_check_with_cwd(
            ['--no-config', '--format', 'json', '.'], root, {
                stdout: (text) => check_stdout.push(text),
                stderr: () => undefined,
            });
        const the_records: Array<{
            path: string;
            diagnostic: {
                code: string;
                message: string;
                range: { start: { line: number } };
            };
        }> = JSON.parse(check_stdout.join(''));
        const the_missing = the_records.filter((my_record) =>
            my_record.diagnostic.code === 'CROSS_FILE_MISSING_FILE');
        const location = (my_record: (typeof the_records)[number]) =>
            `${my_record.path}:${my_record.diagnostic.range.start.line + 1}`;
        const check = the_missing
            .filter((my_record) =>
                my_record.diagnostic.message.startsWith('Cannot read file:'))
            .map(location)
            .sort();
        const nested = the_missing
            .filter((my_record) =>
                !my_record.diagnostic.message.startsWith('Cannot read file:'))
            .map(location)
            .sort();

        const graph_stdout: string[] = [];
        const graph_code = await run_graph_with_cwd(
            ['--json', '--no-config', root], root, {
                stdout: (text) => graph_stdout.push(text),
                stderr: () => undefined,
            });
        expect(graph_code).toBe(0);
        const the_edges: Array<{
            caller: string;
            resolution: string;
            range: { start: { line: number } };
        }> = JSON.parse(graph_stdout.join('')).edges;
        const graph = the_edges
            .filter((my_edge) => my_edge.resolution === 'missing')
            .map((my_edge) =>
                `${my_edge.caller}:${my_edge.range.start.line + 1}`)
            .sort();
        return { check, graph, nested };
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

describe('sight check — working directory inherited through do-chains', () => {
    it('passes the directory down three levels', async () => {
        const result = await missing_calls({
            'main.do': '// sight: cd "work"\ndo jobs/a.do\n',
            'work/jobs/a.do': 'do jobs/b.do\n',
            'work/jobs/b.do': 'do c.do\n',
            'work/c.do': '',
        });
        expect(result).toEqual({ check: [], graph: [], nested: [] });
    });

    it('passes the directory down four levels', async () => {
        const result = await missing_calls({
            'main.do': '// sight: cd "work"\ndo jobs/a.do\n',
            'work/jobs/a.do': 'do jobs/b.do\n',
            'work/jobs/b.do': 'do jobs/c.do\n',
            'work/jobs/c.do': 'do d.do\n',
            'work/d.do': '',
        });
        expect(result).toEqual({ check: [], graph: [], nested: [] });
    });

    it('still reports a call that is missing', async () => {
        const result = await missing_calls({
            'main.do': '// sight: cd "work"\ndo jobs/a.do\n',
            'work/jobs/a.do': 'do jobs/b.do\n',
            // There is no c.do anywhere.
            'work/jobs/b.do': 'do c.do\n',
        });
        // Walking forward, the callers above report it too.
        expect(result).toEqual({
            check: ['work/jobs/b.do:1'],
            graph: ['work/jobs/b.do:1'],
            nested: ['main.do:1', 'work/jobs/a.do:1'],
        });
    });

    // Two callers run shared/x.do from different directories. The file
    // takes the directory of the first caller, in path order, whose
    // chain sets one: p1.do here. This is the rule an open document's
    // walk uses, and `sight graph` uses the same one. Walking forward
    // from each caller, `check` still runs x.do in that caller's own
    // directory, so it reports the caller whose run would fail.
    const TWO_CALLERS = {
        'p1.do': '// sight: cd "w1"\ndo ../shared/x.do\n',
        'p2.do': '// sight: cd "w2"\ndo ../shared/x.do\n',
        'shared/x.do': 'do jobs/y.do\n',
    };

    it('gives a file reached by two callers the first caller\'s directory', async () => {
        const result = await missing_calls({
            ...TWO_CALLERS,
            'w1/jobs/y.do': 'do z.do\n',
            'w1/z.do': '',
        });
        expect(result).toEqual({
            check: [],
            graph: [],
            nested: ['p2.do:1'],
        });
    });

    it('does not use the second caller\'s directory', async () => {
        const result = await missing_calls({
            ...TWO_CALLERS,
            'w2/jobs/y.do': 'do z.do\n',
            'w2/z.do': '',
        });
        // x.do runs in w1, so jobs/y.do is missing there, and y.do,
        // which nothing then reaches, looks for z.do next to itself.
        expect(result).toEqual({
            check: ['shared/x.do:1', 'w2/jobs/y.do:1'],
            graph: ['shared/x.do:1', 'w2/jobs/y.do:1'],
            nested: ['p1.do:1'],
        });
    });

    it('terminates on a cycle and still resolves its calls', async () => {
        const result = await missing_calls({
            'main.do': '// sight: cd "work"\ndo jobs/a.do\n',
            'work/jobs/a.do': 'do jobs/b.do\n',
            'work/jobs/b.do': 'do jobs/a.do\ndo c.do\n',
            'work/c.do': '',
        });
        expect(result).toEqual({ check: [], graph: [], nested: [] });
    });

    it('leaves a file nobody calls in its own directory', async () => {
        const result = await missing_calls({
            'main.do': '// sight: cd "work"\ndo jobs/a.do\n',
            'work/jobs/a.do': 'do c.do\n',
            'work/c.do': '',
            // Not called: `c.do` is looked for next to it, not in work/.
            'work/jobs/orphan.do': 'do c.do\n',
        });
        expect(result).toEqual({
            check: ['work/jobs/orphan.do:1'],
            graph: ['work/jobs/orphan.do:1'],
            nested: [],
        });
    });

    it('lets a mid-chain `sight: cd` override the inherited directory', async () => {
        const result = await missing_calls({
            'main.do': '// sight: cd "work"\ndo jobs/a.do\n',
            'work/jobs/a.do': '// sight: cd "/other"\ndo sub/b.do\n',
            'other/sub/b.do': 'do sub/c.do\n',
            'other/sub/c.do': 'do d.do\n',
            'other/d.do': '',
        });
        expect(result).toEqual({ check: [], graph: [], nested: [] });
    });

    // After the review of the first version of this change: a literal
    // `cd` moves the caller, and the backward walk an open file uses
    // reads only the caller's `sight: cd`. A call made after the `cd`
    // passes no directory on, so `check` keeps what it reported before.
    it('gives an unreachable file no directory through a literal cd', async () => {
        const result = await missing_calls({
            'main.do': '// sight: cd "bad"\ncd "../good"\ndo sub/a.do\n',
            'good/sub/a.do': 'do branch/b.do\n',
            'good/branch/b.do': 'display 1\n',
            'bad/branch/b.do': 'do lost.do\n',
            'bad/lost.do': 'display 1\n',
        });
        expect(result).toEqual({
            check: ['bad/branch/b.do:1'],
            graph: ['bad/branch/b.do:1'],
            nested: [],
        });
    });

    it('does not resolve an unreachable file against a shadowing caller', async () => {
        const result = await missing_calls({
            'main.do': '// sight: cd bad\ncd "../good"\ndo sub/a.do\n',
            'good/sub/a.do': 'do branch/b.do\n',
            'good/branch/b.do': 'display 1\n',
            'bad/branch/b.do': 'do lib.do\n',
            'bad/branch/lib.do': 'display 1\n',
            'bad/lib.do': 'do nowhere.do\n',
        });
        expect(result).toEqual({
            check: ['bad/lib.do:1'],
            graph: ['bad/lib.do:1'],
            nested: ['good/sub/a.do:1'],
        });
    });

    it('keeps a reachable file\'s missing call below a literal cd', async () => {
        const result = await missing_calls({
            'main.do': '// sight: cd "bad"\ncd "../good"\ndo sub/a.do\n',
            'good/sub/a.do': 'do branch/b.do\n',
            'good/branch/b.do': 'do lost.do\n',
            'bad/lost.do': 'display 1\n',
        });
        expect(result.check).toContain('good/branch/b.do:1');
        expect(result.graph).toContain('good/branch/b.do:1');
    });

    it('keeps the chain below a mid-chain literal cd as it was', async () => {
        // a.do moves into work/sub before running b.do, so b.do runs
        // there and work/lost.do is not its lost.do.
        const result = await missing_calls({
            'main.do': '// sight: cd work\ndo jobs/a.do\n',
            'work/jobs/a.do': 'cd "../sub"\ndo b.do\n',
            'work/sub/b.do': 'do lost.do\n',
            'work/lost.do': 'display 1\n',
        });
        expect(result.check).toContain('work/sub/b.do:1');
        expect(result.graph).toContain('work/sub/b.do:1');
    });

    it('resolves a forward directive from the file\'s own directory', async () => {
        // b.do inherits `work` through do-calls, but `sight: do` resolves
        // from b.do's own directory (docs/cross-file.md).
        const result = await missing_calls({
            'main.do': '// sight: cd work\ndo jobs/a.do\n',
            'work/jobs/a.do': 'do jobs/b.do\n',
            'work/jobs/b.do': '// sight: do missing.do\ndisplay 1\n',
            'work/missing.do': 'display 1\n',
        });
        // The callers that run b.do report it too, at their calls.
        expect(result).toEqual({
            check: ['work/jobs/b.do:1'],
            graph: ['work/jobs/b.do:1'],
            nested: ['main.do:1', 'work/jobs/a.do:1'],
        });
    });

    it('resolves a direct child\'s forward directive the same way', async () => {
        const result = await missing_calls({
            'main.do': '// sight: cd work\ndo jobs/a.do\n',
            'work/jobs/a.do': '// sight: do lib.do\ndisplay 1\n',
            'work/lib.do': 'display 1\n',
        });
        expect(result).toEqual({
            check: ['work/jobs/a.do:1'],
            graph: ['work/jobs/a.do:1'],
            nested: ['main.do:1'],
        });
    });

    for (const my_directive of ['include', 'run']) {
        it(`resolves a \`sight: ${my_directive}\` directive the same way`, async () => {
            const result = await missing_calls({
                'main.do': '// sight: cd work\ndo jobs/a.do\n',
                'work/jobs/a.do':
                    `// sight: ${my_directive} lib.do\ndisplay 1\n`,
                'work/lib.do': 'display 1\n',
            });
            expect(result).toEqual({
                check: ['work/jobs/a.do:1'],
                graph: ['work/jobs/a.do:1'],
                nested: ['main.do:1'],
            });
        });
    }

    it('still finds a forward directive beside a direct child', async () => {
        const result = await missing_calls({
            'main.do': '// sight: cd work\ndo jobs/a.do\n',
            'work/jobs/a.do': '// sight: do lib.do\ndisplay 1\n',
            'work/jobs/lib.do': 'display 1\n',
        });
        expect(result).toEqual({ check: [], graph: [], nested: [] });
    });
});

/** Every diagnostic `check` gives, as sorted `path:line code` strings. */
async function check_diagnostics(
    files: Record<string, string>,
): Promise<string[]> {
    const root = write_workspace(files);
    try {
        const check_stdout: string[] = [];
        await run_check_with_cwd(
            ['--no-config', '--format', 'json', '.'], root, {
                stdout: (text) => check_stdout.push(text),
                stderr: () => undefined,
            });
        const the_records: Array<{
            path: string;
            diagnostic: { code: string; range: { start: { line: number } } };
        }> = JSON.parse(check_stdout.join(''));
        return the_records
            .map((my_record) =>
                `${my_record.path}:` +
                `${my_record.diagnostic.range.start.line + 1} ` +
                my_record.diagnostic.code)
            .sort();
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

describe('sight check — inherited directories, cases from review', () => {
    it('keeps a settled chain beside a chain longer than the depth limit', async () => {
        // The long chain runs past the depth limit; the short one under
        // `ok` is a separate part of the workspace and still settles.
        const files: Record<string, string> = {
            'other.do': '// sight: cd ok\ndo jobs/a.do\n',
            'ok/jobs/a.do': 'do jobs/b.do\n',
            'ok/jobs/b.do': 'do done.do\n',
            'ok/done.do': '\n',
            'elsewhere/dummy.do': '\n',
            'long0.do': '// sight: cd elsewhere\ndo long1.do\n',
            'long12.do': '\n',
        };
        for (let i = 1; i < 12; i++) {
            files[`long${i}.do`] = `do long${i + 1}.do\n`;
        }
        const result = await missing_calls(files);
        expect(result.check.filter(my_call => my_call.startsWith('ok/')))
            .toEqual([]);
        expect(result.graph.filter(my_call => my_call.startsWith('ok/')))
            .toEqual([]);
    });

    it('passes no directory to a forward directive\'s target without a `sight: cd`', async () => {
        // b.do runs where a.do runs, which is nowhere in particular, so
        // its call resolves beside b.do, not beside a.do.
        expect(await check_diagnostics({
            'sub/a.do': '// sight: do ../jobs/b.do\ndisplay "$RIGHT"\n',
            'jobs/b.do': 'do lib.do\n',
            'jobs/lib.do': 'global RIGHT 1\n',
            'sub/lib.do': 'global WRONG 1\n',
        })).toEqual([]);
    });

    it('settles below a file whose named parent has a caller the graph finds', async () => {
        const result = await missing_calls({
            'main.do': '// sight: cd work\ndo jobs/a.do\n',
            'work/jobs/a.do': 'do b.do\n',
            'work/jobs/b.do': '// sight: done-by a.do\ndo found.do\n',
            'work/found.do': '\n',
        });
        expect(result).toEqual({ check: [], graph: [], nested: [] });
    });

    it('counts a named parent toward the depth limit', async () => {
        // a11.do is eleven callers below the `sight: cd`, one more
        // than the limit, whether a caller is named or found.
        const files: Record<string, string> = {
            'main.do': '// sight: cd work\ndo jobs/a1.do\n',
            'work/jobs/a1.do':
                '// sight: done-by ../../main.do\ndo jobs/a2.do\n',
            'work/jobs/a11.do': 'do end.do\n',
            'work/end.do': '\n',
        };
        for (let i = 2; i < 11; i++) {
            files[`work/jobs/a${i}.do`] = `do jobs/a${i + 1}.do\n`;
        }
        const result = await missing_calls(files);
        expect(result.check).toEqual(['work/jobs/a11.do:1']);
        expect(result.graph).toEqual(['work/jobs/a11.do:1']);
    });

    it('passes the directory on through a forward directive', async () => {
        // b.do is found beside a.do, and runs where a.do runs.
        const result = await missing_calls({
            'main.do': '// sight: cd work\ndo jobs/a.do\n',
            'work/jobs/a.do': '// sight: do b.do\n',
            'work/jobs/b.do': 'do jobs/c.do\n',
            'work/jobs/c.do': 'do done.do\n',
            'work/done.do': '\n',
        });
        expect(result).toEqual({ check: [], graph: [], nested: [] });
    });

    for (const my_spelling of ['work', 'work/']) {
        it(`treats \`cd "."\` as no change under \`sight: cd ${my_spelling}\``, async () => {
            const result = await missing_calls({
                'main.do':
                    `// sight: cd ${my_spelling}\ncd "."\ndo jobs/a.do\n`,
                'work/jobs/a.do': 'do jobs/b.do\n',
                'work/jobs/b.do': 'do done.do\n',
                'work/done.do': '\n',
            });
            expect(result).toEqual({ check: [], graph: [], nested: [] });
        });
    }

    it('ends a cycle whose calls resolve only while it is settled', async () => {
        // a.do reaches b.do only with the inherited directory, and b.do
        // then calls a.do back, which makes a.do's walk run through
        // itself; unsettled again, a.do no longer reaches b.do. The
        // results would alternate for ever. The cycle is left as it is
        // without settling; the chain under `ok` still settles.
        const result = await missing_calls({
            'z.do': '// sight: cd work\ndo jobs/a.do\n',
            'work/jobs/a.do': 'do jobs/b.do\n',
            'work/jobs/b.do': 'do jobs/a.do\ndo done.do\n',
            'work/done.do': '\n',
            'other.do': '// sight: cd ok\ndo jobs/a.do\n',
            'ok/jobs/a.do': 'do jobs/b.do\n',
            'ok/jobs/b.do': 'do done.do\n',
            'ok/done.do': '\n',
        });
        expect(result.check)
            .toEqual(['work/jobs/b.do:1', 'work/jobs/b.do:2']);
        expect(result.graph).toEqual(result.check);
    });

    it('reads the locals of the file a `sight: include` names', async () => {
        // The include resolves beside a.do, not in `work`.
        expect(await check_diagnostics({
            'main.do': '// sight: cd work\ndo jobs/a.do\n' +
                'display `wrong\'\ndisplay `right\'\n',
            'work/jobs/a.do': '// sight: include lib.do\n',
            'work/jobs/lib.do': 'local right 1\n',
            'work/lib.do': 'local wrong 1\n',
        })).toEqual([
            'main.do:3 UNDEFINED_MACRO',
            'main.do:4 OUT_OF_SCOPE_SYMBOL',
        ]);
    });
});

describe('sight check — cost of settling inherited directories', () => {
    it('checks one file beside a dense cycle quickly', async () => {
        // Each of twelve files calls all twelve; one unrelated file has
        // a directory. The settle looks at each file's parents once per
        // round instead of every path through the cycle.
        const the_files: Record<string, string> = {
            'unrelated.do': '// sight: cd "."\ndisplay 1\n',
        };
        for (let i = 0; i < 12; i++) {
            the_files[`f${i}.do`] = Array.from(
                { length: 12 }, (_, j) => `do f${j}.do`).join('\n') + '\n';
        }
        const root = write_workspace(the_files);
        try {
            const start_ms = performance.now();
            const code = await run_check_with_cwd(
                ['--no-config', '--format', 'json', 'unrelated.do'], root, {
                    stdout: () => undefined,
                    stderr: () => undefined,
                });
            expect(code).toBe(0);
            expect(performance.now() - start_ms).toBeLessThan(5000);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    }, 30000);
});
