import * as fs from 'fs';
import * as path from 'path';
import { URI } from 'vscode-uri';
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
import {
    ColorChoice,
    EXIT_OPERATOR_ERROR,
    OutputFormat,
    SeverityLevel,
    parse_color_choice,
    parse_output_format,
    parse_severity_level,
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
        const arg = argv[i];
        switch (arg) {
            case '--workspace':
                if (argv[i + 1] === undefined) {
                    return { success: false, error: '--workspace needs a path' };
                }
                args.workspace = argv[++i];
                break;
            case '--config':
                if (argv[i + 1] === undefined) {
                    return { success: false, error: '--config needs a path' };
                }
                args.config_path = argv[++i];
                break;
            case '--no-config':
                args.no_config = true;
                break;
            case '--format':
                if (argv[i + 1] === undefined) {
                    return { success: false, error: '--format needs a value' };
                }
                try {
                    args.format = parse_output_format(argv[++i]);
                } catch (error) {
                    return {
                        success: false,
                        error: error instanceof Error
                            ? error.message
                            : String(error),
                    };
                }
                break;
            case '--max-severity':
                if (argv[i + 1] === undefined) {
                    return {
                        success: false,
                        error: '--max-severity needs a value',
                    };
                }
                try {
                    args.max_severity = parse_severity_level(argv[++i]);
                } catch (error) {
                    return {
                        success: false,
                        error: error instanceof Error
                            ? error.message
                            : String(error),
                    };
                }
                break;
            case '--quiet':
                args.quiet = true;
                break;
            case '--color':
                if (argv[i + 1] === undefined) {
                    return { success: false, error: '--color needs a value' };
                }
                try {
                    args.color = parse_color_choice(argv[++i]);
                } catch (error) {
                    return {
                        success: false,
                        error: error instanceof Error
                            ? error.message
                            : String(error),
                    };
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
    const dependency_graph = new DependencyGraph();
    const workspace_indexer = new WorkspaceIndexer();
    const scope_resolver = new ScopeResolver({
        log: (message) => {
            if (config.debug === true) {
                console.error(message);
            }
        },
        warn: (message) => console.error(message),
    }, {
        read_file: async (uri: string) =>
            fs.promises.readFile(URI.parse(uri).fsPath, 'utf8'),
        exists: async (uri: string) => {
            try {
                await fs.promises.access(URI.parse(uri).fsPath);
                return true;
            } catch {
                return false;
            }
        },
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

export async function run_check(argv: string[]): Promise<number> {
    const result = parse_check_args(argv);
    if (!result.success) {
        console.error(`sight check: ${result.error}`);
        return 1;
    }
    if (result.args.help) {
        return 0;
    }
    console.error('sight check: batch diagnostics are unavailable before Task 6');
    return EXIT_OPERATOR_ERROR;
}
