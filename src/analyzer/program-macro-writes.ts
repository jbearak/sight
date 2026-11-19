/**
 * The caller macros that calls to user programs set, as the caller's
 * resolved execution scope shows which definition each call uses.
 *
 * A program sets macros in its caller three ways: a literal
 * `c_local name`, a `c_local` of an option argument
 * (`setter, local(result)`), and a `c_local` of a positional argument
 * (`setter result`). Which of those a call does depends on the
 * definition it reaches, and Stata picks that by execution order: a
 * program in memory is used (one a do-file that ran defined, or one
 * defined earlier in the same file), and the ado named after the
 * program is loaded only when no program of that name is in memory,
 * including after `program drop` (checked in StataMP 18).
 *
 * The analyzer sees one file. It credits calls to programs that file
 * defines and to a program with only one definition elsewhere in the
 * workspace (see `sole_workspace_program`). Everything else is decided
 * here, from the resolved scope, by the diagnostics provider and by
 * navigation (definition, hover, completion, references), so the
 * warning and the symbol cannot disagree.
 */
import { Position, Range } from 'vscode-languageserver-textdocument';
import {
    CommandNode,
    ProgramSymbol,
    StataNode,
    SymbolTable,
    Token,
} from '../types';
import { nested_statements } from '../utils/node-body';
import { compare_positions } from '../utils/scope-position';
import { program_drop_targets } from './c-local-arg-positions';
import {
    MacroWriteKind,
    WritingProgram,
    command_macro_writes,
    is_auto_loaded_ado,
} from './command-macro-writes';

/** A caller macro a call sets, with where the call sits. */
export interface ProgramMacroWrite {
    scope: 'local' | 'global';
    name: string;
    /** The definition: the argument word, option argument, or call. */
    range: Range;
    kind: MacroWriteKind;
    /** Where the call statement ends; the macro exists from there. */
    end: Position;
    /** Start line of the program body holding the call, if any. */
    program_start_line?: number;
}

/**
 * Where the programs a file's calls may reach come from. Built from
 * the resolved execution scope.
 */
export interface LoadedProgramSources {
    /** This file's programs, by name (the analyzer's symbol table). */
    own_programs: ReadonlyMap<string, WritingProgram>;
    /**
     * Programs defined before the file runs: those of the files that
     * run or include it (the backward chain).
     */
    loaded_before: ReadonlyMap<string, WritingProgram>;
    /**
     * Files the file runs, includes or names in a `sight:` directive,
     * at any depth, each with where the statement in this file that
     * loads it ends and the programs it leaves defined. A program
     * outlives the do-file that defined it.
     */
    loads: ReadonlyArray<{
        end: Position;
        programs: ReadonlyMap<string, WritingProgram>;
    }>;
    /**
     * The ado Stata loads for a call to `name` when no program of
     * that name is in memory, if the workspace has one.
     */
    auto_loaded?: (name: string) => WritingProgram | undefined;
}

/** The writes calls in a file make, by macro name. */
export interface ProgramMacroWrites {
    locals: Map<string, ProgramMacroWrite[]>;
    globals: Map<string, ProgramMacroWrite[]>;
    /** Line spans of the file's program definitions. */
    program_lines: Array<{ start: number; end: number }>;
}

const CALLER_WRITE_KINDS: ReadonlySet<MacroWriteKind> = new Set([
    'option', 'c_local', 'c_local_argument',
]);

/**
 * The ado named after `name` among the workspace's definitions, the
 * file Stata loads from the adopath. When several directories hold
 * one, the URI that sorts first is taken, so the answer does not
 * depend on the order files were indexed in.
 */
export function workspace_auto_loaded_program(
    name: string,
    workspace_symbols: SymbolTable | undefined
): ProgramSymbol | undefined {
    if (!workspace_symbols) return undefined;
    const the_definitions = workspace_symbols.program_definitions?.get(name);
    if (!the_definitions) {
        const merged = workspace_symbols.programs.get(name);
        return merged && is_auto_loaded_ado(merged.sourceUri, name)
            ? merged : undefined;
    }
    let found: ProgramSymbol | undefined;
    for (const my_definition of the_definitions) {
        if (
            is_auto_loaded_ado(my_definition.sourceUri, name)
            && (!found || my_definition.sourceUri < found.sourceUri)
        ) {
            found = my_definition;
        }
    }
    return found;
}

/**
 * The caller macros that calls in `nodes` set, grouped by scope and
 * name, with the line spans of the program definitions in `nodes` so
 * a caller can tell which program frame a reference sits in.
 *
 * Which definition a call reaches follows execution order. A call
 * outside any program body reaches the program defined when it runs:
 * one from `sources.loaded_before`, one this file defined earlier
 * (also inside an `if` block), or one from a file loaded by an
 * earlier statement; a later definition or load replaces it, and a
 * literal `program drop` at the top level removes it. With none
 * defined, it reaches the ado named after the program. A call inside
 * a program body runs whenever the program is called, which can be
 * after anything in the file, so it reaches a program defined or
 * loaded anywhere in the file (this file's own first), else the ado.
 * All lookups are prepared once, so the work is linear in the
 * statements and loaded programs.
 */
export function collect_program_macro_writes(
    nodes: readonly StataNode[],
    tokens: readonly Token[],
    sources: LoadedProgramSources
): ProgramMacroWrites {
    const result: ProgramMacroWrites = {
        locals: new Map(),
        globals: new Map(),
        program_lines: [],
    };
    const the_loads = [...sources.loads].sort(
        (a, b) => compare_positions(a.end, b.end));

    // The program each name reaches at the current statement, for
    // calls outside program bodies.
    const available = new Map<string, WritingProgram>(sources.loaded_before);
    // The program each name reaches from a body: the first seen.
    const anywhere = new Map<string, WritingProgram>();
    const note_anywhere = (
        the_programs: ReadonlyMap<string, WritingProgram>
    ): void => {
        for (const [my_name, my_program] of the_programs) {
            if (!anywhere.has(my_name)) anywhere.set(my_name, my_program);
        }
    };
    note_anywhere(sources.own_programs);
    note_anywhere(sources.loaded_before);
    for (const my_load of the_loads) note_anywhere(my_load.programs);

    let next_load = 0;
    /** Applies each load that ends by `position`. */
    const apply_loads_before = (position: Position): void => {
        while (
            next_load < the_loads.length
            && compare_positions(the_loads[next_load].end, position) <= 0
        ) {
            for (const [my_name, my_program] of the_loads[next_load].programs) {
                available.set(my_name, my_program);
            }
            next_load++;
        }
    };

    const record = (
        node: CommandNode,
        program: WritingProgram,
        program_start_line: number | undefined
    ): void => {
        const the_writes = command_macro_writes(node, {
            file_programs: new Map([[node.fullName, program]]),
            tokens,
        }).writes;
        for (const my_write of the_writes) {
            if (!CALLER_WRITE_KINDS.has(my_write.kind)) continue;
            const by_name = my_write.scope === 'local'
                ? result.locals : result.globals;
            const the_list = by_name.get(my_write.name) ?? [];
            the_list.push({
                ...my_write,
                end: node.range.end,
                program_start_line,
            });
            by_name.set(my_write.name, the_list);
        }
    };

    const visit = (
        the_nodes: readonly StataNode[],
        program_start_line: number | undefined,
        at_top_level: boolean
    ): void => {
        for (const my_node of the_nodes) {
            apply_loads_before(my_node.range.start);
            if (my_node.type === 'program') {
                result.program_lines.push({
                    start: my_node.range.start.line,
                    end: my_node.range.end.line,
                });
                visit(my_node.body, my_node.range.start.line, false);
                const own = sources.own_programs.get(my_node.name);
                if (own) available.set(my_node.name, own);
                continue;
            }
            const the_drop = at_top_level
                ? program_drop_targets(my_node) : undefined;
            if (the_drop?.all) available.clear();
            for (const my_name of the_drop?.names ?? []) {
                available.delete(my_name);
            }
            if (my_node.type === 'command' && !my_node.body) {
                const name = my_node.fullName;
                let program = program_start_line === undefined
                    ? available.get(name)
                    : anywhere.get(name);
                if (!program) {
                    program = sources.auto_loaded?.(name);
                    // Once loaded, the ado stays in memory.
                    if (program && program_start_line === undefined) {
                        available.set(name, program);
                    }
                }
                if (program) record(my_node, program, program_start_line);
            }
            const the_body = nested_statements(my_node);
            if (the_body) visit(the_body, program_start_line, false);
        }
    };
    visit(nodes, undefined, true);
    return result;
}

/**
 * The writes in `writes` to the local `name` that a reference at
 * `reference` sees: the call ends before the reference starts, in the
 * same program frame (or both outside any program).
 */
export function local_writes_before(
    writes: ProgramMacroWrites,
    name: string,
    reference: Position
): ProgramMacroWrite[] {
    const the_writes = writes.locals.get(name);
    if (!the_writes) return [];
    const frame = program_frame(writes, reference.line);
    return the_writes.filter(
        (my_write) => compare_positions(my_write.end, reference) <= 0
            && my_write.program_start_line === frame
    );
}

/**
 * The writes in `writes` to the global `name` that a reference at
 * `reference` sees: the call ends before the reference starts.
 */
export function global_writes_before(
    writes: ProgramMacroWrites,
    name: string,
    reference: Position
): ProgramMacroWrite[] {
    return (writes.globals.get(name) ?? []).filter(
        (my_write) => compare_positions(my_write.end, reference) <= 0
    );
}

/** Start line of the program definition holding `line`, if any. */
export function program_frame(
    writes: ProgramMacroWrites,
    line: number
): number | undefined {
    return writes.program_lines.find(
        (my_span) => my_span.start <= line && line <= my_span.end
    )?.start;
}
