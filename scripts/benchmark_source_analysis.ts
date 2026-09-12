/**
 * Compare source-analysis work across revisions using identical workloads.
 *
 * Copy this script into both checkouts, then run in each:
 * bun scripts/benchmark_source_analysis.ts --output /tmp/sight-before.json
 *
 * Samples run sequentially in fresh Bun processes. Timings cover indexing
 * and diagnostics with one CLI worker, plus DocumentStore edits. They exclude
 * target discovery, config loading, output rendering, and LSP lifecycle work.
 * A warm-up sample is discarded. Compare output digests before comparing
 * timings. Filesystem caches are not flushed; "cold" means fresh Sight state.
 */
import * as crypto from 'crypto';
import fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { URI } from 'vscode-uri';
import { StataLexer } from '../src/lexer';
import { StataParser } from '../src/parser';
import { SemanticAnalyzer } from '../src/analyzer';
import {
    build_check_context,
    collect_check_diagnostics,
    load_check_config,
} from '../src/cli/check';
import { collect_report_targets } from '../src/cli/source-files';
import { render_json } from '../src/cli/shared';

interface Options {
    runs: number;
    files: number;
    edits: number;
    long_lines: number;
    output?: string;
    sample: boolean;
}

interface WorkCounts {
    tokenize: number;
    parse: number;
    analyze: number;
    async_reads: number;
}

interface Measurement {
    elapsed_ms: number;
    counts: WorkCounts;
}

interface Sample {
    cold_index: Measurement;
    first_diagnostics: Measurement;
    remaining_diagnostics: Measurement;
    cold_check_ms: number;
    edits: Measurement[];
    diagnostic_digest: string;
    edit_digest: string;
    diagnostic_count: number;
    files: number;
    peak_rss_kib: number;
}

function read_options(): Options {
    const options: Options = {
        runs: 5, files: 180, edits: 10, long_lines: 1200, sample: false,
    };
    const args = process.argv.slice(2);
    for (let i = 0; i < args.length; i++) {
        const flag = args[i];
        if (flag === '--sample') {
            options.sample = true;
            continue;
        }
        const value = args[++i];
        if (value === undefined) throw new Error(`Missing value for ${flag}`);
        if (flag === '--output') {
            options.output = value;
            continue;
        }
        const number = Number(value);
        if (!Number.isInteger(number) || number < 1) {
            throw new Error(`Expected positive integer for ${flag}`);
        }
        if (flag === '--runs') options.runs = number;
        else if (flag === '--files') options.files = number;
        else if (flag === '--edits') options.edits = number;
        else if (flag === '--long-lines') options.long_lines = number;
        else throw new Error(`Unknown option: ${flag}`);
    }
    if (options.files < 7) throw new Error('--files must be at least 7');
    return options;
}

function create_workspace(root: string, options: Options): string {
    const group_count = Math.floor((options.files - 1) / 6);
    for (let i = 0; i < group_count; i++) {
        const directory = path.join(root, `group_${String(i).padStart(3, '0')}`);
        fs.mkdirSync(directory);
        const sources: Record<string, string[]> = {
            'main.do': [
                '// sight: cd: "."', `global seed_${i} ${i}`,
                'local inherited 7', 'include "shared.do"',
                'do "stage.do"', 'include "left.do"', 'include "right.do"',
                `display "$missing_${i}"`,
            ],
            'shared.do': [
                `global shared_${i} 1`, 'local shared_local 3',
                `program define helper_${i}`, '    c_local produced 1', 'end',
            ],
            'stage.do': [
                '// sight: done-by: "main.do"', 'do "leaf.do"',
                `display "$seed_${i}"`, `helper_${i}`,
                'display "`produced\'"',
            ],
            'left.do': [
                '// sight: included-by: "main.do"', 'include "shared.do"',
                'display "`inherited\'"',
            ],
            'right.do': [
                '// sight: included-by: "main.do"', 'include "shared.do"',
                `display "$shared_${i}"`,
            ],
            'leaf.do': [
                '// sight: done-by: "stage.do"', `display "$seed_${i}"`,
                'display "`missing_leaf\'"',
            ],
        };
        for (const [name, lines] of Object.entries(sources)) {
            fs.writeFileSync(path.join(directory, name), lines.join('\n') + '\n');
        }
    }
    for (let i = group_count * 6 + 1; i < options.files; i++) {
        fs.writeFileSync(path.join(root, `pad_${i}.do`), 'display 1\n');
    }
    const lines = [
        '// sight: done-by: "group_000/main.do"',
        '// sight: include: "group_000/shared.do"',
        'include "shared.do"', 'do "stage.do"',
        'include "left.do"', 'include "right.do"',
        'local continuation ///', '    42',
        '#delimit ;', 'display "$seed_0";', '#delimit cr',
        'mata:', 'x = 1', 'end',
    ];
    for (let i = 0; i < options.long_lines; i++) {
        lines.push(i % 2 === 0
            ? `local value_${i} ${i}`
            : `display "\`value_${i - 1}' $seed_0"`);
    }
    lines.push('display "`undefined_long\'"');
    const long_source = lines.join('\n') + '\n';
    fs.writeFileSync(path.join(root, 'long.do'), long_source);
    return long_source;
}

function empty_counts(): WorkCounts {
    return { tokenize: 0, parse: 0, analyze: 0, async_reads: 0 };
}

function instrument(counts: WorkCounts): () => void {
    const tokenize = StataLexer.prototype.tokenize;
    const parse = StataParser.prototype.parse;
    const analyze = SemanticAnalyzer.prototype.analyze;
    const async_read = fs.promises.readFile;
    StataLexer.prototype.tokenize = function (...args) {
        counts.tokenize++;
        return tokenize.apply(this, args);
    };
    StataParser.prototype.parse = function (...args) {
        counts.parse++;
        return parse.apply(this, args);
    };
    SemanticAnalyzer.prototype.analyze = function (...args) {
        counts.analyze++;
        return analyze.apply(this, args);
    };
    fs.promises.readFile = new Proxy(async_read, {
        apply(target, receiver, args) {
            counts.async_reads++;
            return Reflect.apply(target, receiver, args);
        },
    });
    return () => {
        StataLexer.prototype.tokenize = tokenize;
        StataParser.prototype.parse = parse;
        SemanticAnalyzer.prototype.analyze = analyze;
        fs.promises.readFile = async_read;
    };
}

async function measure<T>(
    action: () => Promise<T>
): Promise<{ value: T; measurement: Measurement }> {
    const counts = empty_counts();
    const restore = instrument(counts);
    const started_ms = performance.now();
    try {
        const value = await action();
        return {
            value,
            measurement: { elapsed_ms: performance.now() - started_ms, counts },
        };
    } finally {
        restore();
    }
}

function digest(text: string, root: string): string {
    const normalized = text
        .replaceAll(URI.file(root).toString(), 'file://<workspace>')
        .replaceAll(JSON.stringify(root).slice(1, -1), '<workspace>')
        .replaceAll(root, '<workspace>');
    return crypto.createHash('sha256')
        .update(normalized).digest('hex');
}

async function run_sample(options: Options): Promise<Sample> {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sight-analysis-bench-'));
    let context: Awaited<ReturnType<typeof build_check_context>> | undefined;
    try {
        const long_source = create_workspace(root, options);
        const loaded = load_check_config({
            cwd: root, workspace_root: root, no_config: true,
        });
        if (loaded.kind !== 'loaded') throw new Error('Cannot load defaults');
        const config = loaded.config;
        const discovery = collect_report_targets([], root, root);
        if (discovery.operator_errors.length > 0) {
            throw new Error(discovery.operator_errors.join('\n'));
        }
        const targets = discovery.targets;
        const indexed = await measure(() => build_check_context(root, config));
        context = indexed.value;
        const active_context = context;
        const first = await measure(() => collect_check_diagnostics(
            active_context, root, config, targets.slice(0, 1), 1
        ));
        const remaining = await measure(() => collect_check_diagnostics(
            active_context, root, config, targets.slice(1), 1
        ));
        const diagnostics = [...first.value, ...remaining.value];
        const uri = URI.file(path.join(root, 'long.do')).toString();
        const workspace_symbols = context.workspace_indexer.get_all_symbols();
        await context.document_store.open(uri, long_source, 1, workspace_symbols);
        const initial = context.document_store.get(uri);
        if (!initial) throw new Error('Long document did not open');
        await context.diagnostics_provider.get_diagnostics(
            initial, config, workspace_symbols, context.scope_resolver
        );
        const edits: Measurement[] = [];
        const edit_outputs: string[] = [];
        for (let i = 0; i < options.edits; i++) {
            const edited = await measure(async () => {
                await active_context.document_store.update(
                    uri,
                    [{ text: long_source + `global edit_revision ${i}\n` }],
                    i + 2,
                    workspace_symbols
                );
                const state = active_context.document_store.get(uri);
                if (!state) throw new Error('Edited document disappeared');
                return active_context.diagnostics_provider.get_diagnostics(
                    state, config, workspace_symbols, active_context.scope_resolver
                );
            });
            edits.push(edited.measurement);
            edit_outputs.push(JSON.stringify(edited.value));
        }
        return {
            cold_index: indexed.measurement,
            first_diagnostics: first.measurement,
            remaining_diagnostics: remaining.measurement,
            cold_check_ms: indexed.measurement.elapsed_ms
                + first.measurement.elapsed_ms + remaining.measurement.elapsed_ms,
            edits,
            diagnostic_digest: digest(render_json(diagnostics), root),
            edit_digest: digest(edit_outputs.join('\n'), root),
            diagnostic_count: diagnostics.length,
            files: targets.length,
            peak_rss_kib: process.resourceUsage().maxRSS,
        };
    } finally {
        if (context) {
            await context.document_store.dispose();
            context.workspace_indexer.cancel();
            context.scope_resolver.dispose();
        }
        fs.rmSync(root, { recursive: true, force: true });
    }
}

function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[middle - 1] + sorted[middle]) / 2
        : sorted[middle];
}

function summarize_measurements(measurements: Measurement[]): Measurement {
    const counts = empty_counts();
    const keys: (keyof WorkCounts)[] = [
        'tokenize', 'parse', 'analyze', 'async_reads',
    ];
    for (const key of keys) {
        counts[key] = median(measurements.map(value => value.counts[key]));
    }
    return {
        elapsed_ms: median(measurements.map(value => value.elapsed_ms)), counts,
    };
}

async function main(): Promise<void> {
    const options = read_options();
    if (options.sample) {
        process.stdout.write(JSON.stringify(await run_sample(options)) + '\n');
        return;
    }
    const samples: Sample[] = [];
    for (let i = 0; i <= options.runs; i++) {
        const child = spawnSync(process.execPath, [
            import.meta.filename, '--sample', '--files', String(options.files),
            '--edits', String(options.edits),
            '--long-lines', String(options.long_lines),
        ], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
        if (child.status !== 0) {
            throw new Error(child.stderr || child.error?.message || 'Sample failed');
        }
        const sample: Sample = JSON.parse(child.stdout);
        if (i > 0) samples.push(sample);
        process.stderr.write(`${i === 0 ? 'Warm-up' : `Sample ${i}`} complete\n`);
    }
    const diagnostic_digests = new Set(samples.map(value => value.diagnostic_digest));
    const edit_digests = new Set(samples.map(value => value.edit_digest));
    if (diagnostic_digests.size !== 1 || edit_digests.size !== 1) {
        throw new Error('Output changed between identical samples');
    }
    const report = {
        runtime: `Bun ${process.versions.bun}`,
        node_compatibility_version: process.version,
        script_sha256: crypto.createHash('sha256')
            .update(fs.readFileSync(import.meta.filename)).digest('hex'),
        platform: `${process.platform}-${process.arch}`,
        read_count_scope: 'fs.promises.readFile calls; CLI sync reads excluded',
        options,
        summary: {
            cold_index: summarize_measurements(samples.map(value => value.cold_index)),
            first_diagnostics: summarize_measurements(samples.map(value => value.first_diagnostics)),
            remaining_diagnostics: summarize_measurements(samples.map(value => value.remaining_diagnostics)),
            cold_check_ms: median(samples.map(value => value.cold_check_ms)),
            edit: summarize_measurements(samples.flatMap(value => value.edits)),
            peak_rss_kib: median(samples.map(value => value.peak_rss_kib)),
            diagnostic_digest: samples[0].diagnostic_digest,
            edit_digest: samples[0].edit_digest,
            diagnostic_count: samples[0].diagnostic_count,
            files: samples[0].files,
        },
        samples,
    };
    const output = JSON.stringify(report, null, 2) + '\n';
    if (options.output) fs.writeFileSync(options.output, output);
    process.stdout.write(options.output
        ? JSON.stringify(report.summary, null, 2) + '\n'
        : output);
}

await main();
