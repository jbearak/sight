/**
 * Issue #209: `sight check` must distinguish cap-induced traversal truncation
 * from genuine diagnostics. A depth-cap hit means "we stopped walking; results
 * may be incomplete" — it must NOT fail the check (CI users would otherwise see
 * spurious failures on deep chains), and it must be surfaced distinctly with the
 * CROSS_FILE_TRUNCATED code.
 */

import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { run_check_with_cwd } from '../../src/cli/check';
import { EXIT_OK } from '../../src/cli/shared';
import { StataDiagnosticCode } from '../../src/types';

function temp_dir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'sight-check-trunc-'));
}

async function run_capture(argv: string[], cwd: string) {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await run_check_with_cwd(argv, cwd, {
        stdout: (text) => stdout.push(text),
        stderr: (text) => stderr.push(text),
    });
    return { code, stdout: stdout.join(''), stderr: stderr.join('') };
}

function text_code(code: StataDiagnosticCode): string {
    return code.toLowerCase();
}

describe('sight check — cap-truncation surfacing (#209)', () => {
    it('does not fail the check on a backward depth-cap hit, and surfaces it', async () => {
        const root = temp_dir();
        try {
            // maxBackwardDepth = 1 with a real 3-deep backward chain (each parent
            // actually calls its child, so call sites resolve and the ONLY
            // cross-file diagnostic is the depth-cap truncation).
            fs.writeFileSync(
                path.join(root, 'sight.toml'),
                '[crossFile]\nmaxBackwardDepth = 1\n'
            );
            fs.writeFileSync(path.join(root, 'g.do'), 'do "p.do"\n');
            fs.writeFileSync(
                path.join(root, 'p.do'),
                '// @lsp-done-by: "g.do"\ndo "b.do"\n'
            );
            fs.writeFileSync(
                path.join(root, 'b.do'),
                '// @lsp-done-by: "p.do"\n* leaf\n'
            );

            // At --max-severity hint, an info-severity diagnostic WOULD exceed the
            // threshold; the truncation must be excluded from the failure tally by
            // CODE, not severity.
            const result = await run_capture(
                ['--workspace', root, 'b.do', '--max-severity', 'hint',
                    '--no-color'],
                root
            );

            // Truncation must not be counted as a failure.
            expect(result.code).toBe(EXIT_OK);
            // It must still be surfaced, tagged with the truncation code.
            expect(result.stdout).toContain(
                `[${text_code(StataDiagnosticCode.CROSS_FILE_TRUNCATED)}]`
            );
            // A dedicated summary line explains the truncation is a depth-cap
            // hit, distinct from undefined-symbol errors.
            expect(result.stdout).toMatch(
                /1 cross-file traversal truncation.*results may be incomplete/
            );
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it('surfaces a forward depth-cap hit at the owner call site, not a callee line', async () => {
        const root = temp_dir();
        try {
            fs.writeFileSync(
                path.join(root, 'sight.toml'),
                '[crossFile]\nmaxForwardDepth = 1\n'
            );
            // main -> a -> b: at depth 1, `do b` exceeds maxForwardDepth=1. The
            // truncation occurs in a.do (its `do b.do` on line 1), but it must be
            // reported at main.do's OWN call site (line 4, the `do a.do`) — NOT
            // a.do's line mislabeled against main.do (line 1, a comment).
            fs.writeFileSync(path.join(root, 'b.do'), 'global b_g 1\n');
            fs.writeFileSync(path.join(root, 'a.do'), 'do "b.do"\n');
            fs.writeFileSync(
                path.join(root, 'main.do'), '* c1\n* c2\n* c3\ndo "a.do"\n');

            const result = await run_capture(
                ['--workspace', root, 'main.do', '--no-color'], root);

            expect(result.stdout).toContain(
                `[${text_code(StataDiagnosticCode.CROSS_FILE_TRUNCATED)}]`);
            // Reported at main.do line 4 (the do "a.do" call site), not line 1.
            expect(result.stdout).toMatch(
                /main\.do:4:\d+ \w+: .*Maximum forward resolution depth/);
            expect(result.stdout).not.toContain('main.do:1:');
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it('suppresses the FORWARD depth-cap diagnostic when maxDepth is off', async () => {
        const root = temp_dir();
        try {
            // maxDepth=off must suppress the forward truncation entirely — it
            // previously ignored the setting (#209). Assert the MESSAGE is gone
            // (not merely the code), so the old uncoded diagnostic can't pass.
            fs.writeFileSync(
                path.join(root, 'sight.toml'),
                '[crossFile]\nmaxForwardDepth = 1\n' +
                '[crossFile.diagnostics]\nmaxDepth = "off"\n'
            );
            fs.writeFileSync(path.join(root, 'b.do'), 'global b_g 1\n');
            fs.writeFileSync(path.join(root, 'a.do'), 'do "b.do"\n');
            fs.writeFileSync(path.join(root, 'main.do'), 'do "a.do"\n');

            const result = await run_capture(
                ['--workspace', root, 'main.do', '--max-severity', 'hint',
                    '--no-color'], root);

            expect(result.code).toBe(EXIT_OK);
            expect(result.stdout).not.toContain(
                'Maximum forward resolution depth');
            expect(result.stdout).not.toContain(
                `[${text_code(StataDiagnosticCode.CROSS_FILE_TRUNCATED)}]`);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it('suppresses the BACKWARD depth-cap diagnostic when maxDepth is off', async () => {
        const root = temp_dir();
        try {
            fs.writeFileSync(
                path.join(root, 'sight.toml'),
                '[crossFile]\nmaxBackwardDepth = 1\n' +
                '[crossFile.diagnostics]\nmaxDepth = "off"\n'
            );
            fs.writeFileSync(path.join(root, 'g.do'), 'do "p.do"\n');
            fs.writeFileSync(
                path.join(root, 'p.do'),
                '// @lsp-done-by: "g.do"\ndo "b.do"\n');
            fs.writeFileSync(
                path.join(root, 'b.do'),
                '// @lsp-done-by: "p.do"\n* leaf\n');

            const result = await run_capture(
                ['--workspace', root, 'b.do', '--max-severity', 'hint',
                    '--no-color'], root);

            expect(result.code).toBe(EXIT_OK);
            expect(result.stdout).not.toContain(
                'Maximum backward directive depth');
            expect(result.stdout).not.toContain(
                `[${text_code(StataDiagnosticCode.CROSS_FILE_TRUNCATED)}]`);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    // Shared fixture for the combined chain-depth cap: resolving b walks
    // b -> p -> g; at g (backward depth 1) the parent-forward-call resolution
    // has maxChainDepth - depth = 1 - 1 = 0 remaining, tripping the chain cap.
    // g must have a forward call for the cap check to be reached.
    const write_chain_workspace = (root: string, max_depth_line: string) => {
        fs.writeFileSync(
            path.join(root, 'sight.toml'),
            '[crossFile]\nmaxChainDepth = 1\n' + max_depth_line);
        fs.writeFileSync(path.join(root, 'helper.do'), 'global helper_g 1\n');
        fs.writeFileSync(
            path.join(root, 'g.do'), 'do "p.do"\ndo "helper.do"\n');
        fs.writeFileSync(
            path.join(root, 'p.do'),
            '// @lsp-done-by: "g.do"\ndo "b.do"\n');
        fs.writeFileSync(
            path.join(root, 'b.do'),
            '// @lsp-done-by: "p.do"\n* leaf\n');
    };

    it('surfaces a chain depth-cap hit with the truncation code, without failing', async () => {
        const root = temp_dir();
        try {
            write_chain_workspace(root, '');
            const result = await run_capture(
                ['--workspace', root, 'b.do', '--max-severity', 'hint',
                    '--no-color'], root);

            expect(result.code).toBe(EXIT_OK);
            expect(result.stdout).toContain('Maximum combined resolution depth');
            expect(result.stdout).toContain(
                `[${text_code(StataDiagnosticCode.CROSS_FILE_TRUNCATED)}]`);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it('suppresses the CHAIN depth-cap diagnostic when maxDepth is off', async () => {
        const root = temp_dir();
        try {
            write_chain_workspace(
                root, '[crossFile.diagnostics]\nmaxDepth = "off"\n');
            const result = await run_capture(
                ['--workspace', root, 'b.do', '--max-severity', 'hint',
                    '--no-color'], root);

            expect(result.code).toBe(EXIT_OK);
            expect(result.stdout).not.toContain(
                'Maximum combined resolution depth');
            expect(result.stdout).not.toContain(
                `[${text_code(StataDiagnosticCode.CROSS_FILE_TRUNCATED)}]`);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it('emits one truncation per over-depth frame, not one per skipped call', async () => {
        const root = temp_dir();
        try {
            fs.writeFileSync(
                path.join(root, 'sight.toml'),
                '[crossFile]\nmaxForwardDepth = 1\n');
            // main -> a; a does TWO calls (b, c) at depth 1 — both over the cap.
            // The truncation must be reported once for a's frame, not once per
            // skipped call (depth is frame-invariant).
            fs.writeFileSync(path.join(root, 'b.do'), 'global b_g 1\n');
            fs.writeFileSync(path.join(root, 'c.do'), 'global c_g 1\n');
            fs.writeFileSync(path.join(root, 'a.do'), 'do "b.do"\ndo "c.do"\n');
            fs.writeFileSync(path.join(root, 'main.do'), 'do "a.do"\n');

            const result = await run_capture(
                ['--workspace', root, 'main.do', '--no-color'], root);

            const occurrences = result.stdout.split(
                `[${text_code(StataDiagnosticCode.CROSS_FILE_TRUNCATED)}]`).length - 1;
            expect(occurrences).toBe(1);
            expect(result.stdout).toContain('1 cross-file traversal truncation');
            expect(result.stdout).not.toContain(
                '2 cross-file traversal truncations');
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
