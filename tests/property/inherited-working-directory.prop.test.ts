/**
 * Property: for any small workspace, `sight check` and `sight graph`
 * agree on which calls are missing.
 *
 * Both give a file the working directory it inherits from the callers
 * that reach it (docs/cross-file.md, Working Directory). `graph` asks
 * the backward walk for every file until nothing changes; `check`
 * settles the directories in its index. A file the two disagree on has
 * a settled directory that is not the walk's.
 *
 * The workspaces mix `sight: cd`, `sight: done-by`,
 * `do`/`include` calls and `sight: do` directives over a few
 * directories, with paths written relative to the root, to `work`, and
 * to the calling file, so calls resolve under some directories and not
 * others. Half the calls go to the next file, so chains three or more
 * levels deep are common.
 *
 * Left out: a literal `cd`, below which `check` passes no directory on
 * and `graph` does; and a forward directive in a file that names a parent. There
 * `check` looks the directive up in a directory the named parent got
 * from a caller the graph found, and `graph` does not.
 */

import { describe, expect, it } from 'bun:test';
import * as fc from 'fast-check';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { run_check_with_cwd } from '../../src/cli/check';
import { run_graph_with_cwd } from '../../src/cli/graph';

const DIRECTORIES = ['', 'work', 'work/jobs', 'other'];
const MAX_FILES = 6;
const NUM_RUNS = 400;
const TEST_TIMEOUT_MS = 120000;

interface GeneratedCall {
    target: number;
    base: 'name' | 'root' | 'work' | 'script';
    kind: 'do' | 'include' | 'directive';
}

interface GeneratedFile {
    directory: string;
    sight_cd: string | undefined;
    done_by: number | undefined;
    calls: GeneratedCall[];
}

const arbitrary_file: fc.Arbitrary<GeneratedFile> = fc.record({
    // Mostly `work/jobs` under a `sight: cd /work`, so that chains
    // several levels deep resolve only with the inherited directory.
    directory: fc.constantFrom(
        ...DIRECTORIES, 'work/jobs', 'work/jobs', 'work/jobs'),
    sight_cd: fc.option(
        fc.constantFrom('/work', '/work', '/other', '/work/jobs', '/work/'),
        { freq: 4, nil: undefined },
    ),
    done_by: fc.option(fc.nat(MAX_FILES - 1), { freq: 6, nil: undefined }),
    calls: fc.array(
        fc.record({
            // Half the calls go to the next file, making chains.
            target: fc.oneof(fc.nat(MAX_FILES - 1), fc.constant(-1)),
            base: fc.constantFrom<GeneratedCall['base']>(
                'name', 'root', 'work', 'work', 'work', 'script'),
            kind: fc.constantFrom<GeneratedCall['kind']>(
                'do', 'do', 'do', 'include', 'directive'),
        }),
        { maxLength: 2 },
    ),
});

/** The workspace's files, as text by path relative to its root. */
function workspace_files(
    the_generated: GeneratedFile[],
): Record<string, string> {
    const the_paths = the_generated.map((my_file, i) =>
        path.posix.join(my_file.directory, `f${i}.do`));
    const files: Record<string, string> = {};
    the_generated.forEach((my_file, i) => {
        const my_directory = my_file.directory || '.';
        const the_header: string[] = [];
        if (my_file.sight_cd !== undefined) {
            the_header.push(`// sight: cd ${my_file.sight_cd}`);
        }
        const my_parent = my_file.done_by;
        const names_parent = my_parent !== undefined &&
            my_parent < the_generated.length && my_parent !== i;
        if (names_parent) {
            const parent_path = path.posix.relative(
                my_directory, the_paths[my_parent] ?? '');
            the_header.push(`// sight: done-by ${parent_path}`);
        }
        const the_body: string[] = [];
        for (const my_call of my_file.calls) {
            const target_path = the_paths[
                my_call.target < 0 ? i + 1 : my_call.target];
            if (target_path === undefined) {
                continue;
            }
            const written =
                my_call.base === 'name' ? path.posix.basename(target_path)
                : my_call.base === 'root' ? target_path
                : my_call.base === 'work'
                    ? path.posix.relative('work', target_path)
                : path.posix.relative(my_directory, target_path);
            if (my_call.kind !== 'directive') {
                the_body.push(`${my_call.kind} ${written}`);
            } else if (!names_parent) {
                the_body.push(`// sight: do ${written}`);
            }
        }
        files[the_paths[i] ?? ''] =
            [...the_header, ...the_body, ''].join('\n');
    });
    return files;
}

/** The calls `check` and `graph` each report missing, as `path:line`. */
async function missing_calls(
    files: Record<string, string>,
): Promise<{ check: string[]; graph: string[] }> {
    const root = fs.realpathSync(
        fs.mkdtempSync(path.join(os.tmpdir(), 'sight-inherit-prop-')));
    try {
        for (const my_directory of DIRECTORIES) {
            fs.mkdirSync(path.join(root, my_directory), { recursive: true });
        }
        for (const [my_name, my_text] of Object.entries(files)) {
            fs.writeFileSync(path.join(root, my_name), my_text);
        }
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
        const check = the_records
            .filter((my_record) =>
                my_record.diagnostic.code === 'CROSS_FILE_MISSING_FILE' &&
                my_record.diagnostic.message.startsWith('Cannot read file:'))
            .map((my_record) =>
                `${my_record.path}:` +
                `${my_record.diagnostic.range.start.line + 1}`)
            .sort();
        const graph_stdout: string[] = [];
        await run_graph_with_cwd(
            ['--json', '--no-config', root], root, {
                stdout: (text) => graph_stdout.push(text),
                stderr: () => undefined,
            });
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
        return { check, graph };
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

describe('inherited working directory: check and graph agree', () => {
    it('reports the same calls missing in any small workspace', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.array(arbitrary_file, {
                    minLength: 3, maxLength: MAX_FILES,
                }),
                async (the_generated) => {
                    const result = await missing_calls(
                        workspace_files(the_generated));
                    expect(result.graph).toEqual(result.check);
                },
            ),
            { numRuns: NUM_RUNS },
        );
    }, TEST_TIMEOUT_MS);
});
