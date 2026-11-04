/**
 * The `directive` on each comment in `sight parse --json`, and the
 * file-level `comments` list.
 *
 * The "agrees with the editor" tests check the CLI against what the
 * language server actually does on the same source: undefined-macro
 * diagnostics for `ignore` and declarations, and `sight graph` (built
 * on the dependency analysis the editor uses) for forward, backward,
 * and standalone directives. A change to either side that makes them
 * disagree fails here.
 */

import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { run_graph_with_cwd } from '../../../src/cli/graph';
import { build_parse_document } from '../../../src/cli/parse-json';
import { canonicalize_existing_path } from '../../../src/cli/source-files';
import { analyze_source } from '../../../src/source-analysis';

type Json = Record<string, unknown>;

interface Comment {
    style: string;
    text: string;
    range: { start: { line: number }; end: { line: number } };
    directive: Json | null;
}

const PROJECT_DIR = canonicalize_existing_path(
    path.resolve(__dirname, '../../fixtures/cli-json/project')
);

function parse(content: string, file_path = '/tmp/sight-test/file.do'): Json {
    return build_parse_document({ path: file_path, content, sight_version: 'test' });
}

/** Every comment in the document, in source order. */
function all_comments(document: Json): Comment[] {
    const the_comments: Comment[] = [...(document.comments as Comment[])];
    const visit = (statements: Json[]): void => {
        for (const my_statement of statements) {
            const groups = my_statement.comments as Record<string, Comment[]>;
            the_comments.push(
                ...groups.leading, ...groups.trailing,
                ...groups.interior, ...groups.block_end
            );
            if (Array.isArray(my_statement.body)) {
                visit(my_statement.body as Json[]);
            }
        }
    };
    visit(document.statements as Json[]);
    return the_comments.sort((a, b) => a.range.start.line - b.range.start.line);
}

/** The directive of the one comment whose text is `text`. */
function directive_of(content: string, text: string): Json | null {
    const the_matches = all_comments(parse(content)).filter((c) => c.text === text);
    expect(the_matches).toHaveLength(1);
    return the_matches[0].directive;
}

describe('sight parse --json comment directives', () => {
    it('reports an ordinary comment as null', () => {
        expect(directive_of('display 1 // note\n', '// note')).toBeNull();
    });

    it('reads declarations with either prefix, a colon, and several names', () => {
        const content = [
            '// sight: local a b',
            '// @lsp-global G',
            '* sight: scalar: s',
            '// sight: matrix M',
            '// @lsp-program p',
            'display 1',
        ].join('\n');
        expect(directive_of(content, '// sight: local a b')).toEqual(
            { kind: 'declare', symbol_kind: 'local', names: ['a', 'b'] });
        expect(directive_of(content, '// @lsp-global G')).toEqual(
            { kind: 'declare', symbol_kind: 'global', names: ['G'] });
        expect(directive_of(content, '* sight: scalar: s')).toEqual(
            { kind: 'declare', symbol_kind: 'scalar', names: ['s'] });
        expect(directive_of(content, '// sight: matrix M')).toEqual(
            { kind: 'declare', symbol_kind: 'matrix', names: ['M'] });
        expect(directive_of(content, '// @lsp-program p')).toEqual(
            { kind: 'declare', symbol_kind: 'program', names: ['p'] });
    });

    it('reads variables and its aliases as declare with symbol_kind variables', () => {
        const content = '// sight: variables v1 v2\n// @lsp-var w\n// sight: vars: x\ndisplay 1\n';
        expect(directive_of(content, '// sight: variables v1 v2')).toEqual(
            { kind: 'declare', symbol_kind: 'variables', names: ['v1', 'v2'] });
        expect(directive_of(content, '// @lsp-var w')).toEqual(
            { kind: 'declare', symbol_kind: 'variables', names: ['w'] });
        expect(directive_of(content, '// sight: vars: x')).toEqual(
            { kind: 'declare', symbol_kind: 'variables', names: ['x'] });
    });

    it('honors a declaration after code, keeping names exact-case', () => {
        expect(directive_of('display 1 // sight: local myVar\n', '// sight: local myVar'))
            .toEqual({ kind: 'declare', symbol_kind: 'local', names: ['myVar'] });
    });

    it('drops invalid names and reports a declaration with none as null', () => {
        const content = '#delimit ;\ndisplay 1;\n* sight: local foo ;\n#delimit cr\n// sight: local\n';
        expect(directive_of(content, '// sight: local')).toBeNull();
        const the_star = all_comments(parse(content)).filter((c) => c.style === 'star');
        for (const my_comment of the_star) {
            if (my_comment.directive !== null) {
                expect(my_comment.directive).toEqual(
                    { kind: 'declare', symbol_kind: 'local', names: ['foo'] });
            }
        }
    });

    it('gives a standalone ignore the whole next statement', () => {
        const content = '// sight: ignore\ndisplay `a\' ///\n    `b\'\ndisplay 2\n';
        expect(directive_of(content, '// sight: ignore')).toEqual({
            kind: 'ignore',
            target_range: {
                start: { line: 1, character: 0 },
                end: { line: 2, character: 7 },
            },
        });
    });

    it('gives a trailing ignore its own line and a trailing ignore-next the next statement', () => {
        const content = 'display `a\' // sight: ignore\ndisplay 1 // @lsp-ignore-next\ndisplay `b\'\n';
        expect(directive_of(content, '// sight: ignore')).toEqual({
            kind: 'ignore',
            target_range: { start: { line: 0, character: 0 }, end: { line: 0, character: 11 } },
        });
        expect(directive_of(content, '// @lsp-ignore-next')).toEqual({
            kind: 'ignore_next',
            target_range: { start: { line: 2, character: 0 }, end: { line: 2, character: 11 } },
        });
    });

    it('covers a block header through its brace, never the body', () => {
        const content = '// sight: ignore-next\nforeach v in `a\' {\n    display `v\'\n}\n';
        expect(directive_of(content, '// sight: ignore-next')).toEqual({
            kind: 'ignore_next',
            target_range: { start: { line: 1, character: 0 }, end: { line: 1, character: 18 } },
        });
    });

    it('sends an ignore before a closer to the statement after the block', () => {
        const content = 'foreach v in a {\n    display 1\n    // sight: ignore\n}\ndisplay `u\'\n';
        expect(directive_of(content, '// sight: ignore')).toEqual({
            kind: 'ignore',
            target_range: { start: { line: 4, character: 0 }, end: { line: 4, character: 11 } },
        });
    });

    it('gives an ignore with nothing after it a null target', () => {
        expect(directive_of('display 1\n// sight: ignore\n', '// sight: ignore'))
            .toEqual({ kind: 'ignore', target_range: null });
    });

    it('reads forward directives anywhere, with quote and colon variants', () => {
        const content = [
            'display 1',
            '// sight: do "a.do"',
            '// @lsp-include: lib/b.doh',
            '* sight: run: "c d.do" line=3',
        ].join('\n');
        expect(directive_of(content, '// sight: do "a.do"')).toEqual(
            { kind: 'forward', call_type: 'do', raw_path: 'a.do' });
        expect(directive_of(content, '// @lsp-include: lib/b.doh')).toEqual(
            { kind: 'forward', call_type: 'include', raw_path: 'lib/b.doh' });
        expect(directive_of(content, '* sight: run: "c d.do" line=3')).toEqual(
            { kind: 'forward', call_type: 'run', raw_path: 'c d.do' });
    });

    it('reads header-only directives in the header and keeps run-by distinct', () => {
        const content = [
            '// sight: done-by: "main.do"',
            '* @lsp-run-by main',
            '// sight: included-by ../lib.do',
            '// sight: standalone:',
            '// @lsp-wd "/data"',
            'display 1',
        ].join('\n');
        expect(directive_of(content, '// sight: done-by: "main.do"')).toEqual(
            { kind: 'backward', call_type: 'do', raw_path: 'main.do' });
        expect(directive_of(content, '* @lsp-run-by main')).toEqual(
            { kind: 'backward', call_type: 'run', raw_path: 'main' });
        expect(directive_of(content, '// sight: included-by ../lib.do')).toEqual(
            { kind: 'backward', call_type: 'include', raw_path: '../lib.do' });
        expect(directive_of(content, '// sight: standalone:')).toEqual({ kind: 'standalone' });
        expect(directive_of(content, '// @lsp-wd "/data"')).toEqual(
            { kind: 'working_directory', raw_path: '/data' });
    });

    describe('placements Sight ignores', () => {
        it('a header-only directive after the first line of code', () => {
            const content = 'display 1\n// sight: done-by "m.do"\n// sight: standalone\n// sight: cd "x"\n';
            expect(directive_of(content, '// sight: done-by "m.do"')).toBeNull();
            expect(directive_of(content, '// sight: standalone')).toBeNull();
            expect(directive_of(content, '// sight: cd "x"')).toBeNull();
        });

        it('a directive inside a block comment', () => {
            const content = '/* sight: local a */\n/*\n// sight: do "x.do"\n*/\ndisplay 1\n';
            for (const my_comment of all_comments(parse(content))) {
                expect(my_comment.directive).toBeNull();
            }
        });

        it('a non-declaration, non-ignore directive after code', () => {
            const content = 'display 1 // sight: do "x.do"\ndisplay 2 // sight: standalone\n';
            expect(directive_of(content, '// sight: do "x.do"')).toBeNull();
            expect(directive_of(content, '// sight: standalone')).toBeNull();
        });

        it('a header line that starts with a block comment', () => {
            const content = '/* c */ // sight: done-by "m.do"\ndisplay 1\n';
            expect(directive_of(content, '// sight: done-by "m.do"')).toBeNull();
        });

        it('every working directory but the last and every standalone but the first', () => {
            const content = '// sight: cd a\n// sight: cd b\n* sight: standalone\n// sight: standalone\ndisplay 1\n';
            expect(directive_of(content, '// sight: cd a')).toBeNull();
            expect(directive_of(content, '// sight: cd b')).toEqual(
                { kind: 'working_directory', raw_path: 'b' });
            expect(directive_of(content, '* sight: standalone')).toEqual({ kind: 'standalone' });
            expect(directive_of(content, '// sight: standalone')).toBeNull();
        });

        it('a forward directive right after an ignore', () => {
            const content = '// sight: ignore\n// sight: do "x.do"\ndisplay 1\n';
            expect(directive_of(content, '// sight: do "x.do"')).toBeNull();
        });

        it('a malformed directive', () => {
            const content = '// sight: done-by\n// sight: do line=3\ndisplay 1\n';
            expect(directive_of(content, '// sight: done-by')).toBeNull();
            expect(directive_of(content, '// sight: do line=3')).toBeNull();
        });
    });

    describe('file-level comments', () => {
        it('holds the comments of a file with no statements', () => {
            const document = parse('* header\n// sight: standalone\n/* x */\n');
            expect(document.statements).toEqual([]);
            expect((document.comments as Comment[]).map((c) => [c.text, c.directive])).toEqual([
                ['* header', null],
                ['// sight: standalone', { kind: 'standalone' }],
                ['/* x */', null],
            ]);
        });

        it('is empty when statements report every comment, including an EOF tail', () => {
            const content = '// head\ndisplay 1 // trail\n// tail\n/* tail */\n';
            const document = parse(content);
            expect(document.comments).toEqual([]);
            expect(all_comments(document).map((c) => c.text)).toEqual(
                ['// head', '// trail', '// tail', '/* tail */']);
        });
    });
});

/** Lines with an UNDEFINED_MACRO diagnostic from the editor's analyzer. */
function undefined_macro_lines(content: string): Set<number> {
    const analysis = analyze_source(content, 'file:///tmp/sight-test/file.do').analysis;
    return new Set(analysis.diagnostics
        .filter((d) => d.code === 'UNDEFINED_MACRO')
        .map((d) => d.range.start.line));
}

/** Lines covered by an ignore directive's target_range in the CLI output. */
function cli_target_lines(content: string): Set<number> {
    const the_lines = new Set<number>();
    for (const my_comment of all_comments(parse(content))) {
        const directive = my_comment.directive;
        if (directive?.kind !== 'ignore' && directive?.kind !== 'ignore_next') {
            continue;
        }
        const target = directive.target_range as Comment['range'] | null;
        if (target === null) {
            continue;
        }
        for (let my_line = target.start.line; my_line <= target.end.line; my_line++) {
            the_lines.add(my_line);
        }
    }
    return the_lines;
}

describe('sight parse --json directives agree with the editor', () => {
    // Every code line references an undefined local, so a line has no
    // diagnostic exactly when Sight suppresses it.
    const IGNORE_CASES: Record<string, string> = {
        standalone: '// sight: ignore\ndisplay `u\'\ndisplay `u\'\n',
        continued: '// sight: ignore-next\ndisplay `u\' ///\n    `u\'\ndisplay `u\'\n',
        trailing: 'display `u\' // sight: ignore\ndisplay `u\'\n',
        trailing_next: 'display `u\' // sight: ignore-next\ndisplay `u\' ///\n  `u\'\ndisplay `u\'\n',
        trailing_on_continuation: 'display `u\' ///\n    `u\' // sight: ignore\ndisplay `u\'\n',
        block_header: '// @lsp-ignore-next\nforeach v in `u\' {\n    display `u\'\n}\ndisplay `u\'\n',
        before_closer: 'foreach v in a {\n    display `u\'\n    // sight: ignore\n}\ndisplay `u\'\ndisplay `u\'\n',
        nested_closers: 'program define p\n    if 1 {\n        display `u\'\n        // sight: ignore\n    }\nend\ndisplay `u\'\ndisplay `u\'\n',
        delimit: '#delimit ;\n// sight: ignore-next\ndisplay `u\'\n    `u\';\ndisplay `u\';\n#delimit cr\n',
        at_eof: 'display `u\'\n// sight: ignore\n',
        before_forward: '// sight: ignore\n// sight: do "x.do"\ndisplay `u\'\ndisplay `u\'\n',
    };

    for (const [my_name, my_content] of Object.entries(IGNORE_CASES)) {
        it(`ignore target_range matches diagnostic suppression: ${my_name}`, () => {
            const the_code_lines = new Set<number>();
            my_content.split('\n').forEach((line, index) => {
                if (line.includes('`u\'')) {
                    the_code_lines.add(index);
                }
            });
            const the_flagged = undefined_macro_lines(my_content);
            const the_targets = cli_target_lines(my_content);
            for (const my_line of the_code_lines) {
                expect({ line: my_line, suppressed: !the_flagged.has(my_line) })
                    .toEqual({ line: my_line, suppressed: the_targets.has(my_line) });
            }
            // At least one reference is reported, so suppression is not global.
            expect(the_flagged.size).toBeGreaterThan(0);
        });
    }

    it('declare matches the names the analyzer treats as defined', () => {
        const declarations = [
            '// sight: local a b',
            'display 1 // @lsp-local c',
            '* sight: global G',
            '/* sight: local blocked */',
            '/*',
            '// sight: local blocked2',
            '*/',
            'display 1 /* x */ // sight: local after_block',
            '// sight: local',
            '#delimit ;',
            '* sight: local semi ;',
            '#delimit cr',
        ];
        const the_candidates = ['a', 'b', 'c', 'blocked', 'blocked2', 'after_block', 'semi', 'zz'];
        const content = [
            ...declarations,
            ...the_candidates.map((name) => `display "\`${name}'"`),
            'display "$G $H"',
        ].join('\n') + '\n';

        const the_declared = new Set<string>();
        for (const my_comment of all_comments(parse(content))) {
            if (my_comment.directive?.kind === 'declare') {
                for (const my_name of my_comment.directive.names as string[]) {
                    the_declared.add(my_name);
                }
            }
        }
        const analysis = analyze_source(content, 'file:///tmp/sight-test/file.do').analysis;
        const the_undefined = new Set(analysis.diagnostics
            .filter((d) => d.code === 'UNDEFINED_MACRO')
            .map((d) => d.message.match(/`?\$?([A-Za-z_][A-Za-z0-9_]*)/)?.[1]));
        for (const my_name of [...the_candidates, 'G', 'H']) {
            expect({ name: my_name, declared: !the_undefined.has(my_name) })
                .toEqual({ name: my_name, declared: the_declared.has(my_name) });
        }
        expect(the_declared.has('zz')).toBe(false);
    });

    it('forward, backward, and standalone match sight graph on the fixture project', async () => {
        const stdout: string[] = [];
        const code = await run_graph_with_cwd(['--json', '--no-config', '.'], PROJECT_DIR, {
            stdout: (text) => stdout.push(text),
            stderr: () => undefined,
        });
        expect(code).toBe(0);
        const graph = JSON.parse(stdout.join('')) as {
            files: Array<{ path: string; standalone: boolean }>;
            edges: Array<{
                caller: string; target: string | null; source: string;
                call_type: string; raw_path: string; range: Comment['range'];
            }>;
        };

        for (const my_file of graph.files) {
            const absolute_path = path.join(PROJECT_DIR, my_file.path);
            const content = fs.readFileSync(absolute_path, 'utf8');
            const the_comments = all_comments(parse(content, absolute_path));

            // Forward: the graph's directive edges from this file.
            const the_graph_forward = graph.edges
                .filter((e) => e.caller === my_file.path && e.source === 'directive')
                .map((e) => [e.range.start.line, e.call_type, e.raw_path]);
            const the_cli_forward = the_comments
                .filter((c) => c.directive?.kind === 'forward')
                .map((c) => [c.range.start.line, c.directive?.call_type, c.directive?.raw_path]);
            expect(the_cli_forward).toEqual(the_graph_forward);

            // Backward: the graph draws them as parent -> this file and
            // reports run-by as `do`.
            const the_graph_backward = graph.edges
                .filter((e) => e.target === my_file.path && e.source === 'backward_directive')
                .map((e) => [e.range.start.line, e.call_type, e.raw_path])
                .sort();
            const the_cli_backward = the_comments
                .filter((c) => c.directive?.kind === 'backward')
                .map((c) => [
                    c.range.start.line,
                    c.directive?.call_type === 'run' ? 'do' : c.directive?.call_type,
                    c.directive?.raw_path,
                ])
                .sort();
            expect(the_cli_backward).toEqual(the_graph_backward);

            const has_standalone = the_comments.some((c) => c.directive?.kind === 'standalone');
            expect({ file: my_file.path, standalone: has_standalone })
                .toEqual({ file: my_file.path, standalone: my_file.standalone });
        }
        // The fixture exercises every kind the graph reports.
        expect(graph.edges.some((e) => e.source === 'directive')).toBe(true);
        expect(graph.edges.some((e) => e.source === 'backward_directive')).toBe(true);
        expect(graph.files.some((f) => f.standalone)).toBe(true);
    });
});
