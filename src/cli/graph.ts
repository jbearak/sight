/**
 * `sight graph --json [ROOT]`: print a project's do/run/include graph as
 * versioned JSON, with one edge per call site, resolved targets (after
 * `cd` and `sight: cd`), entry points, and cycles. See docs/cli.md.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Range } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import package_json from '../../package.json' with { type: 'json' };
import { ScopeResolver, scope_resolver_config_for } from '../scope-resolver';
import { analyze_source, prepare_forward_calls } from '../source-analysis';
import {
    CommandNode,
    ForwardCall,
    ForwardCallType,
    StataLSPConfig,
    StataNode,
} from '../types';
import {
    is_resolvable_static_call,
    resolve_forward_call_rich,
} from '../utils/file-path-utils';
import { resolve_working_directory_directive } from '../utils/workspace-roots';
import { load_check_config } from './check';
import {
    canonicalize_existing_path,
    collect_report_targets,
    read_source_file,
} from './source-files';
import { EXIT_OK, EXIT_OPERATOR_ERROR, error_message } from './shared';

/** Version of the JSON shape; see PARSE_SCHEMA_VERSION for the policy. */
export const GRAPH_SCHEMA_VERSION = 1;

/** Files that make up the graph. `.mata` files cannot be `do`ne. */
const GRAPH_EXTENSIONS: ReadonlySet<string> = new Set(['.do', '.ado', '.doh']);

export interface GraphArgs {
    json: boolean;
    help: boolean;
    root?: string;
    config_path?: string;
    no_config: boolean;
}

export type GraphArgsResult =
    | { success: true; args: GraphArgs }
    | { success: false; error: string };

export interface GraphOutput {
    stdout(text: string): void;
    stderr(text: string): void;
}

const DEFAULT_OUTPUT: GraphOutput = {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
};

export function parse_graph_args(argv: string[]): GraphArgsResult {
    const args: GraphArgs = { json: false, help: false, no_config: false };
    for (let i = 0; i < argv.length; i++) {
        const my_arg = argv[i];
        switch (my_arg) {
            case '--json':
                args.json = true;
                continue;
            case '--no-config':
                args.no_config = true;
                continue;
            case '--config': {
                const value = argv[i + 1];
                if (value === undefined || value.startsWith('-')) {
                    return { success: false, error: '--config needs a PATH' };
                }
                args.config_path = value;
                i++;
                continue;
            }
            case '-h':
            case '--help':
                args.help = true;
                continue;
        }
        if (my_arg.startsWith('-') && my_arg !== '-') {
            return { success: false, error: `unknown option: ${my_arg}` };
        }
        if (args.root !== undefined) {
            return { success: false, error: 'only one ROOT may be given' };
        }
        args.root = my_arg;
    }
    if (args.help) {
        return { success: true, args };
    }
    if (!args.json) {
        return { success: false, error: 'only JSON output is available; pass --json' };
    }
    if (args.config_path !== undefined && args.no_config) {
        return { success: false, error: '--config and --no-config cannot be combined' };
    }
    return { success: true, args };
}

function graph_help_text(): string {
    return `
sight graph ${package_json.version} - do/run/include graph of a project as JSON

USAGE:
    sight graph --json [OPTIONS] [ROOT]

ROOT defaults to the current directory and is indexed like "sight check"
(sight.toml, .gitignore, workspace.exclude). The schema (schema_version
${GRAPH_SCHEMA_VERSION}) is documented in docs/cli.md.

OPTIONS:
    --json            Print JSON (required)
    --config PATH     Explicit sight.toml path
    --no-config       Ignore sight.toml and use built-in defaults
    -h, --help        Show this help message
`.trim();
}

type Resolution = 'exact' | 'case_only' | 'ambiguous' | 'missing' | 'dynamic';

export interface GraphEdge {
    caller: string;
    call_type: ForwardCallType;
    range: Range;
    raw_path: string;
    arguments: string[];
    static: boolean;
    source: 'command' | 'directive' | 'backward_directive';
    working_directory: string | null;
    target: string | null;
    resolution: Resolution;
}

export interface GraphDocument {
    schema_version: number;
    sight_version: string;
    root: string;
    files: Array<{ path: string; standalone: boolean; error: string | null }>;
    entry_points: string[];
    edges: GraphEdge[];
    unresolved: number[];
    cycles: string[][];
}

function is_resolved(edge: GraphEdge): boolean {
    return edge.resolution === 'exact' || edge.resolution === 'case_only';
}

function range_key(range: Range): string {
    return `${range.start.line}:${range.start.character}-${range.end.line}:${range.end.character}`;
}

/** Index every command node by its range, at any depth. */
function index_commands(nodes: StataNode[], into: Map<string, CommandNode>): void {
    for (const my_node of nodes) {
        if (my_node.type === 'command') {
            into.set(range_key(my_node.range), my_node);
        }
        if ('body' in my_node && Array.isArray(my_node.body)) {
            index_commands(my_node.body, into);
        }
    }
}

/**
 * Raw argument items after the path of a `do`/`run`/`include` command.
 * A quoted path with a macro inside is several adjacent varlist items
 * (`"step` `` `wave' `` `.do"`), so the path runs until the first gap.
 */
function call_arguments(node: CommandNode | undefined): string[] {
    if (node === undefined) {
        return [];
    }
    const the_items = [...(node.varlist ?? []), ...(node.extra_args ?? [])];
    the_items.sort((a, b) =>
        a.range.start.line - b.range.start.line ||
        a.range.start.character - b.range.start.character);
    let path_end = 1;
    while (path_end < the_items.length) {
        const previous = the_items[path_end - 1].range.end;
        const next = the_items[path_end].range.start;
        if (previous.line !== next.line || previous.character !== next.character) {
            break;
        }
        path_end++;
    }
    return the_items.slice(path_end).map((my_item) => my_item.name);
}

/**
 * Strongly connected components with more than one member, or one member
 * that calls itself (Tarjan's algorithm, iterative).
 */
export function find_cycles(adjacency: Map<string, Set<string>>): string[][] {
    const index_of = new Map<string, number>();
    const low_of = new Map<string, number>();
    const on_stack = new Set<string>();
    const the_stack: string[] = [];
    const the_cycles: string[][] = [];
    let next_index = 0;

    const the_nodes = [...adjacency.keys()].sort();
    for (const my_root of the_nodes) {
        if (index_of.has(my_root)) {
            continue;
        }
        // Each frame: node and an iterator over its successors.
        const the_frames: Array<{ node: string; successors: Iterator<string> }> = [];
        const visit = (node: string): void => {
            index_of.set(node, next_index);
            low_of.set(node, next_index);
            next_index++;
            the_stack.push(node);
            on_stack.add(node);
            const successors = [...(adjacency.get(node) ?? [])].sort();
            the_frames.push({ node, successors: successors[Symbol.iterator]() });
        };
        visit(my_root);
        while (the_frames.length > 0) {
            const frame = the_frames[the_frames.length - 1];
            const next = frame.successors.next();
            if (!next.done) {
                const successor = next.value;
                if (!index_of.has(successor)) {
                    visit(successor);
                } else if (on_stack.has(successor)) {
                    low_of.set(frame.node, Math.min(
                        low_of.get(frame.node) ?? 0, index_of.get(successor) ?? 0));
                }
                continue;
            }
            the_frames.pop();
            const parent = the_frames[the_frames.length - 1];
            if (parent !== undefined) {
                low_of.set(parent.node, Math.min(
                    low_of.get(parent.node) ?? 0, low_of.get(frame.node) ?? 0));
            }
            if (low_of.get(frame.node) === index_of.get(frame.node)) {
                const the_component: string[] = [];
                for (;;) {
                    const member = the_stack.pop();
                    if (member === undefined) {
                        break;
                    }
                    on_stack.delete(member);
                    the_component.push(member);
                    if (member === frame.node) {
                        break;
                    }
                }
                const calls_itself = adjacency.get(frame.node)?.has(frame.node) === true;
                if (the_component.length > 1 || calls_itself) {
                    the_cycles.push(the_component.sort());
                }
            }
        }
    }
    return the_cycles.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

/** Build the graph document for files under `root`. */
export async function build_graph_document(options: {
    root: string;
    config: StataLSPConfig;
    file_paths: string[];
    sight_version: string;
    /** Receives a message for each file that cannot be read. */
    warn?: (message: string) => void;
}): Promise<GraphDocument> {
    const { root, config } = options;
    const display_path = (fs_path: string): string => {
        const relative = path.relative(root, fs_path);
        return relative === '' || relative.startsWith('..') || path.isAbsolute(relative)
            ? fs_path.split(path.sep).join('/')
            : relative.split(path.sep).join('/');
    };

    const scope_resolver = new ScopeResolver({
        log: () => undefined,
        warn: () => undefined,
    }, undefined, {
        max_cached_files: config.cross_file.max_cached_files,
        max_cached_scopes: config.cross_file.max_cached_scopes,
    });
    scope_resolver.set_workspace_roots([root]);
    const scope_resolver_config = scope_resolver_config_for(config);

    const the_files: GraphDocument['files'] = [];
    const the_edges: GraphEdge[] = [];
    const the_paths = [...options.file_paths].sort((a, b) =>
        display_path(a) < display_path(b) ? -1 : display_path(a) > display_path(b) ? 1 : 0);

    for (const my_path of the_paths) {
        const caller = display_path(my_path);
        const read = read_source_file(my_path);
        if (read.kind !== 'ok') {
            // Keep the file, so edges that resolve to it still point at a
            // listed file, but it contributes no edges of its own.
            const detail = read.kind === 'read-error' ? read.message : read.diagnostic.message;
            options.warn?.(`${caller}: ${detail}; its calls are not in the graph`);
            the_files.push({ path: caller, standalone: false, error: detail });
            continue;
        }
        const uri = URI.file(my_path).toString();
        const source = analyze_source(read.text, uri);
        const directives = source.directives;
        const is_standalone = directives.standalone !== undefined;
        the_files.push({ path: caller, standalone: is_standalone, error: null });

        const own_working_directory = directives.working_directory
            ? resolve_working_directory_directive(directives.working_directory, root)
            : undefined;
        const working_directory = own_working_directory ??
            await scope_resolver.resolve_inherited_working_directory(
                directives.directives, uri, is_standalone, scope_resolver_config);

        const the_calls: ForwardCall[] = prepare_forward_calls({
            uri,
            command_calls: source.analysis.forward_calls,
            directive_calls: directives.forward_calls ?? [],
            cd_commands: source.analysis.cd_commands,
            working_directory,
            workspace_roots: [root],
        });

        const the_commands = new Map<string, CommandNode>();
        index_commands(source.ast.nodes, the_commands);
        const caller_dir = path.dirname(my_path);
        const the_file_edges: GraphEdge[] = [];

        for (const my_call of the_calls) {
            let target: string | null = null;
            let resolution: Resolution = 'dynamic';
            if (is_resolvable_static_call(my_call)) {
                const outcome = resolve_forward_call_rich(
                    my_call.raw_path,
                    caller_dir,
                    my_call.working_directory,
                    { workspace_roots: [root] },
                );
                resolution = outcome.kind;
                if (outcome.kind === 'exact' || outcome.kind === 'case_only') {
                    target = display_path(outcome.path);
                }
            }
            the_file_edges.push({
                caller,
                call_type: my_call.type,
                range: my_call.range,
                raw_path: my_call.raw_path,
                arguments: my_call.source === 'command'
                    ? call_arguments(the_commands.get(range_key(my_call.range)))
                    : [],
                static: my_call.is_static,
                source: my_call.source,
                working_directory: my_call.working_directory ?? null,
                target,
                resolution,
            });
        }

        // Backward directives in this file declare a parent that calls it.
        // Resolve the parent case-aware, like a forward call.
        for (const my_directive of directives.directives) {
            const outcome = resolve_forward_call_rich(
                my_directive.path,
                caller_dir,
                undefined,
                { workspace_roots: [root] },
            );
            const parent_path = outcome.kind === 'exact' || outcome.kind === 'case_only'
                ? outcome.path
                : my_directive.path;
            the_file_edges.push({
                caller: display_path(parent_path),
                call_type: my_directive.type === 'included-by' ? 'include' : 'do',
                range: my_directive.range,
                raw_path: my_directive.raw_path,
                arguments: [],
                static: true,
                source: 'backward_directive',
                working_directory: null,
                target: caller,
                resolution: outcome.kind,
            });
        }

        the_edges.push(...the_file_edges);
    }

    // By caller; a caller's call sites in source order, then the
    // backward-directive edges that name it as parent, by target.
    const compare_text = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
    the_edges.sort((a, b) => {
        const by_caller = compare_text(a.caller, b.caller);
        if (by_caller !== 0) {
            return by_caller;
        }
        const a_backward = a.source === 'backward_directive';
        const b_backward = b.source === 'backward_directive';
        if (a_backward !== b_backward) {
            return a_backward ? 1 : -1;
        }
        if (a_backward) {
            return compare_text(a.target ?? '', b.target ?? '');
        }
        return a.range.start.line - b.range.start.line ||
            a.range.start.character - b.range.start.character;
    });

    const the_unresolved: number[] = [];
    const has_incoming = new Set<string>();
    const adjacency = new Map<string, Set<string>>();
    the_edges.forEach((my_edge, i) => {
        if (!is_resolved(my_edge) || my_edge.target === null) {
            the_unresolved.push(i);
            return;
        }
        if (my_edge.caller !== my_edge.target) {
            has_incoming.add(my_edge.target);
        }
        const successors = adjacency.get(my_edge.caller) ?? new Set<string>();
        successors.add(my_edge.target);
        adjacency.set(my_edge.caller, successors);
        if (!adjacency.has(my_edge.target)) {
            adjacency.set(my_edge.target, new Set());
        }
    });

    return {
        schema_version: GRAPH_SCHEMA_VERSION,
        sight_version: options.sight_version,
        root,
        files: the_files,
        entry_points: the_files
            .map((my_file) => my_file.path)
            .filter((my_path) => !has_incoming.has(my_path)),
        edges: the_edges,
        unresolved: the_unresolved,
        cycles: find_cycles(adjacency),
    };
}

/** Run `sight graph` with `cwd` for relative paths. */
export async function run_graph_with_cwd(
    argv: string[],
    cwd: string,
    output: GraphOutput = DEFAULT_OUTPUT
): Promise<number> {
    const result = parse_graph_args(argv);
    if (!result.success) {
        output.stderr(`sight graph: ${result.error}\n`);
        return EXIT_OPERATOR_ERROR;
    }
    if (result.args.help) {
        output.stdout(`${graph_help_text()}\n`);
        return EXIT_OK;
    }

    let root: string;
    try {
        const resolved = path.resolve(cwd, result.args.root ?? '.');
        if (!fs.statSync(resolved).isDirectory()) {
            throw new Error(`not a directory: ${resolved}`);
        }
        root = canonicalize_existing_path(resolved);
    } catch (error) {
        output.stderr(`sight graph: invalid ROOT: ${error_message(error)}\n`);
        return EXIT_OPERATOR_ERROR;
    }

    const config_result = load_check_config({
        cwd,
        workspace_root: root,
        config_path: result.args.config_path,
        no_config: result.args.no_config,
    });
    for (const my_warning of config_result.warnings) {
        output.stderr(`sight graph: ${my_warning.message}\n`);
    }
    if (config_result.kind === 'operator-error') {
        output.stderr(`sight graph: ${config_result.message}\n`);
        return EXIT_OPERATOR_ERROR;
    }

    const targets = collect_report_targets(
        [],
        root,
        cwd,
        config_result.config.exclude,
        config_result.config.workspace.respectGitignore
    );
    if (targets.operator_errors.length > 0) {
        for (const my_message of targets.operator_errors) {
            output.stderr(`sight graph: ${my_message}\n`);
        }
        return EXIT_OPERATOR_ERROR;
    }

    try {
        const document = await build_graph_document({
            root,
            config: config_result.config,
            file_paths: targets.targets
                .map((my_target) => my_target.path)
                .filter((my_path) => GRAPH_EXTENSIONS.has(path.extname(my_path).toLowerCase())),
            sight_version: package_json.version,
            warn: (message) => output.stderr(`sight graph: ${message}\n`),
        });
        output.stdout(`${JSON.stringify(document)}\n`);
        return EXIT_OK;
    } catch (error) {
        output.stderr(`sight graph: ${error_message(error)}\n`);
        return EXIT_OPERATOR_ERROR;
    }
}

export async function run_graph(argv: string[]): Promise<number> {
    return run_graph_with_cwd(argv, process.cwd(), DEFAULT_OUTPUT);
}
