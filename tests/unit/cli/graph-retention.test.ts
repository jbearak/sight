import { describe, expect, it, mock } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as source_analysis from '../../../src/source-analysis';

/**
 * `sight graph` keeps only the facts it needs from each file, not its
 * tokens and AST: holding every file's analysis at once more than
 * doubled peak memory on a 300-file project.
 */

const real_analyze_source = source_analysis.analyze_source;
const the_asts: Array<WeakRef<object>> = [];
let collected_before_last = -1;
// Other test files may share this module mock; record only here.
let is_recording = false;
const FILE_COUNT = 40;

mock.module('../../../src/source-analysis', () => ({
    ...source_analysis,
    analyze_source: (content: string, uri: string) => {
        if (!is_recording) {
            return real_analyze_source(content, uri);
        }
        if (the_asts.length === FILE_COUNT - 1) {
            // Every earlier file has been read; see what survives.
            Bun.gc(true);
            collected_before_last = the_asts
                .filter((my_ref) => my_ref.deref() === undefined).length;
        }
        const result = real_analyze_source(content, uri);
        the_asts.push(new WeakRef(result.ast));
        return result;
    },
}));

describe('sight graph memory', () => {
    it('lets each file\'s AST go once its facts are taken', async () => {
        const { run_graph_with_cwd } = await import('../../../src/cli/graph');
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sight-graph-gc-'));
        for (let i = 0; i < FILE_COUNT; i++) {
            const my_path = path.join(directory, `file${i}.do`);
            const the_lines: string[] = [];
            for (let j = 0; j < 200; j++) {
                the_lines.push(`generate v${j} = ${j}`);
            }
            fs.writeFileSync(my_path, the_lines.join('\n') + '\n');
        }
        is_recording = true;
        const code = await run_graph_with_cwd(
            ['--json', '--no-config', directory], directory,
            { stdout: () => undefined, stderr: () => undefined });
        is_recording = false;
        expect(code).toBe(0);
        expect(the_asts.length).toBe(FILE_COUNT);
        // The collector is conservative, so allow a few survivors.
        expect(collected_before_last).toBeGreaterThan((FILE_COUNT - 1) / 2);
    });
});
