/**
 * The caller macros that calls in an open document set through user
 * programs, as its resolved execution scope shows which definition
 * each call reaches (see `src/analyzer/program-macro-writes.ts`).
 *
 * Diagnostics use it to drop an undefined-macro warning, and
 * definition, hover, completion and references use the same writes as
 * the macro's definition, so a local that is not reported is also one
 * the editor can navigate to.
 */
import { Position } from 'vscode-languageserver';
import { DocumentState } from '../document-store';
import { MacroSymbol, ResolvedScope, SymbolTable } from '../types';
import {
    compare_positions,
    position_within_range,
} from '../utils/scope-position';
import { WritingProgram } from '../analyzer/command-macro-writes';
import {
    LoadedProgramSources,
    ProgramMacroWrite,
    ProgramMacroWrites,
    collect_program_macro_writes,
    local_writes_before,
    program_frame,
    workspace_auto_loaded_program,
} from '../analyzer/program-macro-writes';

/**
 * Where the programs this file's calls may reach come from: the
 * backward chain's programs from other files, this file's own
 * programs, the programs left by each file this file loads (forward
 * call sites are already resolved by path, transitive, and include
 * `sight:` directive sites), and the workspace's ados.
 */
function loaded_program_sources(
    scope: ResolvedScope,
    document: DocumentState,
    workspace_symbols: SymbolTable | undefined
): LoadedProgramSources {
    const the_loaded_before = new Map<string, WritingProgram>();
    for (const [my_name, my_program] of scope.symbols.programs) {
        if (my_program.sourceUri !== document.uri) {
            the_loaded_before.set(my_name, my_program);
        }
    }
    // A site knows only its line. Where this file's loading statement
    // ends on that line orders it against a call on the same line
    // (`run lib.do; setter x;` under `#delimit ;`); with several on
    // one line, the first end is taken. A site with no statement here
    // (a directive) counts from the next line.
    const the_ends = new Map<number, Position>();
    for (const my_call of document.forward_calls) {
        const end = my_call.range.end;
        const known = the_ends.get(my_call.call_site_line);
        if (known === undefined
            || end.line < known.line
            || (end.line === known.line && end.character < known.character)) {
            the_ends.set(my_call.call_site_line, end);
        }
    }
    return {
        own_programs: document.symbols.programs,
        loaded_before: the_loaded_before,
        loads: (scope.forward_call_symbols ?? []).map((my_site) => ({
            end: the_ends.get(my_site.call_line) ?? {
                line: my_site.call_line,
                character: Number.MAX_SAFE_INTEGER,
            },
            programs: my_site.symbols.programs,
        })),
        auto_loaded: (name) =>
            workspace_auto_loaded_program(name, workspace_symbols),
    };
}

interface CachedWrites {
    document: DocumentState;
    workspace_symbols: SymbolTable | undefined;
    writes: ProgramMacroWrites;
}

/** One result per resolved scope, for its document and workspace. */
const CACHE = new WeakMap<ResolvedScope, CachedWrites>();

/**
 * The caller macros the calls in `document` set through programs,
 * computed once per resolved scope, document and workspace snapshot.
 */
export function scope_program_macro_writes(
    document: DocumentState,
    scope: ResolvedScope,
    workspace_symbols?: SymbolTable
): ProgramMacroWrites {
    const cached = CACHE.get(scope);
    if (
        cached
        && cached.document === document
        && cached.workspace_symbols === workspace_symbols
    ) {
        return cached.writes;
    }
    const writes = collect_program_macro_writes(
        document.ast?.nodes ?? [],
        document.tokens,
        loaded_program_sources(scope, document, workspace_symbols)
    );
    CACHE.set(scope, { document, workspace_symbols, writes });
    return writes;
}

/**
 * The definitions of the local `name` that calls through programs
 * make before `position`, in its program frame, as macro symbols.
 * Empty without a resolved scope.
 */
export function credited_local_definitions(
    document: DocumentState,
    scope: ResolvedScope | undefined,
    name: string,
    position: Position,
    workspace_symbols?: SymbolTable
): MacroSymbol[] {
    if (!scope) return [];
    const writes = scope_program_macro_writes(
        document, scope, workspace_symbols);
    return local_writes_before(writes, name, position)
        .map((my_write) => write_symbol(document, my_write));
}

/**
 * Every write to the local `name` that a call in `document` makes
 * through a program, as macro symbols, in the program frame of
 * `line` (or outside any program, as `line` is), before or after it.
 */
export function all_credited_local_definitions(
    document: DocumentState,
    scope: ResolvedScope | undefined,
    name: string,
    line: number,
    workspace_symbols?: SymbolTable
): MacroSymbol[] {
    if (!scope) return [];
    const writes = scope_program_macro_writes(
        document, scope, workspace_symbols);
    const frame = program_frame(writes, line);
    return (writes.locals.get(name) ?? [])
        .filter((my_write) => my_write.program_start_line === frame)
        .map((my_write) => write_symbol(document, my_write));
}

/**
 * The local whose definition at a call (the argument word or option
 * argument) holds `position`, if any. A literal `c_local` names no
 * word at the call (its write spans the whole call), so it never
 * takes the word under the cursor, such as the program name.
 */
export function credited_local_at(
    document: DocumentState,
    scope: ResolvedScope | undefined,
    position: Position,
    workspace_symbols?: SymbolTable
): MacroSymbol | undefined {
    if (!scope) return undefined;
    const writes = scope_program_macro_writes(
        document, scope, workspace_symbols);
    for (const the_writes of writes.locals.values()) {
        for (const my_write of the_writes) {
            if (
                my_write.kind !== 'c_local'
                && position_within_range(position, my_write.range)
            ) {
                return write_symbol(document, my_write);
            }
        }
    }
    return undefined;
}

/**
 * The locals that calls through programs define before `position`,
 * in its program frame, by name: what completion can offer there.
 */
export function credited_locals_at(
    document: DocumentState,
    scope: ResolvedScope | undefined,
    position: Position,
    workspace_symbols?: SymbolTable
): Map<string, MacroSymbol> {
    const the_locals = new Map<string, MacroSymbol>();
    if (!scope) return the_locals;
    const writes = scope_program_macro_writes(
        document, scope, workspace_symbols);
    const frame = program_frame(writes, position.line);
    for (const [my_name, the_writes] of writes.locals) {
        const first = the_writes.find(
            (my_write) => compare_positions(my_write.end, position) <= 0
                && my_write.program_start_line === frame);
        if (first) the_locals.set(my_name, write_symbol(document, first));
    }
    return the_locals;
}

/** A write as the macro symbol the providers render. */
function write_symbol(
    document: DocumentState,
    write: ProgramMacroWrite
): MacroSymbol {
    return {
        name: write.name,
        scope: write.scope,
        location: { uri: document.uri, range: write.range },
        sourceUri: document.uri,
        definition_line: write.range.start.line,
        visibility_start: write.end,
    };
}
