/**
 * Resolve a loop's `loopSpec` string into the concrete set of iterator values,
 * or `dynamic` when the set cannot be determined statically.
 *
 * Handles:
 *   foreach VAR in <list>          (literals + local/global macro refs)
 *   foreach VAR of local  <macro>
 *   foreach VAR of global <macro>
 *   forvalues VAR = a/b | a(step)b (integer ranges)
 *
 * `of varlist`, `of numlist`, and anything non-static resolve to `dynamic`.
 * Per requirement 6, unresolvable items inside an `in` list are dropped
 * (partial), not fatal.
 */
import { StaticValueEnv } from './static-value-env';

export type IteratorValueSet =
    | { kind: 'static'; values: string[] }
    | { kind: 'dynamic' };

/** Cap on the number of iterator values produced; larger ⇒ treated as dynamic. */
export const VALUE_SET_CAP = 1000;

const LOCAL_REF = /^`([A-Za-z_][A-Za-z0-9_]*)'$/;
const GLOBAL_REF = /^\$(?:([A-Za-z_][A-Za-z0-9_]*)|\{([A-Za-z_][A-Za-z0-9_]*)\})$/;
const INT_LITERAL = /^-?\d+$/;

function global_ref_name(match: RegExpMatchArray): string {
    return match[1] ?? match[2];
}

interface ListItem {
    text: string;
    quoted: boolean;
}

/**
 * Split a Stata list on whitespace, keeping `"..."` and compound `` `"..."' ``
 * spans together as single (quoted) elements with their quotes stripped.
 */
function split_quote_aware(text: string): ListItem[] {
    const items: ListItem[] = [];
    let i = 0;
    const n = text.length;
    while (i < n) {
        const c = text[i];
        if (c === ' ' || c === '\t') {
            i++;
            continue;
        }
        if (c === '`' && text[i + 1] === '"') {
            const end = text.indexOf('"\'', i + 2);
            if (end === -1) {
                items.push({ text: text.slice(i + 2), quoted: true });
                break;
            }
            items.push({ text: text.slice(i + 2, end), quoted: true });
            i = end + 2;
        } else if (c === '"') {
            const end = text.indexOf('"', i + 1);
            if (end === -1) {
                items.push({ text: text.slice(i + 1), quoted: true });
                break;
            }
            items.push({ text: text.slice(i + 1, end), quoted: true });
            i = end + 1;
        } else {
            let j = i;
            while (j < n && text[j] !== ' ' && text[j] !== '\t') j++;
            items.push({ text: text.slice(i, j), quoted: false });
            i = j;
        }
    }
    return items;
}

/**
 * Split a folded list value into elements using the same quote-aware rules as a
 * literal `in` list, so a macro-backed list with quoted elements
 * (e.g. `local xs `"a"' `"b"'`) is split the way Stata iterates it.
 */
function split_list(text: string): string[] {
    return split_quote_aware(text).map((my_item) => my_item.text);
}

function resolve_int(token: string, env: StaticValueEnv): number | null {
    let text = token;
    const local_match = token.match(LOCAL_REF);
    const global_match = token.match(GLOBAL_REF);
    if (local_match) {
        const folded = env.resolve_local(local_match[1]);
        if (folded === null) return null;
        text = folded.trim();
    } else if (global_match) {
        const folded = env.resolve_global(global_ref_name(global_match));
        if (folded === null) return null;
        text = folded.trim();
    }
    if (!INT_LITERAL.test(text)) return null;
    return parseInt(text, 10);
}

function resolve_foreach(spec_tail: string, env: StaticValueEnv): IteratorValueSet {
    const values: string[] = [];
    for (const my_item of split_quote_aware(spec_tail)) {
        if (my_item.quoted) {
            values.push(my_item.text);
            if (values.length > VALUE_SET_CAP) return { kind: 'dynamic' };
            continue;
        }
        const local_match = my_item.text.match(LOCAL_REF);
        const global_match = my_item.text.match(GLOBAL_REF);
        if (local_match || global_match) {
            const folded = local_match
                ? env.resolve_local(local_match[1])
                : env.resolve_global(global_ref_name(global_match!));
            if (folded === null) continue; // partial: drop unresolvable item
            for (const my_value of split_list(folded)) {
                values.push(my_value);
                if (values.length > VALUE_SET_CAP) return { kind: 'dynamic' };
            }
        } else {
            values.push(my_item.text);
            if (values.length > VALUE_SET_CAP) return { kind: 'dynamic' };
        }
    }
    return { kind: 'static', values };
}

interface SteppedRange {
    start: string;
    step: string;
    end: string;
}

function parse_stepped_range(text: string): SteppedRange | null {
    const close = text.lastIndexOf(')');
    if (close <= 0 || close === text.length - 1) return null;

    const open = text.lastIndexOf('(', close - 1);
    if (open <= 0 || open === close - 1) return null;

    return {
        start: text.slice(0, open),
        step: text.slice(open + 1, close),
        end: text.slice(close + 1),
    };
}

interface SlashRange {
    start: string;
    end: string;
}

function parse_slash_range(text: string): SlashRange | null {
    const slash = text.lastIndexOf('/');
    if (slash <= 0 || slash === text.length - 1) return null;
    return {
        start: text.slice(0, slash),
        end: text.slice(slash + 1),
    };
}

function resolve_forvalues(spec_tail: string, env: StaticValueEnv): IteratorValueSet {
    // The parser reconstructs loopSpec with spaces between tokens (e.g.
    // "1 / 3", "1 ( 2 ) 9"); numeric ranges carry no meaningful whitespace,
    // so collapse it before matching.
    const text = spec_tail.replace(/\s+/g, '');
    // a(step)b
    const stepped = parse_stepped_range(text);
    if (stepped) {
        const start = resolve_int(stepped.start, env);
        const step = resolve_int(stepped.step, env);
        const end = resolve_int(stepped.end, env);
        if (start === null || step === null || end === null || step === 0) {
            return { kind: 'dynamic' };
        }
        return sequence(start, step, end);
    }
    // a/b
    const ranged = parse_slash_range(text);
    if (ranged) {
        const start = resolve_int(ranged.start, env);
        const end = resolve_int(ranged.end, env);
        if (start === null || end === null) return { kind: 'dynamic' };
        return sequence(start, 1, end);
    }
    return { kind: 'dynamic' };
}

function sequence(start: number, step: number, end: number): IteratorValueSet {
    const values: string[] = [];
    if (step > 0) {
        for (let v = start; v <= end; v += step) {
            values.push(String(v));
            if (values.length > VALUE_SET_CAP) return { kind: 'dynamic' };
        }
    } else {
        for (let v = start; v >= end; v += step) {
            values.push(String(v));
            if (values.length > VALUE_SET_CAP) return { kind: 'dynamic' };
        }
    }
    return { kind: 'static', values };
}

export function resolve_loop_value_set(
    loop_type: 'foreach' | 'forvalues',
    loop_spec: string | undefined,
    env: StaticValueEnv
): IteratorValueSet {
    if (!loop_spec) return { kind: 'dynamic' };
    const spec = loop_spec.trim();
    if (loop_type === 'forvalues') {
        const eq = spec.replace(/^=\s*/, '');
        return resolve_forvalues(eq, env);
    }
    // foreach
    if (spec.startsWith('in ') || spec === 'in') {
        return resolve_foreach(spec.slice(2).trim(), env);
    }
    if (spec.startsWith('of local ')) {
        const name = spec.slice('of local '.length).trim();
        if (!LOCAL_REF.test(`\`${name}'`)) return { kind: 'dynamic' };
        const folded = env.resolve_local(name);
        if (folded === null) return { kind: 'dynamic' };
        return capped_static(split_list(folded));
    }
    if (spec.startsWith('of global ')) {
        const name = spec.slice('of global '.length).trim();
        const folded = env.resolve_global(name);
        if (folded === null) return { kind: 'dynamic' };
        return capped_static(split_list(folded));
    }
    return { kind: 'dynamic' };
}

function capped_static(values: string[]): IteratorValueSet {
    if (values.length > VALUE_SET_CAP) return { kind: 'dynamic' };
    return { kind: 'static', values };
}
