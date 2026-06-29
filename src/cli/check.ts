import * as fs from 'fs';
import * as path from 'path';
import { Diagnostic } from 'vscode-languageserver';
import { URI } from 'vscode-uri';
import package_json from '../../package.json' with { type: 'json' };
import {
    deep_merge_config,
    discover_and_load_project_config,
    load_toml_file,
    type ProjectConfigWarning,
} from '../config-file';
import { DependencyGraph } from '../dependency-graph';
import { DocumentStore } from '../document-store';
import { ForwardScopeResolver } from '../forward-scope-resolver';
import { WorkspaceIndexer } from '../indexer';
import { DiagnosticsProvider } from '../providers/diagnostics';
import { ScopeResolver, scope_resolver_config_for } from '../scope-resolver';
import { DEFAULT_SETTINGS } from '../server-handlers';
import { StataLSPConfig } from '../types';
import { validate_comment_formatting_config } from '../utils/config-validator';
import { Logger } from '../utils/logger';
import {
    ReportTarget,
    canonicalize_existing_path,
    collect_report_targets,
    index_limit_diagnostic,
    is_within_workspace,
    read_error_detail,
    read_source_file,
    size_limit_diagnostic,
    unreadable_diagnostic,
} from './source-files';
import { create_exclude_matcher } from '../utils/exclude-matcher';
import {
    ColorChoice,
    DiagnosticRecord,
    EXIT_CHECK_FAILED,
    EXIT_OK,
    EXIT_OPERATOR_ERROR,
    OutputFormat,
    SeverityLevel,
    diagnostic_exceeds_threshold,
    is_truncation_diagnostic,
    error_message,
    parse_color_choice,
    parse_output_format,
    parse_severity_level,
    render_json,
    render_sarif,
    render_text,
    resolve_color_from_env,
} from './shared';

const CHECK_MAX_PARALLEL = 4;

export interface CheckArgs {
    paths: string[];
    workspace?: string;
    config_path?: string;
    no_config: boolean;
    format: OutputFormat;
    max_severity: SeverityLevel;
    quiet: boolean;
    color: ColorChoice;
    help: boolean;
}

export type CheckParseResult =
    | { success: true; args: CheckArgs }
    | { success: false; error: string };

function parse_required_option_value(
    argv: string[],
    index: number,
    flag: string,
    value_kind: string,
    inline_value: string | undefined
): { success: true; value: string } | { success: false; error: string } {
    // `--flag=value` form: the value travels with the flag, so it may legally
    // begin with '-' (e.g. a path like `-odd-name.toml`).
    if (inline_value !== undefined) {
        if (inline_value.length === 0) {
            return { success: false, error: `${flag} needs ${value_kind}` };
        }
        return { success: true, value: inline_value };
    }

    // `--flag value` form: a following token that begins with '-' is treated
    // as the next flag, i.e. this flag is missing its value.
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('-')) {
        return {
            success: false,
            error: `${flag} needs ${value_kind}`,
        };
    }

    return { success: true, value };
}

function parse_enum_option<T>(
    argv: string[],
    index: number,
    flag: string,
    parse: (value: string) => T,
    inline_value: string | undefined
): { success: true; value: T } | { success: false; error: string } {
    const parsed = parse_required_option_value(
        argv,
        index,
        flag,
        'a value',
        inline_value
    );
    if (!parsed.success) return parsed;
    try {
        return { success: true, value: parse(parsed.value) };
    } catch (error) {
        return {
            success: false,
            error: error_message(error),
        };
    }
}

export function parse_check_args(argv: string[]): CheckParseResult {
    const args: CheckArgs = {
        paths: [],
        no_config: false,
        format: OutputFormat.Text,
        max_severity: SeverityLevel.Info,
        quiet: false,
        color: ColorChoice.Auto,
        help: false,
    };

    for (let i = 0; i < argv.length; i++) {
        const my_raw = argv[i];
        // Support both `--flag value` and `--flag=value`. Splitting on the
        // first '=' lets a value legally begin with '-' (e.g. an odd path).
        let my_arg = my_raw;
        let my_inline_value: string | undefined;
        if (my_raw.startsWith('--')) {
            const eq = my_raw.indexOf('=');
            if (eq !== -1) {
                my_arg = my_raw.slice(0, eq);
                my_inline_value = my_raw.slice(eq + 1);
            }
        }
        switch (my_arg) {
            case '--workspace':
                {
                    const my_parsed = parse_required_option_value(
                        argv,
                        i,
                        '--workspace',
                        'a path',
                        my_inline_value
                    );
                    if (!my_parsed.success) return my_parsed;
                    args.workspace = my_parsed.value;
                    if (my_inline_value === undefined) i++;
                }
                break;
            case '--config':
                {
                    const my_parsed = parse_required_option_value(
                        argv,
                        i,
                        '--config',
                        'a path',
                        my_inline_value
                    );
                    if (!my_parsed.success) return my_parsed;
                    args.config_path = my_parsed.value;
                    if (my_inline_value === undefined) i++;
                }
                break;
            case '--no-config':
                if (my_inline_value !== undefined) {
                    return {
                        success: false,
                        error: `${my_arg} does not take a value`,
                    };
                }
                args.no_config = true;
                break;
            case '--format':
                {
                    const my_parsed = parse_enum_option(
                        argv,
                        i,
                        '--format',
                        parse_output_format,
                        my_inline_value
                    );
                    if (!my_parsed.success) return my_parsed;
                    args.format = my_parsed.value;
                    if (my_inline_value === undefined) i++;
                }
                break;
            case '--max-severity':
                {
                    const my_parsed = parse_enum_option(
                        argv,
                        i,
                        '--max-severity',
                        parse_severity_level,
                        my_inline_value
                    );
                    if (!my_parsed.success) return my_parsed;
                    args.max_severity = my_parsed.value;
                    if (my_inline_value === undefined) i++;
                }
                break;
            case '--quiet':
                if (my_inline_value !== undefined) {
                    return {
                        success: false,
                        error: `${my_arg} does not take a value`,
                    };
                }
                args.quiet = true;
                break;
            case '--color':
                {
                    const my_parsed = parse_enum_option(
                        argv,
                        i,
                        '--color',
                        parse_color_choice,
                        my_inline_value
                    );
                    if (!my_parsed.success) return my_parsed;
                    args.color = my_parsed.value;
                    if (my_inline_value === undefined) i++;
                }
                break;
            case '--no-color':
                if (my_inline_value !== undefined) {
                    return {
                        success: false,
                        error: `${my_arg} does not take a value`,
                    };
                }
                args.color = ColorChoice.Never;
                break;
            case '--help':
            case '-h':
                if (my_inline_value !== undefined) {
                    return {
                        success: false,
                        error: `${my_arg} does not take a value`,
                    };
                }
                args.help = true;
                break;
            default:
                if (my_arg.startsWith('-')) {
                    return { success: false, error: `Unknown flag: ${my_arg}` };
                }
                args.paths.push(my_arg);
        }
    }

    if (args.no_config && args.config_path !== undefined) {
        return {
            success: false,
            error: 'Cannot specify both --config and --no-config',
        };
    }

    return { success: true, args };
}

export type CheckConfigResult =
    | {
        kind: 'loaded';
        config: StataLSPConfig;
        warnings: ProjectConfigWarning[];
        config_path?: string;
    }
    | {
        kind: 'operator-error';
        message: string;
        warnings: ProjectConfigWarning[];
    };

export function load_check_config(options: {
    cwd: string;
    workspace_root: string;
    config_path?: string;
    no_config: boolean;
}): CheckConfigResult {
    // Collect comment-formatting validation warnings (invalid
    // indentSize, unknown comment style, etc.) the same way the LSP
    // server logs them, so `sight check` does not silently swallow them
    // on any config path.
    const validation_warnings: ProjectConfigWarning[] = [];
    const collect_validation_warning = (message: string): void => {
        validation_warnings.push({ code: 'invalid-value', message });
    };

    if (options.no_config) {
        return {
            kind: 'loaded',
            config: validate_comment_formatting_config(
                DEFAULT_SETTINGS,
                collect_validation_warning
            ),
            warnings: validation_warnings,
        };
    }

    const loaded = options.config_path
        ? load_toml_file(path.resolve(options.cwd, options.config_path))
        : discover_and_load_project_config(options.workspace_root);

    if (loaded.kind === 'load-failed') {
        // Surface any warnings collected before the parse failed (e.g.
        // the stale-.sight.json migration hint from discovery) so the
        // operator still gets conversion guidance with the error.
        return {
            kind: 'operator-error',
            message: `failed to load ${loaded.error}`,
            warnings: loaded.warnings,
        };
    }

    if (loaded.kind === 'none') {
        return {
            kind: 'loaded',
            config: validate_comment_formatting_config(
                DEFAULT_SETTINGS,
                collect_validation_warning
            ),
            warnings: [...loaded.warnings, ...validation_warnings],
        };
    }

    return {
        kind: 'loaded',
        config: validate_comment_formatting_config(
            deep_merge_config(DEFAULT_SETTINGS, loaded.partial_config),
            collect_validation_warning
        ),
        warnings: [...loaded.warnings, ...validation_warnings],
        config_path: loaded.path,
    };
}

export interface CheckContext {
    dependency_graph: DependencyGraph;
    workspace_indexer: WorkspaceIndexer;
    scope_resolver: ScopeResolver;
    forward_scope_resolver: ForwardScopeResolver;
    document_store: DocumentStore;
    diagnostics_provider: DiagnosticsProvider;
    // Builds a fresh DocumentStore wired to the shared, read-only check
    // infrastructure (scope resolver, workspace roots, scope-resolver config).
    // Each check worker gets its own store from this factory so that a target
    // is never analyzed while a sibling target is present as an open document —
    // see the concurrency-invariant comment on `collect_check_diagnostics`.
    create_document_store: () => DocumentStore;
}

export async function build_check_context(
    workspace_root: string,
    config: StataLSPConfig
): Promise<CheckContext> {
    Logger.initialize({
        verbosity: config.debug === true ? 'debug' : 'error',
        channel: (message) => console.error(message),
    });

    const dependency_graph = new DependencyGraph();
    const workspace_indexer = new WorkspaceIndexer();
    // ScopeResolver's default content provider already reads from disk
    // (read_file/exists/stat via fsPath), which is exactly what the CLI needs.
    const scope_resolver = new ScopeResolver({
        log: (message) => {
            if (config.debug === true) {
                console.error(message);
            }
        },
        warn: (message) => console.error(message),
    });
    const forward_scope_resolver = new ForwardScopeResolver(scope_resolver, {
        max_forward_depth: config.cross_file.max_forward_depth,
    });
    const diagnostics_provider = new DiagnosticsProvider({
        sendDiagnostics: () => undefined,
    });

    workspace_indexer.configure(config);
    workspace_indexer.set_max_indexed_files(
        config.cross_file.max_indexed_files
    );
    workspace_indexer.set_dependency_graph(dependency_graph);
    // Let indexing resolve inherited working directories (#218) so closed
    // files get the same callee keys here as in the LSP server.
    workspace_indexer.set_scope_resolver(scope_resolver);
    scope_resolver.set_dependency_graph(dependency_graph);
    scope_resolver.set_forward_scope_resolver(forward_scope_resolver);
    diagnostics_provider.set_dependency_graph(dependency_graph);
    dependency_graph.set_workspace_roots([workspace_root]);
    scope_resolver.set_workspace_roots([workspace_root]);
    forward_scope_resolver.set_workspace_roots([workspace_root]);

    const scope_resolver_config = scope_resolver_config_for(config);
    // Builds a DocumentStore wired only to the shared, read-only check
    // infrastructure. Notably it does NOT register
    // `set_on_backward_directives_parsed`: that callback exists to keep the LSP
    // server's find-references view fresh against unsaved edits by populating
    // `WorkspaceIndexer.buffer_directives_overlay`. `check` runs diagnostics
    // only, never calls `get_related_uris` (the overlay's sole consumer), and
    // has no unsaved edits (buffer content always equals disk), so the overlay
    // is dead weight here — and wiring it would add cross-target shared state we
    // intentionally avoid (see `collect_check_diagnostics`).
    const create_document_store = (): DocumentStore => {
        const store = new DocumentStore();
        store.set_workspace_roots([workspace_root]);
        store.set_scope_resolver(scope_resolver);
        store.set_scope_resolver_config(scope_resolver_config);
        return store;
    };
    const document_store = create_document_store();

    await workspace_indexer.initialize([workspace_root], config.adoPaths);

    return {
        dependency_graph,
        workspace_indexer,
        scope_resolver,
        forward_scope_resolver,
        document_store,
        diagnostics_provider,
        create_document_store,
    };
}

export interface CheckOutput {
    stdout(text: string): void;
    stderr(text: string): void;
}

const DEFAULT_OUTPUT: CheckOutput = {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
};

function diagnostic_record(
    relative_path: string,
    diagnostic: Diagnostic
): DiagnosticRecord {
    return { relative_path, diagnostic };
}

/**
 * Concurrency invariant
 * ----------------------
 * Each target is analyzed in its **own** single-document `DocumentStore`
 * (one per worker, from `context.create_document_store`). A worker opens its
 * target, reads diagnostics, then closes it before pulling the next index, so
 * a store holds at most one document at any instant and **no store ever
 * contains a sibling target**. A target's diagnostics therefore never depend on
 * which other targets happen to be open concurrently — parallel output is
 * byte-identical to a sequential run, matching editor-startup semantics where
 * the analyzed file is the one open document.
 *
 * This holds because cross-file resolution reads parents/callees from disk via
 * the shared, read-only `ScopeResolver` (its caches are content-hash +
 * dependency-graph-version keyed, so concurrent fills are deterministic), and
 * `workspace_symbols` is a single snapshot captured here before any worker
 * starts. Output order is independent of `max_parallel`: results are written
 * into `the_slots[index]` by target index and flattened in order.
 *
 * Do NOT route per-target analysis through a shared multi-document store, and
 * do NOT give the CLI an open-buffer-preferring content provider wired to a
 * shared store, without revisiting this invariant and the
 * `cli-check-parallel-determinism` regression test.
 */
export async function collect_check_diagnostics(
    context: CheckContext,
    workspace_root: string,
    config: StataLSPConfig,
    targets: ReportTarget[],
    max_parallel: number = CHECK_MAX_PARALLEL
): Promise<DiagnosticRecord[]> {
    const workspace_symbols = context.workspace_indexer.get_all_symbols();
    const files_indexed = context.workspace_indexer.get_metrics().files_indexed;
    const exclude_matcher = create_exclude_matcher(config.exclude);
    const the_slots: DiagnosticRecord[][] = new Array(targets.length);

    async function collect_target_diagnostics(
        target: ReportTarget,
        document_store: DocumentStore
    ): Promise<DiagnosticRecord[]> {
        const records: DiagnosticRecord[] = [];
        const uri = URI.file(target.path).toString();

        // Size guard runs for every target, not just explicit ones: a
        // directory-walked oversized file would otherwise be read and analyzed
        // whole (OOM risk). statSync is guarded so a file removed after
        // discovery becomes a per-file diagnostic, not a whole-batch abort.
        let stats: fs.Stats;
        try {
            stats = fs.statSync(target.path);
        } catch (error) {
            records.push(diagnostic_record(
                target.relative_path,
                unreadable_diagnostic(read_error_detail(error))
            ));
            return records;
        }
        if (stats.size > config.indexing.maxFileSizeBytes) {
            // Explicit targets get a visible diagnostic so the user learns why
            // a file they named was skipped; walked targets are skipped
            // silently, matching the indexer's own size handling.
            if (target.explicit) {
                records.push(diagnostic_record(
                    target.relative_path,
                    size_limit_diagnostic(
                        stats.size,
                        config.indexing.maxFileSizeBytes
                    )
                ));
            }
            return records;
        }
        // Once the index cap is reached, an in-workspace target that never made
        // it into the index would be analyzed against an incomplete cross-file
        // graph, yielding unreliable diagnostics with no signal in CI. Report
        // it for every in-workspace target (not just explicit ones, so the
        // default `sight check .` surfaces the problem too) rather than emitting
        // silently-wrong results.
        //
        // Excluded files are deliberately never indexed (not a cap casualty),
        // and the only way one becomes a target is an explicit name on the CLI,
        // which is always honored (#255). So skip this guard for them rather
        // than emitting a misleading "not indexed" diagnostic.
        if (
            is_within_workspace(workspace_root, target.path) &&
            files_indexed >= config.cross_file.max_indexed_files &&
            !context.workspace_indexer.has_indexed_file(uri) &&
            !exclude_matcher.is_excluded_file(target.path, [workspace_root])
        ) {
            records.push(diagnostic_record(
                target.relative_path,
                index_limit_diagnostic()
            ));
            return records;
        }

        const read_result = read_source_file(target.path);
        if (read_result.kind === 'read-error') {
            // Per-file failure (e.g. file vanished or permissions changed after
            // discovery) is reported rather than aborting the whole batch.
            records.push(diagnostic_record(
                target.relative_path,
                unreadable_diagnostic(read_result.message)
            ));
            return records;
        }
        if (read_result.kind === 'decode-error') {
            records.push(diagnostic_record(
                target.relative_path,
                read_result.diagnostic
            ));
            return records;
        }

        let opened = false;
        try {
            await document_store.open(
                uri,
                read_result.text,
                1,
                workspace_symbols
            );
            opened = true;
            const state = document_store.get(uri);
            if (!state) {
                throw new Error(`failed to analyze ${target.path}`);
            }

            const diagnostics =
                await context.diagnostics_provider.get_diagnostics(
                    state,
                    config,
                    workspace_symbols,
                    context.scope_resolver
                );
            for (const diagnostic of diagnostics) {
                records.push(diagnostic_record(
                    target.relative_path,
                    diagnostic
                ));
            }
        } finally {
            if (opened) {
                document_store.close(uri);
            }
        }

        return records;
    }

    let file_index = 0;
    // A worker count must be a finite positive integer. Sanitize the internal,
    // test-facing max_parallel before clamping: non-finite values (NaN /
    // Infinity) fall back to the default, and fractional values floor. With no
    // targets there is nothing to drain (0 workers); otherwise clamp to >= 1 so
    // a caller passing max_parallel < 1 still drains every target with one
    // worker rather than silently producing zero workers and an empty result.
    const requested_parallel = Number.isFinite(max_parallel)
        ? Math.floor(max_parallel)
        : CHECK_MAX_PARALLEL;
    const worker_count =
        targets.length === 0
            ? 0
            : Math.max(1, Math.min(requested_parallel, targets.length));
    const the_workers = Array.from(
        { length: worker_count },
        async () => {
            // Per-worker store: see the concurrency invariant above. A worker
            // reuses one store across the targets it pulls, but each target is
            // closed before the next opens, so the store never holds a sibling.
            const document_store = context.create_document_store();
            try {
                while (true) {
                    const my_index = file_index++;
                    if (my_index >= targets.length) {
                        break;
                    }
                    the_slots[my_index] = await collect_target_diagnostics(
                        targets[my_index],
                        document_store
                    );
                }
            } finally {
                await document_store.dispose();
            }
        }
    );

    await Promise.all(the_workers);

    return the_slots.flat();
}

function check_help_text(): string {
    return `
sight check ${package_json.version} - full Stata diagnostics for CI

USAGE:
    sight check [OPTIONS] [PATHS...]

OPTIONS:
    --workspace DIR             Workspace root to index (default: current directory)
    --config PATH               Explicit sight.toml path
    --no-config                 Ignore sight.toml and use built-in defaults
    --format text|json|sarif    Output format (default: text)
    --max-severity LEVEL        Highest severity that does not fail the build
                                (off, hint, info, warning, error; default: info)
    --quiet                     Suppress text summary line
    --color auto|always|never   Colorize text output (default: auto)
    --no-color                  Alias for --color never
    -h, --help                  Show this help message
`.trim();
}

export async function run_check_with_cwd(
    argv: string[],
    cwd: string,
    output: CheckOutput = DEFAULT_OUTPUT
): Promise<number> {
    const result = parse_check_args(argv);
    if (!result.success) {
        output.stderr(`sight check: ${result.error}\n`);
        return EXIT_OPERATOR_ERROR;
    }
    if (result.args.help) {
        output.stdout(`${check_help_text()}\n`);
        return EXIT_OK;
    }

    const resolved_workspace_root = path.resolve(
        cwd,
        result.args.workspace ?? '.'
    );
    let is_workspace_directory = false;
    try {
        // statSync throws if the path does not exist; catching it here avoids
        // a TOCTOU race between a separate existsSync check and statSync.
        is_workspace_directory = fs.statSync(resolved_workspace_root).isDirectory();
    } catch {
        is_workspace_directory = false;
    }
    if (!is_workspace_directory) {
        output.stderr(
            `sight check: invalid workspace: ${resolved_workspace_root}\n`
        );
        return EXIT_OPERATOR_ERROR;
    }
    let workspace_root: string;
    try {
        workspace_root = canonicalize_existing_path(resolved_workspace_root);
    } catch (error) {
        output.stderr(
            `sight check: invalid workspace: ${error_message(error)}\n`
        );
        return EXIT_OPERATOR_ERROR;
    }

    const config_result = load_check_config({
        cwd,
        workspace_root,
        config_path: result.args.config_path,
        no_config: result.args.no_config,
    });
    // Both result variants carry a warnings array (auto-discovery may
    // attach a stale-.sight.json migration hint to either), so emit
    // them once here before branching on the result kind.
    for (const my_warning of config_result.warnings) {
        output.stderr(`sight check: ${my_warning.message}\n`);
    }
    if (config_result.kind === 'operator-error') {
        output.stderr(`sight check: ${config_result.message}\n`);
        return EXIT_OPERATOR_ERROR;
    }

    const target_result = collect_report_targets(
        result.args.paths,
        workspace_root,
        cwd,
        config_result.config.exclude
    );
    if (target_result.operator_errors.length > 0) {
        for (const message of target_result.operator_errors) {
            output.stderr(`sight check: ${message}\n`);
        }
        return EXIT_OPERATOR_ERROR;
    }

    let context: CheckContext | undefined;
    try {
        context = await build_check_context(
            workspace_root,
            config_result.config
        );
        const diagnostics = await collect_check_diagnostics(
            context,
            workspace_root,
            config_result.config,
            target_result.targets
        );
        const any_failure = diagnostics.some((record) =>
            !is_truncation_diagnostic(record.diagnostic) &&
            diagnostic_exceeds_threshold(
                record.diagnostic,
                result.args.max_severity
            )
        );

        if (result.args.format === OutputFormat.Json) {
            output.stdout(render_json(diagnostics));
        } else if (result.args.format === OutputFormat.Sarif) {
            output.stdout(render_sarif(diagnostics, package_json.version));
        } else {
            output.stdout(render_text(diagnostics, {
                quiet: result.args.quiet,
                use_color: resolve_color_from_env(result.args.color),
            }));
        }

        return any_failure ? EXIT_CHECK_FAILED : EXIT_OK;
    } catch (error) {
        output.stderr(
            `sight check: ${error_message(error)}\n`
        );
        return EXIT_OPERATOR_ERROR;
    } finally {
        if (context) {
            await context.document_store.dispose();
        }
    }
}

export async function run_check(argv: string[]): Promise<number> {
    return run_check_with_cwd(argv, process.cwd(), DEFAULT_OUTPUT);
}
