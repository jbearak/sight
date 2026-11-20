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
import { DependencyGraph } from '../dependency-graph';
import { ScopeResolver, scope_resolver_config_for } from '../scope-resolver';
import { analyze_source, prepare_forward_calls } from '../source-analysis';
import {
    CdCommand,
    CommandNode,
    DirectiveParseResult,
    ForwardCall,
    ForwardCallType,
    StataLSPConfig,
    StataNode,
    Token,
} from '../types';
import {
    is_resolvable_static_call,
    resolve_forward_call_rich,
} from '../utils/file-path-utils';
import { resolve_working_directory_directive } from '../utils/workspace-roots';
import {
    merge_forward_calls,
    settle_inherited_working_directories,
    type WorkingDirectoryFacts,
} from '../indexer/settle-working-directories';
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
 * Tokens that end a word and add no text of their own: a line
 * comment, a `///` line break, the end of the statement.
 */
const WORD_BREAK_TYPES: ReadonlySet<string> = new Set([
    'WHITESPACE', 'COMMENT_LINE', 'CONTINUATION', 'STATEMENT_TERMINATOR',
    'EOF',
]);

function compare_positions(a: Range['start'], b: Range['start']): number {
    return a.line - b.line || a.character - b.character;
}

/** Index of the first token that starts at or after `position`. */
function first_token_at(tokens: Token[], position: Range['start']): number {
    let low = 0;
    let high = tokens.length;
    while (low < high) {
        const middle = (low + high) >> 1;
        if (compare_positions(tokens[middle].range.start, position) < 0) {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    return low;
}

/**
 * The text of `tokens` from `start` to `end` as Stata reads it once
 * comments are gone (Stata 18): a block comment vanishes, so `a`, a
 * block comment and `b` with no space between them read `ab`, while
 * space, a line comment and a `///` line break become one space.
 */
function text_without_comments(
    tokens: Token[],
    start: Range['start'],
    end: Range['start'],
): string {
    const the_parts: string[] = [];
    let previous_end: Range['start'] | null = null;
    for (let i = first_token_at(tokens, start); i < tokens.length; i++) {
        const my_token = tokens[i];
        if (compare_positions(my_token.range.start, end) >= 0) {
            break;
        }
        if (WORD_BREAK_TYPES.has(my_token.type)) {
            the_parts.push(' ');
            previous_end = null;
            continue;
        }
        if (previous_end !== null &&
            compare_positions(previous_end, my_token.range.start) !== 0) {
            the_parts.push(' ');
        }
        if (my_token.type !== 'COMMENT_BLOCK') {
            the_parts.push(my_token.value);
        }
        previous_end = my_token.range.end;
    }
    return the_parts.join('');
}

/** End of the compound-quoted string `` `"..."' `` that starts at `start`. */
function compound_quote_end(text: string, start: number): number {
    let depth = 0;
    let i = start;
    while (i < text.length) {
        if (text.startsWith('`"', i)) {
            depth++;
            i += 2;
        } else if (text.startsWith('"\'', i)) {
            depth--;
            i += 2;
            if (depth === 0) {
                return i;
            }
        } else {
            i++;
        }
    }
    return text.length;
}

function is_space(character: string): boolean {
    return character === ' ' || character === '\t';
}

/**
 * Split `text` into words as `args` does: at spaces, with a quoted
 * (`"a b"`) or compound-quoted (`` `"a "b" c"' ``) string as one word
 * even where it touches other text (`a"b c"d` is three words). Words
 * keep their quotes as written.
 */
function split_words(text: string): string[] {
    const the_words: string[] = [];
    let i = 0;
    while (i < text.length) {
        if (is_space(text[i])) {
            i++;
            continue;
        }
        const end = word_end(text, i, false);
        the_words.push(text.slice(i, end));
        i = end;
    }
    return the_words;
}

/**
 * Where the word that starts at `start` ends: after the closing quote
 * of a quoted or compound-quoted string, else at a space or quote (and
 * at a comma when `stop_at_comma`).
 */
function word_end(text: string, start: number, stop_at_comma: boolean): number {
    if (text.startsWith('`"', start)) {
        return compound_quote_end(text, start);
    }
    if (text[start] === '"') {
        const close = text.indexOf('"', start + 1);
        return close < 0 ? text.length : close + 1;
    }
    let end = start;
    while (end < text.length && !is_space(text[end]) &&
        text[end] !== '"' && !text.startsWith('`"', end) &&
        !(stop_at_comma && text[end] === ',')) {
        end++;
    }
    return end;
}

/**
 * What a `do` or `run` command passes to the do-file: the words after
 * the path and before the first comma, as `args` reads them (Stata
 * 18). The first comma ends them, even inside quotes; what follows is
 * `do`'s own options (`nostop`), and Stata rejects any other option
 * without running the file. `include` passes nothing. Qualifier-like
 * words are ordinary words here (`if price > 100`).
 */
function call_arguments(
    call_type: ForwardCallType,
    node: CommandNode | undefined,
    tokens: Token[],
): string[] {
    if (node === undefined || call_type === 'include') {
        return [];
    }
    const the_items = [...(node.varlist ?? []), ...(node.extra_args ?? [])];
    let path_start: Range['start'] | undefined;
    for (const my_item of the_items) {
        if (path_start === undefined ||
            compare_positions(my_item.range.start, path_start) < 0) {
            path_start = my_item.range.start;
        }
    }
    if (path_start === undefined) {
        return [];
    }
    const text = text_without_comments(tokens, path_start, node.range.end);
    // The path is the first word; a comma inside a quoted path
    // (`do "survey, wave 1.do" 2019`) is part of it.
    let path_begin = 0;
    while (path_begin < text.length && is_space(text[path_begin])) {
        path_begin++;
    }
    const path_end = word_end(text, path_begin, true);
    const comma = text.indexOf(',', path_end);
    return split_words(text.slice(path_end, comma < 0 ? text.length : comma));
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
    // Auto-discovered parents, so a file inherits the working directory
    // of a parent that calls it without directives, as in `sight check`.
    const dependency_graph = new DependencyGraph();
    dependency_graph.set_workspace_roots([root]);
    scope_resolver.set_dependency_graph(dependency_graph);

    const the_files: GraphDocument['files'] = [];
    const the_edges: GraphEdge[] = [];
    const the_paths = [...options.file_paths].sort((a, b) =>
        display_path(a) < display_path(b) ? -1 : display_path(a) > display_path(b) ? 1 : 0);

    // Facts each file keeps for working-directory resolution and its
    // edges, so the graph holds no file's tokens or AST past its read.
    interface FileFacts extends WorkingDirectoryFacts {
        my_path: string;
        caller: string;
        command_calls: ForwardCall[];
        cd_commands: CdCommand[];
        directives: DirectiveParseResult;
        arguments_by_range: Map<string, string[]>;
    }
    const the_facts: FileFacts[] = [];

    // Command calls resolve against the working directory the file runs
    // in. Forward directives resolve against the file's own directory,
    // or one it sets or explicitly inherits, never one inherited from
    // an auto-discovered caller (docs/cross-file.md, Working Directory).
    const forward_calls_for = (facts: FileFacts): ForwardCall[] => [
        ...prepare_forward_calls({
            uri: facts.uri,
            command_calls: facts.command_calls,
            directive_calls: [],
            cd_commands: facts.cd_commands,
            working_directory: facts.working_directory,
            workspace_roots: [root],
        }),
        ...prepare_forward_calls({
            uri: facts.uri,
            command_calls: [],
            directive_calls: facts.directives.forward_calls ?? [],
            cd_commands: [],
            working_directory: facts.directive_working_directory,
            directives_beside_caller: !facts.has_backward_directives,
            workspace_roots: [root],
        }),
    ];

    // Register a file's calls, recording each callee's edge call.
    const register = (facts: FileFacts): void => {
        const the_calls = forward_calls_for(facts);
        const the_command_calls = the_calls.filter(
            my_call => my_call.source === 'command');
        const the_directive_calls = the_calls.filter(
            my_call => my_call.source !== 'command');
        facts.first_calls = new Map();
        dependency_graph.update_caller(
            facts.uri,
            merge_forward_calls(the_command_calls, the_directive_calls),
            facts.first_calls,
        );
    };
    // Parents come from the graph only in 'auto' mode, the default.
    const auto_parents =
        (scope_resolver_config.backward_dependencies ?? 'auto') === 'auto';

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

        const the_commands = new Map<string, CommandNode>();
        index_commands(source.ast.nodes, the_commands);
        const arguments_by_range = new Map<string, string[]>();
        for (const my_call of source.analysis.forward_calls) {
            const key = range_key(my_call.range);
            arguments_by_range.set(key, call_arguments(
                my_call.type, the_commands.get(key), source.tokens));
        }

        const own_working_directory = directives.working_directory
            ? resolve_working_directory_directive(directives.working_directory, root)
            : undefined;
        const directive_working_directory = own_working_directory ??
            await scope_resolver.resolve_inherited_working_directory(
                directives.directives, uri, is_standalone, scope_resolver_config);
        const facts: FileFacts = {
            my_path,
            caller,
            uri,
            command_calls: source.analysis.forward_calls,
            cd_commands: source.analysis.cd_commands,
            directives,
            arguments_by_range,
            own_working_directory,
            directive_working_directory,
            has_backward_directives:
                !is_standalone && directives.directives.length > 0,
            explicit_parents:
                !is_standalone && directives.directives.length > 0
                    ? scope_resolver.explicit_parent_uris(
                        directives.directives, uri)
                    : undefined,
            inherits_from_callers: auto_parents &&
                own_working_directory === undefined &&
                !is_standalone && directives.directives.length === 0,
            working_directory: directive_working_directory,
            first_calls: new Map(),
        };
        register(facts);
        the_facts.push(facts);
    }

    // The calls above used each file's own or explicitly inherited
    // working directory. Settle the directories files inherit from the
    // callers that reach them, by the same rule as the workspace index
    // that `sight check` uses.
    let the_blocked = new Map<string, string | undefined>();
    if (auto_parents) {
        the_blocked = settle_inherited_working_directories({
            the_facts,
            get_parents: (uri) => dependency_graph.get_parents(uri),
            register,
            max_backward_depth: scope_resolver_config.max_backward_depth,
        });
    }

    for (const my_facts of the_facts) {
        const { my_path, caller, directives } = my_facts;
        const caller_dir = path.dirname(my_path);
        const the_file_edges: GraphEdge[] = [];

        // A file whose walk passes through a call made after a literal
        // `cd` passes no directory on, but is itself shown with the one
        // `sight check` and the editor give it, the walk's.
        let shown_facts = my_facts;
        if (the_blocked.has(my_facts.uri)) {
            const working_directory = the_blocked.get(my_facts.uri) ??
                await scope_resolver.resolve_document_working_directory(
                    my_facts.uri, directives, scope_resolver_config);
            shown_facts = { ...my_facts, working_directory };
        }

        for (const my_call of forward_calls_for(shown_facts)) {
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
                    ? my_facts.arguments_by_range.get(
                        range_key(my_call.range)) ?? []
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
