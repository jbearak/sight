/**
 * The macros a command statement writes.
 *
 * One place holds Stata's rules for which commands define a macro
 * other than through `local`/`global`, and at which word:
 *
 *     tempvar a b          // locals a and b (also tempname, tempfile)
 *     marksample touse     // local touse (one name only)
 *     args x y             // locals x and y
 *     unab vars : *        // local vars
 *     gettoken a b : c     // locals a and b (at most two)
 *     file read fh line    // local line (subcommand `read` only)
 *     levelsof x, local(l) // local l (and user programs' options)
 *     myprog               // locals that myprog sets with c_local
 *     _getrhs rhs          // a local named by an argument (c_local)
 *     macro drop A         // global A is cleared
 *
 * The analyzer registers the writes as definitions, and the loop
 * expander poisons the same names, so both read them from here.
 * Only literal names are writes. A name joined to a macro
 * (`` tempvar tv`i' ``) is known only at run time; a macro-creating
 * option whose argument is not a literal name sets `unknown_target`.
 */
import * as node_path from 'path';
import { Range } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import {
    ArgumentSpec,
    CommandNode,
    IdentifierNode,
    OptionSpec,
    ProgramSignature,
    ProgramSymbol,
    Token,
} from '../types';
import {
    MacroCreatingCommand,
    MacroCreatingOption,
    find_macro_creating_command,
    matches_option,
} from './macro-creating-commands';
import { parse_option_argument, is_valid_identifier } from './option-argument-parser';
import { NameWord, group_name_words, whole_word_item } from '../utils/name-words';
import { resolve_c_local_arg_names } from './c-local-arg-positions';
import { syntax_option_spelling } from '../utils/syntax-option-name';

/** How a command writes a macro. */
export type MacroWriteKind =
    | 'temp_name'          // tempvar, tempname, tempfile, marksample
    | 'unab'
    | 'args'
    | 'gettoken'
    | 'file_read'
    | 'option'             // local()/global() option of a command
    | 'c_local'            // a program's literal `c_local name`
    | 'c_local_argument';  // `c_local` of a name the call passes

/** One macro a command defines. */
export interface MacroWrite {
    scope: 'local' | 'global';
    name: string;
    /** Where the definition points: the name, option argument, or call. */
    range: Range;
    kind: MacroWriteKind;
}

/** Everything a command statement does to macros, besides reading them. */
export interface CommandMacroWrites {
    /** Definitions in the order the analyzer registers them. */
    writes: MacroWrite[];
    /** Globals that `macro drop` clears by literal name. */
    dropped_globals: string[];
    /**
     * True if the command writes or clears a macro whose name is not
     * known statically: `` local(`i') `` or `macro drop _all`/`A*`.
     */
    unknown_target: boolean;
}

/**
 * What a program's definition says about the caller macros a call to
 * it sets.
 */
export type WritingProgram = Pick<
    ProgramSymbol,
    | 'c_locals'
    | 'c_local_arg_positions'
    | 'macro_creating_local_options'
    | 'macro_creating_global_options'
    | 'signature'
>;

/** What `command_macro_writes` needs beyond the statement. */
export interface MacroWriteContext {
    /** Programs defined in this file. */
    file_programs: ReadonlyMap<string, WritingProgram>;
    /**
     * Programs found anywhere in the workspace. A workspace program
     * counts only when it is the program's one definition outside
     * this file (see `sole_workspace_program`); a call to a program
     * that several files define is decided with the caller's
     * resolved execution scope instead.
     */
    workspace_programs?: ReadonlyMap<string, ProgramSymbol>;
    /** Every workspace file's definition of each program. */
    workspace_program_definitions?: ReadonlyMap<string, readonly ProgramSymbol[]>;
    /** URI of the file being analyzed. */
    uri?: string;
    /** True when the statement is inside a program body. */
    in_program_body?: boolean;
    /**
     * Programs a top-level `program drop` removed since this file last
     * defined them. A top-level call does not reach them.
     */
    dropped_programs?: ReadonlySet<string>;
    /**
     * The file's token stream. Without it, names that a call passes to
     * a `c_local` argument are not read.
     */
    tokens?: readonly Token[];
}

const MACRO_DROP_RE = /^dr(o(p)?)?$/;
const WILDCARD_RE = /[*?]/;
const WEIGHT_TYPES: ReadonlySet<string> = new Set([
    'weight', 'fweight', 'fw', 'aweight', 'aw', 'pweight', 'pw',
    'iweight', 'iw',
]);

/** Parsed varlist without items kept only for error recovery. */
function semantic_varlist(node: CommandNode): IdentifierNode[] {
    return (node.varlist ?? []).filter(
        (item) => item.recovery_only !== true
    );
}

/**
 * The varlist joined into words as Stata splits them, so a name such
 * as `` foo`x' `` is one word, not `foo` and `` `x' ``.
 */
export function semantic_words(node: CommandNode): NameWord[] {
    return group_name_words(semantic_varlist(node));
}

/**
 * The words naming locals for `tempvar`/`tempname`/`tempfile` (every
 * word) and `marksample` (its one word; `marksample a b` fails in
 * Stata with "varlist not allowed" and defines nothing).
 */
function temp_name_words(node: CommandNode): NameWord[] {
    const the_words = semantic_words(node);
    if (node.fullName === 'marksample') {
        return the_words.length === 1 ? the_words : [];
    }
    return the_words;
}

/** The words that name locals, and how, for positional writers. */
function positional_words(
    node: CommandNode
): { kind: MacroWriteKind; words: NameWord[] } | undefined {
    switch (node.fullName) {
        case 'tempvar':
        case 'tempfile':
        case 'tempname':
        case 'marksample':
            return { kind: 'temp_name', words: temp_name_words(node) };
        case 'unab':
            // unab macname : varlist
            return { kind: 'unab', words: semantic_words(node).slice(0, 1) };
        case 'args':
            return { kind: 'args', words: semantic_words(node) };
        case 'gettoken':
        case 'gettok':
            // gettoken macname1 [macname2] : macname3 [, options]
            return { kind: 'gettoken', words: semantic_words(node).slice(0, 2) };
        case 'file':
        case 'fil':
        case 'fi': {
            // file read handle macname. Only the exact subcommand
            // spelling `read` writes. This layout assumes `file` is not
            // in FILE_COMMANDS (file-path-utils.ts), so the parser does
            // not coalesce its first argument as a path.
            const the_words = semantic_words(node);
            const is_read = the_words.length >= 3
                && whole_word_item(the_words[0])?.name === 'read';
            return { kind: 'file_read', words: is_read ? [the_words[2]] : [] };
        }
        default:
            return undefined;
    }
}

/**
 * The workspace definition of `name` that a call can be credited with
 * from this file alone. Inside a program body that is this file's own
 * definition when it has one: the body runs only when called, after
 * the whole file has loaded (an ado's helpers usually follow its main
 * program). Otherwise it is the only definition in another file, or,
 * when only this file defines it, this file's. With several
 * definitions in other files, which one a call uses depends on what
 * the caller loaded (a program in memory is used; the ado named after
 * it is loaded only when none is), so it is left to the resolved
 * execution scope (see `collect_program_macro_writes`). Without the
 * definitions list, the merged entry is used.
 */
export function sole_workspace_program(
    name: string,
    context: MacroWriteContext
): ProgramSymbol | undefined {
    const merged = context.workspace_programs?.get(name);
    const the_definitions = context.workspace_program_definitions?.get(name);
    if (!the_definitions) return merged;
    const { own, other, other_count } =
        split_definitions(the_definitions, context.uri);
    if (own && (context.in_program_body === true || other_count === 0)) {
        return own;
    }
    return other_count === 1 ? other : undefined;
}

interface SplitDefinitions {
    /** This file's definition, if any. */
    own?: ProgramSymbol;
    /** One definition in another file, if any. */
    other?: ProgramSymbol;
    /** How many definitions are in other files. */
    other_count: number;
}

/**
 * A program's definitions split into this file's and other files',
 * read once per definitions list and file: a helper name such as
 * `Estimate` has hundreds of definitions, and a file may call it many
 * times.
 */
const SPLIT_CACHE = new WeakMap<
    readonly ProgramSymbol[], Map<string | undefined, SplitDefinitions>
>();

function split_definitions(
    the_definitions: readonly ProgramSymbol[],
    uri: string | undefined
): SplitDefinitions {
    let by_uri = SPLIT_CACHE.get(the_definitions);
    if (!by_uri) {
        by_uri = new Map();
        SPLIT_CACHE.set(the_definitions, by_uri);
    }
    const cached = by_uri.get(uri);
    if (cached) return cached;
    const split: SplitDefinitions = { other_count: 0 };
    for (const my_definition of the_definitions) {
        if (my_definition.sourceUri === uri) {
            split.own ??= my_definition;
        } else {
            split.other ??= my_definition;
            split.other_count++;
        }
    }
    by_uri.set(uri, split);
    return split;
}

/**
 * A program the file defines, else one from the workspace.
 */
function find_program(
    name: string,
    context: MacroWriteContext
): WritingProgram | undefined {
    return context.file_programs.get(name)
        ?? sole_workspace_program(name, context);
}

/**
 * True if `uri` names `<program_name>.ado`, the file Stata auto-loads
 * from the adopath when `program_name` is called. The extension is
 * matched without case (it is a filesystem name, not Stata syntax);
 * the program name is matched exactly.
 */
export function is_auto_loaded_ado(uri: string, program_name: string): boolean {
    const base = uri_file_name(uri);
    if (base === undefined) return false;
    const extension = node_path.posix.extname(base);
    return extension.toLowerCase() === '.ado'
        && base.slice(0, -extension.length) === program_name;
}

/** The file name at the end of `uri`'s path. */
function uri_file_name(uri: string): string | undefined {
    try {
        return node_path.posix.basename(URI.parse(uri).path);
    } catch {
        return undefined;
    }
}

/**
 * The program whose positional `c_local` names a call to `name`
 * defines, as far as this file alone shows. The workspace index holds
 * every program in the workspace, whether or not the caller ever runs
 * the file that defines it, so here a program counts only when Stata
 * could reach it at the call without another file running first:
 *
 * - one this file defined before the call (`file_programs`), unless a
 *   top-level `program drop` removed it since, for a top-level call;
 * - an ado named after the program, which Stata loads from the
 *   adopath on first call, when no other file defines the program;
 * - inside a program body, one defined anywhere in this file, since
 *   the body runs only when called, after the file has loaded (an
 *   ado's helper subprograms usually follow the main program).
 *
 * A program in another `.do` file counts only through the resolved
 * execution scope: the diagnostics provider credits programs from
 * files this file runs, includes, or names in a `sight:` directive
 * (see `collect_c_local_arg_calls`). Workspace symbols alone do not
 * define a caller's locals.
 */
function find_c_local_arg_program(
    name: string,
    context: MacroWriteContext
): WritingProgram | undefined {
    const file_program = context.file_programs.get(name);
    const is_dropped = context.in_program_body !== true
        && context.dropped_programs?.has(name) === true;
    if (file_program && !is_dropped) return file_program;
    const workspace_program = sole_workspace_program(name, context);
    if (!workspace_program?.c_local_arg_positions) return undefined;
    const source_uri = workspace_program.sourceUri;
    if (is_auto_loaded_ado(source_uri, name)) return workspace_program;
    if (context.in_program_body === true && source_uri === context.uri) {
        return workspace_program;
    }
    return undefined;
}

/**
 * A program's macro-creating options as `matches_option` reads them.
 * `names` are the locals its `syntax` defines; the minimum
 * abbreviation comes from the `syntax` option that defines each, and
 * without one the option must be typed in full.
 */
function program_option_specs(
    names: readonly string[],
    program: WritingProgram
): MacroCreatingOption[] {
    const the_min_lengths = new Map<string, number>();
    for (const my_option of program.signature?.options ?? []) {
        const local_name = syntax_option_local_name(my_option);
        if (!the_min_lengths.has(local_name)) {
            const spelling = syntax_option_spelling(
                my_option.name, my_option.hasArgument === true);
            the_min_lengths.set(local_name, spelling.min_abbreviation.length);
        }
    }
    return names.map((my_name) => ({
        name: my_name,
        min_abbreviation: the_min_lengths.get(my_name) ?? my_name.length,
    }));
}

/**
 * The `local()`/`global()` options of a user program: the file's
 * definition when it has one, else the workspace's (see `find_program`).
 */
function program_macro_options(
    name: string,
    context: MacroWriteContext
): MacroCreatingCommand | undefined {
    const program = find_program(name, context);
    if (
        !program
        || (!program.macro_creating_local_options
            && !program.macro_creating_global_options)
    ) {
        return undefined;
    }
    return {
        name,
        min_abbreviation: 0,
        local_options: program_option_specs(
            program.macro_creating_local_options ?? [], program),
        global_options: program_option_specs(
            program.macro_creating_global_options ?? [], program),
    };
}

/**
 * The scope of macro an option creates, if the command creates one
 * through it. Options are case-sensitive: Stata rejects
 * `levelsof x, LOCAL(l)`, and a user program's options must be typed
 * in lowercase, however its `syntax` capitalizes them.
 */
function option_write_scope(
    option_name: string,
    node: CommandNode,
    context: MacroWriteContext
): 'local' | 'global' | undefined {
    const command = find_macro_creating_command(node.fullName)
        ?? program_macro_options(node.fullName, context);
    if (!command) return undefined;
    if (command.local_options.some((my_spec) => matches_option(option_name, my_spec))) {
        return 'local';
    }
    if (command.global_options.some((my_spec) => matches_option(option_name, my_spec))) {
        return 'global';
    }
    return undefined;
}

/** Literal globals `macro drop` clears, and whether others are too. */
function macro_drop_targets(
    node: CommandNode
): { names: string[]; unknown: boolean } {
    if (node.fullName !== 'macro' && node.fullName !== 'mac') {
        return { names: [], unknown: false };
    }
    const the_args = semantic_varlist(node);
    // The first item is the subcommand, which may be abbreviated.
    if (the_args.length < 2 || !MACRO_DROP_RE.test(the_args[0].name)) {
        return { names: [], unknown: false };
    }
    const the_names: string[] = [];
    let unknown = false;
    for (const my_arg of the_args.slice(1)) {
        if (my_arg.name === '_all' || WILDCARD_RE.test(my_arg.name)) {
            unknown = true;
        } else if (is_valid_identifier(my_arg.name)) {
            the_names.push(my_arg.name);
        }
    }
    return { names: the_names, unknown };
}

/**
 * The macros `node` writes, in registration order: positional names,
 * then option arguments, then the called program's `c_local`s.
 */
export function command_macro_writes(
    node: CommandNode,
    context: MacroWriteContext
): CommandMacroWrites {
    const the_writes: MacroWrite[] = [];
    let unknown_target = false;

    const positional = positional_words(node);
    for (const my_word of positional?.words ?? []) {
        const my_item = whole_word_item(my_word);
        if (my_item && is_valid_identifier(my_item.name)) {
            the_writes.push({
                scope: 'local',
                name: my_item.name,
                range: my_item.range,
                kind: positional!.kind,
            });
        }
    }

    for (const my_option of node.options ?? []) {
        if (my_option.argument_unclosed) continue;
        const scope = option_write_scope(my_option.name, node, context);
        if (!scope) continue;
        const parsed = parse_option_argument(my_option.argument);
        if (!parsed.is_literal || !parsed.identifier) {
            unknown_target = true;
            continue;
        }
        the_writes.push({
            scope,
            name: parsed.identifier,
            range: my_option.argument_range ?? node.range,
            kind: 'option',
        });
    }

    // c_local writes into the CALLER's scope, so a call defines the
    // program's literal c_local names at the call.
    const program = find_program(node.fullName, context);
    for (const my_name of new Set(program?.c_locals ?? [])) {
        the_writes.push({
            scope: 'local',
            name: my_name,
            range: node.range,
            kind: 'c_local',
        });
    }
    // Names the caller passes for the program to c_local
    // (`_getrhs rhs`), defined at the argument word.
    const the_positions = find_c_local_arg_program(node.fullName, context)
        ?.c_local_arg_positions;
    if (the_positions && context.tokens) {
        for (const my_created of resolve_c_local_arg_names(
            node, context.tokens, the_positions
        )) {
            the_writes.push({
                scope: 'local',
                name: my_created.name,
                range: my_created.range,
                kind: 'c_local_argument',
            });
        }
    }

    const the_drop = macro_drop_targets(node);
    return {
        writes: the_writes,
        dropped_globals: the_drop.names,
        unknown_target: unknown_target || the_drop.unknown,
    };
}

/**
 * The local a `syntax` option defines (see `syntax_option_spelling`):
 * `noCONStant`, `nolog` and `noTE` define `constant`, `log` and `te`,
 * `NODetail` defines `nodetail`, `notable(string)` defines `notable`,
 * and `saveAs(string)` and `MyOption` keep their later capitals:
 * `saveAs` and `myOption` (checked in StataMP 18).
 */
export function syntax_option_local_name(opt: OptionSpec): string {
    return syntax_option_spelling(opt.name, opt.hasArgument === true)
        .local_name;
}

/**
 * The local a `syntax` argument defines: the type (`varlist`, `if`,
 * `in`, …), the given name for `anything(name=…)`, and `weight` for
 * every weight type.
 */
function syntax_argument_local_name(arg: ArgumentSpec): string {
    if (arg.type === 'anything' && arg.name) return arg.name;
    if (WEIGHT_TYPES.has(arg.type)) return 'weight';
    return arg.type;
}

/** One local a `syntax` statement defines, at its declaration. */
export interface SyntaxLocal {
    name: string;
    range: Range;
    kind: 'argument' | 'option';
}

/**
 * The locals a `syntax` signature defines, in Stata's order: each
 * argument's local (a weight also defines `exp`), then each option's.
 */
export function syntax_locals(signature: ProgramSignature): SyntaxLocal[] {
    const the_locals: SyntaxLocal[] = [];
    for (const my_arg of signature.arguments) {
        if (!my_arg.type) continue;
        const range = my_arg.range;
        the_locals.push({
            name: syntax_argument_local_name(my_arg),
            range,
            kind: 'argument',
        });
        if (WEIGHT_TYPES.has(my_arg.type)) {
            the_locals.push({ name: 'exp', range, kind: 'argument' });
        }
    }
    for (const my_option of signature.options) {
        the_locals.push({
            name: syntax_option_local_name(my_option),
            range: my_option.range,
            kind: 'option',
        });
    }
    return the_locals;
}
