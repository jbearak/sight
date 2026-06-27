import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    build_check_context,
    collect_check_diagnostics,
    load_check_config,
} from '../../src/cli/check';
import { collect_report_targets } from '../../src/cli/source-files';
import { render_json } from '../../src/cli/shared';
import type { StataLSPConfig } from '../../src/types';

// Regression coverage for #207: parallel `sight check` must produce
// byte-identical, deterministically-ordered diagnostics to a sequential run,
// across a workspace that stresses every open-document-sensitive path
// (cross-file do/include, explicit done-by/included-by directives,
// working-directory inheritance, and conflicting global/program names in
// unrelated modules).

function temp_dir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'sight-check-parallel-'));
}

function build_hazard_workspace(): string {
    const root = temp_dir();
    fs.mkdirSync(path.join(root, 'wd'));

    // Auto-discovered `do` chain + working-directory inheritance: parent sets a
    // working directory and a global, then `do`s the child. The child inherits
    // the non-local global (auto backward discovery) and the working directory.
    fs.writeFileSync(
        path.join(root, 'parent.do'),
        '// @lsp-cd: "wd"\nglobal G_parent 7\ndo child.do\n'
    );
    fs.writeFileSync(
        path.join(root, 'child.do'),
        'display "$G_parent"\ndisplay "`child_undef\'"\n'
    );

    // Auto-discovered `include` chain inheriting a local macro.
    fs.writeFileSync(
        path.join(root, 'inc_parent.do'),
        'local L_inc 5\ninclude included.do\n'
    );
    fs.writeFileSync(
        path.join(root, 'included.do'),
        'display "`L_inc\'"\n'
    );

    // Explicit directive-only relationships (the directive path that drives the
    // buffer overlay in the LSP). done-by inherits the parent's global;
    // included-by inherits the parent's local macro.
    fs.writeFileSync(
        path.join(root, 'done_child.do'),
        '// @lsp-done-by: "parent.do"\ndisplay "$G_parent"\ndisplay "`only_local\'"\n'
    );
    fs.writeFileSync(
        path.join(root, 'inc_child.do'),
        '// @lsp-included-by: "inc_parent.do"\ndisplay "`L_inc\'"\n'
    );

    // Two unrelated modules that define the same global and program names. If
    // open-document state leaked across targets, analyzing one module while the
    // other is open could change which definition is visible.
    fs.writeFileSync(
        path.join(root, 'mod_a.do'),
        'global SHARED 1\nprogram define shared_prog\n    display "a"\nend\ndisplay "$SHARED"\n'
    );
    fs.writeFileSync(
        path.join(root, 'mod_b.do'),
        'global SHARED 2\nprogram define shared_prog\n    display "b"\nend\ndisplay "$SHARED"\n'
    );

    // A plain file with a same-file undefined-macro diagnostic, plus extra
    // padding files so there are more than CHECK_MAX_PARALLEL (4) targets and
    // at least one worker processes multiple targets.
    fs.writeFileSync(
        path.join(root, 'standalone.do'),
        'display "`missing\'"\n'
    );
    fs.writeFileSync(path.join(root, 'pad1.do'), 'display 1\n');
    fs.writeFileSync(path.join(root, 'pad2.do'), 'display 2\n');

    return root;
}

function load_config(root: string): StataLSPConfig {
    const result = load_check_config({
        cwd: root,
        workspace_root: root,
        no_config: true,
    });
    if (result.kind !== 'loaded') {
        throw new Error(`unexpected config result: ${result.kind}`);
    }
    return result.config;
}

// Render diagnostics for the whole workspace with a fresh context, at the
// given parallelism. A fresh context per call prevents shared-cache priming
// from masking a divergence.
async function render_with_parallelism(
    root: string,
    config: StataLSPConfig,
    max_parallel: number
): Promise<string> {
    const targets = collect_report_targets([], root, root).targets;
    const context = await build_check_context(root, config);
    try {
        return render_json(
            await collect_check_diagnostics(
                context,
                root,
                config,
                targets,
                max_parallel
            )
        );
    } finally {
        await context.document_store.dispose();
    }
}

// The strongest oracle: analyze each target with its own fresh context, so a
// single document is provably the only thing ever open. Concatenate in target
// order to match the slot-ordered output of a full run.
async function render_isolated_baseline(
    root: string,
    config: StataLSPConfig
): Promise<string> {
    const targets = collect_report_targets([], root, root).targets;
    const all = [];
    for (const my_target of targets) {
        const context = await build_check_context(root, config);
        try {
            all.push(
                ...(await collect_check_diagnostics(
                    context,
                    root,
                    config,
                    [my_target],
                    1
                ))
            );
        } finally {
            await context.document_store.dispose();
        }
    }
    return render_json(all);
}

describe('sight check parallel determinism (#207)', () => {
    it('produces byte-identical output across parallelism levels and the isolated baseline', async () => {
        const root = build_hazard_workspace();
        const config = load_config(root);

        const isolated = await render_isolated_baseline(root, config);
        const sequential = await render_with_parallelism(root, config, 1);
        const parallel_2 = await render_with_parallelism(root, config, 2);
        const parallel_4 = await render_with_parallelism(root, config, 4);

        // Sequential collection must match the fully-isolated baseline.
        expect(sequential).toBe(isolated);
        // Parallel collection at every level must match it too.
        expect(parallel_2).toBe(isolated);
        expect(parallel_4).toBe(isolated);
    });

    it('orders output by target path regardless of parallelism', async () => {
        const root = build_hazard_workspace();
        const config = load_config(root);

        const parallel_4 = JSON.parse(
            await render_with_parallelism(root, config, 4)
        ) as Array<{ path: string }>;

        const files = parallel_4.map((record) => record.path);
        const sorted = [...files].sort((a, b) => a.localeCompare(b));
        // Rendered output is grouped/ordered by file path deterministically.
        expect(files).toEqual(sorted);
    });

    it('drains every target for degenerate max_parallel values', async () => {
        // The internal max_parallel parameter is sanitized to a finite positive
        // integer, so degenerate values never silently yield zero workers and an
        // empty report, and never change the (order-normalized) output.
        const root = build_hazard_workspace();
        const config = load_config(root);

        const sequential = await render_with_parallelism(root, config, 1);
        // Below 1 (clamped up to one worker).
        const zero = await render_with_parallelism(root, config, 0);
        // More workers than targets (clamped down to targets.length).
        const huge = await render_with_parallelism(root, config, 1000);

        expect(zero).toBe(sequential);
        expect(huge).toBe(sequential);
        expect(JSON.parse(sequential).length).toBeGreaterThan(0);
    });

    it('returns no diagnostics for an empty target list', async () => {
        const root = build_hazard_workspace();
        const config = load_config(root);

        const context = await build_check_context(root, config);
        try {
            const records = await collect_check_diagnostics(
                context,
                root,
                config,
                [],
                4
            );
            expect(records).toEqual([]);
        } finally {
            await context.document_store.dispose();
        }
    });

    it('treats duplicate explicit targets the same as a single mention', async () => {
        const root = build_hazard_workspace();
        const config = load_config(root);

        const once = collect_report_targets(['child.do'], root, root).targets;
        const twice = collect_report_targets(
            ['child.do', 'child.do'],
            root,
            root
        ).targets;

        const context_once = await build_check_context(root, config);
        const context_twice = await build_check_context(root, config);
        try {
            const out_once = render_json(
                await collect_check_diagnostics(
                    context_once,
                    root,
                    config,
                    once,
                    4
                )
            );
            const out_twice = render_json(
                await collect_check_diagnostics(
                    context_twice,
                    root,
                    config,
                    twice,
                    4
                )
            );
            expect(out_twice).toBe(out_once);
        } finally {
            await context_once.document_store.dispose();
            await context_twice.document_store.dispose();
        }
    });
});
