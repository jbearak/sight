/**
 * Data-browser benchmark driver (`bun run bench:data-browser`).
 *
 * Bundles bench.ts for Node (the extension host's runtime; Bun's
 * JavaScriptCore would misstate V8 sort and regex costs), generates any
 * missing fixtures, then runs each scenario in its own `node` process
 * with a kill timeout and reports the median of its samples as Markdown
 * and JSON.
 *
 * Usage:
 *   bun run bench:data-browser [--dir <fixture-dir>] [--fixtures narrow,wide]
 *       [--scale 0.1] [--cold] [--samples n] [--out report.md]
 *
 * By default the page cache is warm: each fixture is read once before
 * timing starts. `--cold` instead drops the page cache before every
 * sample, which needs Linux and passwordless sudo (as on GitHub's
 * runners); elsewhere it exits with an error rather than silently
 * reporting warm numbers.
 */

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

import type { Scenario } from './bench.js';
import { fixture_file_name, make_fixture } from './make-fixtures.js';

interface Case {
    label: string;
    scenario: Scenario;
    /** Samples at full scale; slow single-shot cases use 1. */
    samples: number;
    timeout_s: number;
}

const ROOT = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..'
);

const contains = (value: string) => ({
    kind: 'strContains' as const, value, case_sensitive: false, negate: false,
});
const regex = (pattern: string) => ({
    kind: 'strRegex' as const, pattern, case_sensitive: true,
});

const CASES: Record<string, Case[]> = {
    narrow: [
        { label: 'open', scenario: { kind: 'open' }, samples: 3, timeout_s: 120 },
        { label: 'scroll 20 pages', scenario: { kind: 'scroll' }, samples: 3, timeout_s: 120 },
        { label: 'sort income (double)', scenario: { kind: 'sort', column: 'income' }, samples: 3, timeout_s: 600 },
        { label: 'sort region (labelled, labels on)', scenario: { kind: 'sort', column: 'region', labels_on: true }, samples: 1, timeout_s: 900 },
        { label: 'sort district (str12)', scenario: { kind: 'sort', column: 'district' }, samples: 1, timeout_s: 900 },
        { label: 'sorted page (income)', scenario: { kind: 'sorted_page', column: 'income' }, samples: 1, timeout_s: 600 },
        { label: 'scroll during sort (income)', scenario: { kind: 'scroll_during_sort', column: 'income' }, samples: 1, timeout_s: 600 },
        { label: 'filter income > 1000', scenario: { kind: 'filter', column: 'income', predicate: { kind: 'numCompare', op: '>', value: 1000 } }, samples: 3, timeout_s: 600 },
        { label: 'filter district contains "_12"', scenario: { kind: 'filter', column: 'district', predicate: contains('_12') }, samples: 3, timeout_s: 600 },
        { label: 'filter district regex ^([a-z_]+\\d?)+!$, Cancel after 3 s', scenario: { kind: 'filter_cancel', column: 'district', predicate: regex('^([a-z_]+\\d?)+!$'), run_ms: 3000 }, samples: 1, timeout_s: 300 },
        { label: 'histogram income', scenario: { kind: 'histogram', column: 'income' }, samples: 3, timeout_s: 600 },
        { label: 'copy column income', scenario: { kind: 'copy', column: 'income' }, samples: 1, timeout_s: 600 },
        { label: 'restore sort + filter', scenario: { kind: 'restore', sort_column: 'income', filter_column: 'income', predicate: { kind: 'numCompare', op: '>', value: 1000 } }, samples: 1, timeout_s: 600 },
    ],
    wide: [
        { label: 'open', scenario: { kind: 'open' }, samples: 3, timeout_s: 120 },
        { label: 'scroll 20 pages', scenario: { kind: 'scroll' }, samples: 3, timeout_s: 300 },
        { label: 'sort x2 (double)', scenario: { kind: 'sort', column: 'x2' }, samples: 3, timeout_s: 600 },
        { label: 'sort q1 (labelled, labels on)', scenario: { kind: 'sort', column: 'q1', labels_on: true }, samples: 1, timeout_s: 600 },
        { label: 'sort s1 (str)', scenario: { kind: 'sort', column: 's1' }, samples: 1, timeout_s: 600 },
        { label: 'sorted page (x2)', scenario: { kind: 'sorted_page', column: 'x2' }, samples: 1, timeout_s: 600 },
        { label: 'scroll during sort (x2)', scenario: { kind: 'scroll_during_sort', column: 'x2' }, samples: 1, timeout_s: 600 },
        { label: 'filter x2 > 0', scenario: { kind: 'filter', column: 'x2', predicate: { kind: 'numCompare', op: '>', value: 0 } }, samples: 3, timeout_s: 600 },
        { label: 'filter open1 (strL) contains "water"', scenario: { kind: 'filter', column: 'open1', predicate: contains('water') }, samples: 1, timeout_s: 600 },
        { label: 'filter open1 (strL) regex ^(\\w+\\s?)+!$, Cancel after 3 s', scenario: { kind: 'filter_cancel', column: 'open1', predicate: regex('^(\\w+\\s?)+!$'), run_ms: 3000 }, samples: 1, timeout_s: 120 },
        { label: 'histogram x2', scenario: { kind: 'histogram', column: 'x2' }, samples: 3, timeout_s: 600 },
        { label: 'copy column x2', scenario: { kind: 'copy', column: 'x2' }, samples: 1, timeout_s: 600 },
    ],
};

interface Options {
    dir: string;
    fixtures: string[];
    scale: number;
    cold: boolean;
    /** Run jobs on the host, as before Phase 1a (for comparison). */
    in_process: boolean;
    samples?: number;
    out?: string;
}

function parse_args(argv: string[]): Options {
    const my_opts: Options = {
        dir: path.join(os.tmpdir(), 'sight-bench'),
        fixtures: ['narrow', 'wide'],
        scale: 1,
        cold: false,
        in_process: false,
    };
    for (let i = 0; i < argv.length; i++) {
        const my_arg = argv[i];
        const next = () => {
            const my_value = argv[++i];
            if (my_value === undefined) throw new Error(`${my_arg} needs a value`);
            return my_value;
        };
        switch (my_arg) {
            case '--dir': my_opts.dir = next(); break;
            case '--fixtures': my_opts.fixtures = next().split(','); break;
            case '--scale': my_opts.scale = Number(next()); break;
            case '--cold': my_opts.cold = true; break;
            case '--in-process': my_opts.in_process = true; break;
            case '--samples': my_opts.samples = Number(next()); break;
            case '--out': my_opts.out = next(); break;
            default: throw new Error(`unknown argument ${my_arg}`);
        }
    }
    for (const my_name of my_opts.fixtures) {
        if (!CASES[my_name]) throw new Error(`unknown fixture ${my_name}`);
    }
    if (!(my_opts.scale > 0)) throw new Error('--scale must be positive');
    return my_opts;
}

/** Drop the page cache (Linux, passwordless sudo). */
function drop_page_cache(): void {
    const my_proc = spawnSync(
        'sh',
        ['-c', 'sync && echo 3 | sudo -n tee /proc/sys/vm/drop_caches > /dev/null'],
        { stdio: 'inherit' }
    );
    if (my_proc.status !== 0) {
        throw new Error('--cold: could not drop the page cache');
    }
}

function median(values: number[]): number {
    const the_sorted = [...values].sort((a, b) => a - b);
    return the_sorted[Math.floor((the_sorted.length - 1) / 2)];
}

type Json = Record<string, unknown>;

function run_case(
    bundle: string,
    fixture: string,
    my_case: Case,
    samples: number,
    cold: boolean
): Json[] {
    const the_results: Json[] = [];
    for (let i = 0; i < samples; i++) {
        if (cold) drop_page_cache();
        const my_started = performance.now();
        const my_proc = spawnSync(
            'node',
            ['--max-old-space-size=8192', bundle, fixture,
                JSON.stringify(my_case.scenario)],
            { encoding: 'utf8', timeout: my_case.timeout_s * 1000 }
        );
        const my_line = my_proc.stdout
            ?.split('\n')
            .find(my_l => my_l.startsWith('RESULT '));
        if (my_line) {
            the_results.push(JSON.parse(my_line.slice(7)));
        } else {
            const my_elapsed_s = (performance.now() - my_started) / 1000;
            the_results.push({
                dnf: true,
                signal: my_proc.signal,
                elapsed_s: Math.round(my_elapsed_s),
                stderr: my_proc.stderr?.slice(-500),
            });
            break;
        }
    }
    return the_results;
}

/** Median of each numeric leaf across samples, keyed by dotted path. */
function summarize(the_results: Json[]): Record<string, number | string> {
    const my_dnf = the_results.find(my_r => my_r.dnf);
    if (my_dnf) {
        return {
            dnf: `killed after ${my_dnf.elapsed_s} s`
                + (my_dnf.signal ? '' : ` (${String(my_dnf.stderr).trim()})`),
        };
    }
    const the_paths = new Map<string, number[]>();
    const walk = (value: unknown, prefix: string) => {
        if (typeof value === 'number') {
            the_paths.set(prefix, [...(the_paths.get(prefix) ?? []), value]);
        } else if (value && typeof value === 'object' && prefix !== 'scenario') {
            for (const [k, v] of Object.entries(value)) {
                walk(v, prefix ? `${prefix}.${k}` : k);
            }
        }
    };
    for (const my_r of the_results) walk(my_r, '');
    const out: Record<string, number> = {};
    for (const [k, v] of the_paths) out[k] = median(v);
    return out;
}

/** The headline numbers of a summary: time, host stall, size, memory. */
function headline(s: Record<string, number | string>): string[] {
    if (typeof s.dnf === 'string') return [s.dnf, '—', '—', '—'];
    const num = (k: string) => typeof s[k] === 'number' ? s[k] as number : undefined;
    const ms = (v: number | undefined) => v === undefined ? '—' : `${v} ms`;
    const kib = (v: number | undefined) => {
        if (v === undefined) return '—';
        return v < 1024 ? `${v} B` : `${Math.round(v / 1024)} KiB`;
    };
    const my_section = ['sort', 'filter_running', 'filter', 'histogram',
        'copy', 'restore', 'scroll', 'scroll_during_sort']
        .find(my_k => Object.keys(s).some(my_p => my_p.startsWith(`${my_k}.`)));
    let my_time: string;
    let my_stall: number | undefined;
    let my_bytes: number | undefined;
    if (my_section === 'scroll') {
        my_time = `p50 ${num('scroll.p50_ms')} / p95 ${num('scroll.p95_ms')} ms`;
        my_stall = num('scroll.max_stall_ms');
        my_bytes = num('open.first_page_json_bytes');
    } else if (my_section === 'scroll_during_sort') {
        const my_requested = num('scroll_during_sort.pages_requested') ?? 0;
        const my_dropped = num('scroll_during_sort.pages_dropped') ?? 0;
        my_time = `sort ${num('scroll_during_sort.sort_ms')} ms; `
            + (my_requested > my_dropped
                ? `page p50 ${num('scroll_during_sort.page_p50_ms')} / max `
                    + `${num('scroll_during_sort.page_max_ms')} ms; `
                : 'no page answered; ')
            + `${num('scroll_during_sort.pages_stale') ?? 0} answered stale, `
            + `${my_dropped} of ${my_requested} pages dropped`;
        my_stall = num('scroll_during_sort.max_stall_ms');
    } else if (my_section === 'filter_running') {
        my_time = `ran ${num('filter_running.run_ms')} ms, then Cancel `
            + `answered in ${num('cancel.ms')} ms`;
        my_stall = Math.max(
            num('filter_running.max_stall_ms') ?? 0,
            num('cancel.max_stall_ms') ?? 0
        );
    } else if (my_section === 'restore') {
        my_time = `${num('restore.ms')} ms to settled`;
        my_stall = num('restore.max_stall_ms');
    } else if (my_section) {
        my_time = ms(num(`${my_section}.ms`));
        my_stall = num(`${my_section}.max_stall_ms`);
        my_bytes = num(`${my_section}.reply_json_bytes`);
        const my_page = num('page.ms');
        if (my_page !== undefined) my_time += `; page after sort ${my_page} ms`;
    } else {
        my_time = `metadata ${num('open.metadata_ms')} ms; first page `
            + `${num('open.first_rows_ms')} ms`;
        my_stall = num('open.max_stall_ms');
        my_bytes = num('open.first_page_json_bytes');
    }
    const my_peak = num('peak_rss_mib');
    return [
        my_time,
        ms(my_stall),
        kib(my_bytes),
        my_peak === undefined ? '—' : `${my_peak} MiB`,
    ];
}

function main(): void {
    const my_opts = parse_args(process.argv.slice(2));
    if (my_opts.cold && process.platform !== 'linux') {
        console.error('--cold needs Linux (drop_caches); not supported here');
        process.exit(2);
    }
    fs.mkdirSync(my_opts.dir, { recursive: true });
    const my_bundle = path.join(my_opts.dir, 'bench.mjs');
    const my_build = spawnSync(
        path.join(ROOT, 'node_modules/.bin/esbuild'),
        [
            path.join(ROOT, 'scripts/bench-data-browser/bench.ts'),
            '--bundle', '--platform=node', '--format=esm',
            `--alias:vscode=${path.join(ROOT, 'scripts/bench-data-browser/vscode-stub.ts')}`,
            `--outfile=${my_bundle}`, '--log-level=warning',
        ],
        { stdio: 'inherit' }
    );
    if (my_build.status !== 0) process.exit(1);
    // The step worker the panel spawns for sorts, filters, histograms and
    // copies (CommonJS, as the extension ships it).
    const my_worker = path.join(my_opts.dir, 'data-browser-worker.cjs');
    if (!my_opts.in_process) {
        const my_worker_build = spawnSync(
            path.join(ROOT, 'node_modules/.bin/esbuild'),
            [
                path.join(ROOT, 'client/src/data-browser/compute-worker.ts'),
                '--bundle', '--platform=node', '--format=cjs',
                `--outfile=${my_worker}`, '--log-level=warning',
            ],
            { stdio: 'inherit' }
        );
        if (my_worker_build.status !== 0) process.exit(1);
        process.env.SIGHT_BENCH_WORKER = my_worker;
    }

    const my_node = spawnSync('node', ['--version'], { encoding: 'utf8' })
        .stdout.trim();
    const the_lines: string[] = [
        '# Data browser benchmark',
        '',
        `Node ${my_node}, ${os.cpus()[0]?.model ?? 'unknown CPU'}, `
            + `${process.platform}; scale ${my_opts.scale}; `
            + `${my_opts.cold ? 'cold page cache' : 'warm page cache'}; `
            + `${my_opts.in_process ? 'jobs on the host' : 'jobs in step workers'}. `
            + 'Times are medians; "host blocked" is the longest event-loop '
            + 'stall; "peak RSS" is the benchmark process\'s maxRSS.',
    ];
    const my_report: Json = {
        node: my_node,
        date: new Date().toISOString(),
        scale: my_opts.scale,
        cold: my_opts.cold,
        fixtures: {},
    };

    for (const my_name of my_opts.fixtures) {
        const my_fixture = path.join(
            my_opts.dir,
            fixture_file_name(my_name, my_opts.scale)
        );
        if (!fs.existsSync(my_fixture)) {
            make_fixture(my_opts.dir, my_name, my_opts.scale);
        }
        if (!my_opts.cold) {
            // Warm the page cache so every sample sees the same state.
            spawnSync('cat', [my_fixture], {
                stdio: ['ignore', 'ignore', 'inherit'],
            });
        }
        the_lines.push(
            '',
            `## ${my_name} (${path.basename(my_fixture)})`,
            '',
            '| Operation | Time | Host blocked | Reply | Peak RSS |',
            '|---|---|---|---|---|'
        );
        const my_rows: Json = {};
        for (const my_case of CASES[my_name]) {
            const my_samples = my_opts.samples ?? my_case.samples;
            const my_summary = summarize(run_case(
                my_bundle, my_fixture, my_case, my_samples, my_opts.cold
            ));
            my_rows[my_case.label] = my_summary;
            const my_line =
                `| ${my_case.label} | ${headline(my_summary).join(' | ')} |`;
            the_lines.push(my_line);
            console.log(my_line);
        }
        (my_report.fixtures as Json)[my_name] = my_rows;
    }

    const my_markdown = `${the_lines.join('\n')}\n`;
    const my_json_path = path.join(my_opts.dir, `results-${Date.now()}.json`);
    fs.writeFileSync(my_json_path, JSON.stringify(my_report, null, 2));
    if (my_opts.out) fs.writeFileSync(my_opts.out, my_markdown);
    console.log(`\n${my_markdown}\nwrote ${my_json_path}`);
}

main();
