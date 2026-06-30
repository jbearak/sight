/**
 * Loop macro expander: public entry point used by the analyzer.
 *
 * Given a foreach/forvalues node, the full token array, and the active loop
 * iterator frames, produce the concrete local/global macros defined by
 * constructed-name `local`/`global` statements in the loop body.
 */
import { Range } from 'vscode-languageserver-textdocument';
import { ControlFlowNode, StataNode, SymbolTable, Token } from '../../types';
import {
    BindingFrame,
    expand_template,
    extract_name_template,
    extract_redefined_macro_name,
    is_constructed_increment,
    template_references_redefined,
} from './name-expander';
import { StaticValueEnvOptions } from './static-value-env';

export { build_static_value_env } from './static-value-env';
export type { StaticValue, StaticValueEnv } from './static-value-env';
export { resolve_loop_value_set } from './value-set-resolver';
export type { IteratorValueSet } from './value-set-resolver';
export { scan_macro_refs } from './macro-ref-scanner';
export type { BindingFrame } from './name-expander';

export interface ExpandedLoopMacro {
    name: string;
    scope: 'local' | 'global';
    sourceRange: Range;
}

function pos_le(
    a: { line: number; character: number },
    b: { line: number; character: number }
): boolean {
    return a.line < b.line || (a.line === b.line && a.character <= b.character);
}

/**
 * Collect the tokens belonging to a single statement, by source range.
 */
function statement_tokens(tokens: Token[], range: Range): Token[] {
    // Tokens are position-sorted; binary-search the first token at/after the
    // statement start so this is O(log n + k) per statement rather than O(n),
    // avoiding O(n^2) over a large loop body.
    let lo = 0;
    let hi = tokens.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (pos_le(range.start, tokens[mid].range.start)) {
            hi = mid;
        } else {
            lo = mid + 1;
        }
    }
    const out: Token[] = [];
    for (let i = lo; i < tokens.length; i++) {
        const my_tok = tokens[i];
        if (!pos_le(my_tok.range.start, range.end)) break;
        if (pos_le(my_tok.range.end, range.end)) {
            out.push(my_tok);
        }
    }
    return out;
}

export function expand_loop_body(
    node: ControlFlowNode,
    tokens: Token[],
    frames: BindingFrame[],
    symbols: Pick<SymbolTable, 'localMacros' | 'globalMacros'>,
    // Optional: returns the macros a body statement (re)defines via an
    // analyzer-known macro-creating command/option (e.g. `levelsof ...,
    // local(x)`, or a user program's `local()` option). The analyzer injects
    // this so the expander can poison such helpers in execution order without
    // depending on the program registry directly.
    command_redefinitions?: (
        statement: StataNode
    ) => {
        // Macros the statement (re)defines with a literal, known name.
        names: Array<{ scope: 'local' | 'global'; name: string }>;
        // True when the statement (re)defines or drops a macro whose concrete
        // name is NOT statically known (e.g. `` levelsof x, local(`i') `` or
        // `macro drop _all`) — the target is unknown, so every later template
        // must be skipped.
        unknown: boolean;
    },
    env_options?: StaticValueEnvOptions
): ExpandedLoopMacro[] {
    // If any active loop has an empty iteration set, the (innermost) body never
    // executes, so no constructed name is actually defined. Expanding here —
    // even for a name that does not reference the empty iterator — would falsely
    // suppress a legitimate undefined-macro warning.
    if (frames.some((my_frame) => my_frame.values.length === 0)) {
        return [];
    }
    const the_expanded: ExpandedLoopMacro[] = [];
    // Track plain macro (re)definitions in execution order. A constructed name
    // that references a macro the body has ALREADY reassigned cannot be soundly
    // expanded: Stata uses the reassigned value at that point, not the pre-loop
    // value or loop binding, so the pre-loop fold would fabricate a name that
    // never exists at runtime. Such names are skipped (a conservative miss). A
    // reassignment that comes AFTER the constructed name does not affect it.
    // This set also captures the concrete names produced by EARLIER constructed
    // definitions, since those are themselves (re)definitions that later
    // templates may interpolate.
    const redefined_local = new Set<string>();
    const redefined_global = new Set<string>();
    // Set once a (re)definition's concrete target name(s) cannot be enumerated
    // here — e.g. a nested loop's `` local `j' `` whose iterator is unbound in
    // this frame context, an over-cap expansion, a constructed-name increment
    // (`` local ++x_`i' ``), or a constructed name that folds an
    // already-redefined macro. The reassigned macro could be ANY local/global —
    // including a loop iterator — so once this is set we conservatively skip
    // every LATER template (the unknown target might be a pre-loop macro the
    // template folds, or an iterator it interpolates). Skipping is a
    // conservative miss; injecting a fabricated stale name would be a false
    // suppression, which the feature must never produce.
    let saw_unresolved_redefinition = false;

    // Record any (re)definition a single leaf statement performs, and — only in
    // an `expandable` (guaranteed-executing) region — inject its expanded
    // constructed names.
    const process_leaf = (
        my_statement: StataNode,
        expandable: boolean,
        active_frames: BindingFrame[],
        shadowed_locals: ReadonlySet<string>
    ): void => {
        const the_tokens = statement_tokens(tokens, my_statement.range);
        if (the_tokens.length === 0) return;
        const template = extract_name_template(the_tokens);
        if (template) {
            // Skip this template when (a) an earlier (re)definition's target was
            // unknown — the unknown macro could be one this name folds OR an
            // iterator it interpolates — or (b) it folds a macro the body
            // already redefined (its concrete target depends on that macro's
            // untracked new value). In both cases this statement is itself a
            // redefinition whose concrete target we cannot determine, so record
            // the unresolved-target state for every LATER template too. Skipping
            // is a conservative miss that avoids fabricating a stale name (a
            // false suppression).
            if (
                saw_unresolved_redefinition
                || template_references_redefined(template, redefined_local, redefined_global)
            ) {
                saw_unresolved_redefinition = true;
                return;
            }
            const the_names = expand_template(
                template,
                active_frames,
                symbols,
                shadowed_locals,
                env_options
            );
            if (the_names.length === 0) {
                // The constructed name could not be resolved in this frame
                // context (unbound nested iterator, or over-cap expansion), so
                // its (re)definition target is unknown — poison every later
                // template.
                saw_unresolved_redefinition = true;
                return;
            }
            const redefined_for_scope =
                template.scope === 'local' ? redefined_local : redefined_global;
            for (const my_name of the_names) {
                // The produced concrete name is itself a (re)definition, so
                // poison it for any LATER template regardless of region. Inject
                // it as a defined symbol only in an expandable region; inside a
                // skipped block (if/while/nested loop) we poison but do NOT
                // inject (it may not run, or runs with a different binding).
                redefined_for_scope.add(my_name);
                if (expandable) {
                    the_expanded.push({
                        name: my_name,
                        scope: template.scope,
                        sourceRange: my_statement.range,
                    });
                }
            }
            return;
        }
        // A plain redefinition shadows the pre-loop value for any LATER
        // constructed name that references this macro.
        const redef = extract_redefined_macro_name(the_tokens);
        if (redef) {
            (redef.scope === 'local' ? redefined_local : redefined_global).add(redef.name);
        } else if (is_constructed_increment(the_tokens)) {
            // A constructed-name increment (`` local ++x_`i' ``) reassigns a
            // macro whose concrete name we cannot enumerate from a single bare
            // identifier, so its target is unknown — poison every later
            // template. (A plain `` local ++x_1 `` is captured by
            // `extract_redefined_macro_name` above.)
            saw_unresolved_redefinition = true;
        }
        // A macro reassigned by an analyzer-known macro-creating command/option
        // (e.g. `levelsof ..., local(suffix)`, or a user program's `local()`
        // option) likewise shadows the pre-loop value. Its runtime value is
        // unknown, so a later template referencing it is conservatively skipped.
        if (command_redefinitions) {
            const the_command_redef = command_redefinitions(my_statement);
            for (const my_redef of the_command_redef.names) {
                (my_redef.scope === 'local' ? redefined_local : redefined_global)
                    .add(my_redef.name);
            }
            // A command that (re)defines/drops a macro with an unknown name
            // (dynamic `local()` target, `macro drop _all`, …) could touch any
            // macro a later template folds — poison every later template.
            if (the_command_redef.unknown) {
                saw_unresolved_redefinition = true;
            }
        }
    };

    // Walk the body in execution order. `frame X { … }` always executes, so it
    // stays expandable. Conditional bodies (`if`/`else`/`while`) and nested
    // loops may not execute (or execute with different bindings), so their
    // constructed names must NOT be injected — but any helper they reassign
    // still shadows the pre-loop value for LATER templates, so we must descend
    // into them to POISON those redefinitions (otherwise a stale pre-loop fold
    // fabricates a concrete name that never exists at runtime, suppressing a
    // legitimate undefined-macro warning). Nested foreach/forvalues additionally
    // handle their own expansion via their own analyzer-level process_loop call.
    //
    // A nested `foreach`/`forvalues` rebinds its own loop variable, so inside it
    // a constructed name that interpolates that name must NOT resolve to the
    // outer frame binding NOR to a stale pre-loop value of the same name. We
    // both drop the shadowed outer frame (`active_frames`) and record the name
    // in `shadowed_locals`, which makes `expand_template` treat it as
    // unresolvable — marking the unresolved-target state rather than poisoning
    // the wrong macro.
    const walk = (
        the_body: StataNode[],
        expandable: boolean,
        active_frames: BindingFrame[],
        shadowed_locals: ReadonlySet<string>
    ): void => {
        // `current_shadowed` grows as earlier sibling nested loops clobber an
        // outer iterator they reuse, so LATER siblings see it as unresolvable.
        let current_shadowed = shadowed_locals;
        for (const my_node of the_body) {
            if (my_node.type === 'frame') {
                walk(my_node.body, expandable, active_frames, current_shadowed);
            } else if (
                my_node.type === 'foreach' || my_node.type === 'forvalues'
            ) {
                const nested_var = (my_node as ControlFlowNode).loopVar;
                const masked_frames = nested_var
                    ? active_frames.filter((my_frame) => my_frame.var !== nested_var)
                    : active_frames;
                const nested_shadowed = nested_var
                    ? new Set(current_shadowed).add(nested_var)
                    : current_shadowed;
                walk(my_node.body, false, masked_frames, nested_shadowed);
                // A nested loop that REUSES an outer iterator's name leaves that
                // iterator clobbered (its last inner value) after the loop, so a
                // LATER sibling template interpolating it must treat it as
                // unresolvable rather than fold the outer frame binding.
                if (nested_var && active_frames.some((f) => f.var === nested_var)) {
                    current_shadowed = new Set(current_shadowed).add(nested_var);
                }
            } else if (
                my_node.type === 'if' ||
                my_node.type === 'else' ||
                my_node.type === 'while'
            ) {
                walk(my_node.body, false, active_frames, current_shadowed);
            } else if (
                my_node.type === 'command'
                && Array.isArray((my_node as { body?: unknown }).body)
            ) {
                // Block-prefix body (`capture { … }`, `quietly { … }`): the body
                // may not run (or runs under a prefix), so constructed names in
                // it are not injected — but a redefinition of a pre-loop helper
                // inside it still shadows the pre-loop value for LATER templates,
                // so descend to POISON it (mirrors the if/while handling).
                walk(
                    (my_node as { body: StataNode[] }).body,
                    false,
                    active_frames,
                    current_shadowed
                );
            } else {
                process_leaf(my_node, expandable, active_frames, current_shadowed);
            }
        }
    };
    walk(node.body, true, frames, new Set<string>());
    return the_expanded;
}
