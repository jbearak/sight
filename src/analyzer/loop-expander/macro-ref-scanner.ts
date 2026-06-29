/**
 * Shared scanner for Stata macro references inside a constructed string.
 *
 * Both the static value-folder (`static-value-env.ts`) and the constructed-name
 * template parser (`name-expander.ts`) walk the same grammar — backtick local
 * refs `` `name' ``, dollar global refs `$name` / `${name}`, and literal text —
 * differing only in what they DO at each reference. This walks the grammar once
 * and dispatches to a visitor so the two callers cannot drift apart.
 *
 * Constructs we do not statically evaluate (`` `=expr' ``, nested/unbalanced
 * refs, malformed names) make the scan fail (`false`); a visitor callback may
 * also abort by returning `false` (e.g. a ref resolves to a dynamic value).
 */
import { is_valid_identifier } from '../option-argument-parser';

const MACRO_NAME_PART = /[A-Za-z0-9_]/;

export interface MacroRefVisitor {
    /** A single literal (non-reference) character. */
    literal(ch: string): void;
    /** A `` `name' `` local reference. Return false to abort the scan. */
    local_ref(name: string): boolean;
    /** A `$name` / `${name}` global reference. Return false to abort the scan. */
    global_ref(name: string): boolean;
}

/**
 * Scan `text` for macro references, invoking `visitor` for each literal char
 * and reference. Returns false if the text contains a construct we do not
 * statically evaluate, or if a visitor callback aborts.
 */
export function scan_macro_refs(text: string, visitor: MacroRefVisitor): boolean {
    let i = 0;
    while (i < text.length) {
        const c = text[i];
        if (c === '`') {
            // `=expr' (expression evaluation) and nested `...` are dynamic.
            if (text[i + 1] === '=') return false;
            let j = i + 1;
            let name = '';
            while (j < text.length && text[j] !== '\'' && text[j] !== '`') {
                name += text[j];
                j++;
            }
            if (j >= text.length || text[j] === '`') return false; // unbalanced/nested
            if (!is_valid_identifier(name)) return false;
            if (!visitor.local_ref(name)) return false;
            i = j + 1;
        } else if (c === '$') {
            let j = i + 1;
            let braced = false;
            if (text[j] === '{') {
                braced = true;
                j++;
            }
            let name = '';
            while (j < text.length && MACRO_NAME_PART.test(text[j])) {
                name += text[j];
                j++;
            }
            if (braced) {
                if (text[j] !== '}') return false;
                j++;
            }
            if (!is_valid_identifier(name)) return false;
            if (!visitor.global_ref(name)) return false;
            i = j;
        } else {
            visitor.literal(c);
            i++;
        }
    }
    return true;
}
