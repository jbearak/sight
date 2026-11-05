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
import { Range } from 'vscode-languageserver-textdocument';
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

/** What `command_macro_writes` needs beyond the statement. */
export interface MacroWriteContext {
    /** Programs defined in this file. */
    file_programs: ReadonlyMap<string, ProgramSymbol>;
    /** Programs found in the workspace, used when the file lacks one. */
    workspace_programs?: ReadonlyMap<string, ProgramSymbol>;
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
 * A program the file defines, else one from the workspace.
 */
function find_program(
    name: string,
    context: MacroWriteContext
): ProgramSymbol | undefined {
    return context.file_programs.get(name)
        ?? context.workspace_programs?.get(name);
}

/**
 * A program's macro-creating options as `matches_option` reads them.
 * `names` are the lowercase locals its `syntax` defines; the minimum
 * abbreviation comes from the `syntax` option that defines each, and
 * without one the option must be typed in full.
 */
function program_option_specs(
    names: readonly string[],
    program: ProgramSymbol
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
 * The `local()`/`global()` options of a user program, from the first
 * of the file's and the workspace's definitions that has any.
 */
function program_macro_options(
    name: string,
    context: MacroWriteContext
): MacroCreatingCommand | undefined {
    for (const my_programs of [context.file_programs, context.workspace_programs]) {
        const program = my_programs?.get(name);
        if (
            program
            && (program.macro_creating_local_options
                || program.macro_creating_global_options)
        ) {
            return {
                name,
                min_abbreviation: 0,
                local_options: program_option_specs(
                    program.macro_creating_local_options ?? [], program),
                global_options: program_option_specs(
                    program.macro_creating_global_options ?? [], program),
            };
        }
    }
    return undefined;
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
    const the_positions = program?.c_local_arg_positions;
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
 * The local a `syntax` option defines. Stata lowercases the name, and
 * for an option without an argument drops a lowercase `no` prefix:
 * `noCONStant`, `nolog` and `noTE` define `constant`, `log` and `te`,
 * while `NODetail` defines `nodetail` and `notable(string)` defines
 * `notable` (checked in StataMP 18).
 */
export function syntax_option_local_name(opt: OptionSpec): string {
    if (opt.hasArgument !== true && opt.name.length > 2 &&
        opt.name.startsWith('no')) {
        return opt.name.slice(2).toLowerCase();
    }
    return opt.name.toLowerCase();
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
