/**
 * Golden tests for `sight parse --json` and `sight graph --json`.
 *
 * The fixture project in tests/fixtures/cli-json/project covers an
 * `include`, a `do` with arguments, a `do` with a macro in its path,
 * `cd`, a `#delimit ;` section, a `program` with `args`, `foreach` over a
 * local, a backward directive, and a cycle. directives.do covers every
 * Sight directive kind (with `@lsp-` aliases and quote and colon
 * variants) and each placement Sight ignores; header-only.do is a file
 * of comments with no statements; comment-placement.do has own-line
 * comments the parser attaches as trailing trivia (after `#delimit ;`
 * and at end of file), with directives in them; tight-slashes.do has
 * `//` and `///` with code right before them, which Stata reads as text;
 * column0-slashes.do has `///` lines that start a statement and, under
 * `#delimit ;`, column-0 `//` and `///` after a statement's first line;
 * program-ends.do has `args`/`unab` with a stray operator, a program
 * that a nested mata block's `end` ends, a `///`-continued program
 * header, and an `if` whose `{;` is on the next line under `#delimit ;`.
 * macro-built-names.do has `local`, `global`, `args` and `gen` names
 * joined to macro references (`` local foo`x' 1 ``), in every macro
 * definition form, which have `name_parts`. assert-display.do has
 * `assert` conditions and `display` arguments of every item kind,
 * and an unbalanced parenthesis in each.
 * The expected JSON is in
 * tests/fixtures/cli-json/expected, with the fixture's absolute path
 * replaced by <ROOT> and the Sight version by <VERSION>.
 *
 * A failure here means the JSON changed. If the change is intended,
 * check docs/cli.md (and bump schema_version if a field was removed,
 * renamed, or changed meaning), then regenerate with:
 *
 *     UPDATE_GOLDEN=1 bun test tests/unit/cli/json-golden.test.ts
 */

import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { run_graph_with_cwd } from '../../../src/cli/graph';
import { run_parse_with_cwd } from '../../../src/cli/parse';
import { canonicalize_existing_path } from '../../../src/cli/source-files';

const FIXTURE_DIR = path.resolve(__dirname, '../../fixtures/cli-json');
const PROJECT_DIR = canonicalize_existing_path(path.join(FIXTURE_DIR, 'project'));
const EXPECTED_DIR = path.join(FIXTURE_DIR, 'expected');
const PARSE_FILES = [
    'main.do',
    'code/clean.do',
    'code/helpers.doh',
    'report.do',
    'extra.do',
    'directives.do',
    'header-only.do',
    'comment-placement.do',
    'tight-slashes.do',
    'column0-slashes.do',
    'program-ends.do',
    'brace-blocks.do',
    'macro-built-names.do',
    'assert-display.do',
];

/** Replace machine-specific values so the output is stable. */
function normalize(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(normalize);
    }
    if (value !== null && typeof value === 'object') {
        const the_result: Record<string, unknown> = {};
        for (const [my_key, my_value] of Object.entries(value)) {
            the_result[my_key] = my_key === 'sight_version' ? '<VERSION>' : normalize(my_value);
        }
        return the_result;
    }
    if (typeof value === 'string' && value.startsWith(PROJECT_DIR)) {
        return '<ROOT>' + value.slice(PROJECT_DIR.length).split(path.sep).join('/');
    }
    return value;
}

function capture(): { stdout: string[]; stderr: string[]; output: { stdout(t: string): void; stderr(t: string): void } } {
    const stdout: string[] = [];
    const stderr: string[] = [];
    return { stdout, stderr, output: { stdout: (t) => stdout.push(t), stderr: (t) => stderr.push(t) } };
}

function check_golden(name: string, actual: unknown): void {
    const expected_path = path.join(EXPECTED_DIR, name);
    const actual_text = `${JSON.stringify(actual, null, 2)}\n`;
    if (process.env.UPDATE_GOLDEN === '1') {
        fs.mkdirSync(EXPECTED_DIR, { recursive: true });
        fs.writeFileSync(expected_path, actual_text);
    }
    const expected = JSON.parse(fs.readFileSync(expected_path, 'utf8'));
    expect(actual).toEqual(expected);
}

describe('CLI JSON golden output', () => {
    it('sight parse --json prints one JSON line per file, in argument order', () => {
        const { stdout, stderr, output } = capture();
        const code = run_parse_with_cwd(['--json', ...PARSE_FILES], PROJECT_DIR, output);
        expect(stderr).toEqual([]);
        expect(code).toBe(0);
        const the_lines = stdout.join('').split('\n').filter((line) => line !== '');
        expect(the_lines).toHaveLength(PARSE_FILES.length);
        const the_documents = the_lines.map((line) => normalize(JSON.parse(line)));
        expect(the_documents.map((d) => (d as { path: string }).path)).toEqual(
            PARSE_FILES.map((f) => `<ROOT>/${f}`)
        );
        check_golden('parse.json', the_documents);
    });

    it('sight graph --json prints the project graph', async () => {
        const { stdout, stderr, output } = capture();
        const code = await run_graph_with_cwd(['--json', '--no-config', '.'], PROJECT_DIR, output);
        expect(stderr).toEqual([]);
        expect(code).toBe(0);
        const the_lines = stdout.join('').split('\n').filter((line) => line !== '');
        expect(the_lines).toHaveLength(1);
        check_golden('graph.json', normalize(JSON.parse(the_lines[0])));
    });
});
