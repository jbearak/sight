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
import { ScopeResolver } from '../scope-resolver';
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
    read_source_file,
    size_limit_diagnostic,
    unreadable_diagnostic,
} from './source-files';
import {
    ColorChoice,
    DiagnosticRecord,
    EXIT_CHECK_FAILED,
    EXIT_OK,
    EXIT_OPERATOR_ERROR,
    OutputFormat,
    SeverityLevel,
    diagnostic_exceeds_threshold,
    error_message,
    parse_color_choice,
    parse_output_format,
    parse_severity_level,
    render_json,
    render_sarif,
    render_text,
    resolve_color_from_env,
} from './shared';

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
        const raw = argv[i];
        // Support both `--flag value` and `--flag=value`. Splitting on the
        // first '=' lets a value legally begin with '-' (e.g. an odd path).
        let arg = raw;
        let inline_value: string | undefined;
        if (raw.startsWith('--')) {
            const eq = raw.indexOf('=');
            if (eq !== -1) {
                arg = raw.slice(0, eq);
                inline_value = raw.slice(eq + 1);
            }
        }
        switch (arg) {
            case '--workspace':
                {
                    const parsed = parse_required_option_value(
                        argv,
                        i,
                        '--workspace',
                        'a path',
                        inline_value
                    );
                    if (!parsed.success) return parsed;
                    args.workspace = parsed.value;
                    if (inline_value === undefined) i++;
                }
                break;
            case '--config':
                {
                    const parsed = parse_required_option_value(
                        argv,
                        i,
                        '--config',
                        'a path',
                        inline_value
                    );
                    if (!parsed.success) return parsed;
                    args.config_path = parsed.value;
                    if (inline_value === undefined) i++;
                }
                break;
            case '--no-config':
                args.no_config = true;
                break;
            case '--format':
                {
                    const parsed = parse_enum_option(
                        argv,
                        i,
                        '--format',
                        parse_output_format,
                        inline_value
                    );
                    if (!parsed.success) return parsed;
                    args.format = parsed.value;
                    if (inline_value === undefined) i++;
                }
                break;
            case '--max-severity':
                {
                    const parsed = parse_enum_option(
                        argv,
                        i,
                        '--max-severity',
                        parse_severity_level,
                        inline_value
                    );
                    if (!parsed.success) return parsed;
                    args.max_severity = parsed.value;
                    if (inline_value === undefined) i++;
                }
                break;
            case '--quiet':
                args.quiet = true;
                break;
            case '--color':
                {
                    const parsed = parse_enum_option(
                        argv,
                        i,
                        '--color',
                        parse_color_choice,
                        inline_value
                    );
                    if (!parsed.success) return parsed;
                    args.color = parsed.value;
                    if (inline_value === undefined) i++;
                }
                break;
            case '--no-color':
                args.color = ColorChoice.Never;
                break;
            case '--help':
            case '-h':
                args.help = true;
                break;
            default:
                if (arg.startsWith('-')) {
                    return { success: false, error: `Unknown flag: ${arg}` };
                }
                args.paths.push(arg);
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
    | { kind: 'operator-error'; message: string };

export function load_check_config(options: {
    cwd: string;
    workspace_root: string;
    config_path?: string;
    no_config: boolean;
}): CheckConfigResult {
    if (options.no_config) {
        return {
            kind: 'loaded',
            config: validate_comment_formatting_config(DEFAULT_SETTINGS),
            warnings: [],
        };
    }

    const loaded = options.config_path
        ? load_toml_file(path.resolve(options.cwd, options.config_path))
        : discover_and_load_project_config(options.workspace_root);

    if (loaded.kind === 'load-failed') {
        return {
            kind: 'operator-error',
            message: `failed to load ${loaded.path}: ${loaded.error}`,
        };
    }

    if (loaded.kind === 'none') {
        return {
            kind: 'loaded',
            config: validate_comment_formatting_config(DEFAULT_SETTINGS),
            warnings: loaded.warnings,
        };
    }

    return {
        kind: 'loaded',
        config: validate_comment_formatting_config(
            deep_merge_config(DEFAULT_SETTINGS, loaded.partial_config)
        ),
        warnings: loaded.warnings,
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
    const document_store = new DocumentStore();
    const diagnostics_provider = new DiagnosticsProvider({
        sendDiagnostics: () => undefined,
    });

    workspace_indexer.configure(config);
    workspace_indexer.set_max_indexed_files(
        config.cross_file.max_indexed_files
    );
    workspace_indexer.set_dependency_graph(dependency_graph);
    scope_resolver.set_dependency_graph(dependency_graph);
    scope_resolver.set_forward_scope_resolver(forward_scope_resolver);
    diagnostics_provider.set_dependency_graph(dependency_graph);
    scope_resolver.set_workspace_roots([workspace_root]);
    forward_scope_resolver.set_workspace_roots([workspace_root]);
    document_store.set_workspace_roots([workspace_root]);
    document_store.set_scope_resolver(scope_resolver);
    document_store.set_on_backward_directives_parsed((uri, directives) => {
        workspace_indexer.set_buffer_directives(uri, directives);
    });

    await workspace_indexer.initialize([workspace_root], config.adoPaths);

    return {
        dependency_graph,
        workspace_indexer,
        scope_resolver,
        forward_scope_resolver,
        document_store,
        diagnostics_provider,
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

export async function collect_check_diagnostics(
    context: CheckContext,
    workspace_root: string,
    config: StataLSPConfig,
    targets: ReportTarget[]
): Promise<DiagnosticRecord[]> {
    const records: DiagnosticRecord[] = [];
    const workspace_symbols = context.workspace_indexer.get_all_symbols();
    const files_indexed = context.workspace_indexer.get_metrics().files_indexed;

    for (const target of targets) {
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
                unreadable_diagnostic(`${target.path}: ${error_message(error)}`)
            ));
            continue;
        }
        if (stats.size > config.indexing.maxFileSizeBytes) {
            // Explicit targets get a visible diagnostic so the user learns why
            // a file they named was skipped; walked targets are skipped
            // silently, matching the indexer's own size handling.
            if (target.explicit) {
                records.push(diagnostic_record(
                    target.relative_path,
                    size_limit_diagnostic(
                        target.path,
                        stats.size,
                        config.indexing.maxFileSizeBytes
                    )
                ));
            }
            continue;
        }
        if (
            target.explicit &&
            is_within_workspace(workspace_root, target.path) &&
            files_indexed >= config.cross_file.max_indexed_files &&
            !context.workspace_indexer.has_indexed_file(uri)
        ) {
            records.push(diagnostic_record(
                target.relative_path,
                index_limit_diagnostic(target.path)
            ));
            continue;
        }

        const read_result = read_source_file(target.path);
        if (read_result.kind === 'read-error') {
            // Per-file failure (e.g. file vanished or permissions changed after
            // discovery) is reported rather than aborting the whole batch.
            records.push(diagnostic_record(
                target.relative_path,
                unreadable_diagnostic(read_result.message)
            ));
            continue;
        }
        if (read_result.kind === 'decode-error') {
            records.push(diagnostic_record(
                target.relative_path,
                read_result.diagnostic
            ));
            continue;
        }

        let opened = false;
        try {
            await context.document_store.open(
                uri,
                read_result.text,
                1,
                workspace_symbols
            );
            opened = true;
            const state = context.document_store.get(uri);
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
                context.document_store.close(uri);
            }
        }
    }

    return records;
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
    if (
        !fs.existsSync(resolved_workspace_root) ||
        !fs.statSync(resolved_workspace_root).isDirectory()
    ) {
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
    if (config_result.kind === 'operator-error') {
        output.stderr(`sight check: ${config_result.message}\n`);
        return EXIT_OPERATOR_ERROR;
    }
    for (const warning of config_result.warnings) {
        output.stderr(`sight check: ${warning.message}\n`);
    }

    const target_result = collect_report_targets(
        result.args.paths,
        workspace_root,
        cwd
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
