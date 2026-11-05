/**
 * Words of a command's arguments, as Stata splits them.
 *
 * The parser splits an argument at each macro reference, so
 * `` tempvar tv`i' `` has the items `tv` and `` `i' ``. Stata reads
 * them as one word: the name is `tv` followed by the value of `i`
 * (`tv3`), and no local named `tv` is created. Commands that take
 * names (`c_local`, `tempvar`, `args`, ...) must read words, not
 * items, or they register a prefix as a name and count positions
 * wrong.
 *
 * Only a macro reference joins items. A quote ends a name, so
 * `` c_local qa"`v'" `` defines `qa` (checked in StataMP 18).
 */
import { Range } from 'vscode-languageserver-textdocument';
import { IdentifierNode } from '../types';

export interface NameWord {
    /** The word's items in order; more than one when joined. */
    items: IdentifierNode[];
    range: Range;
}

/**
 * A macro reference item: `` `name' ``, `` `=exp' ``, `$name` or
 * `${name}`. A compound-quote opener `` `" `` is not one.
 */
function is_macro_item(item: IdentifierNode): boolean {
    return item.name.startsWith('$')
        || (item.name.startsWith('`') && !item.name.startsWith('`"'));
}

/** `"` or the compound-quote opener `` `" ``: either ends a name. */
function is_quote_opener(item: IdentifierNode): boolean {
    return item.name.startsWith('"') || item.name.startsWith('`"');
}

function touches(a: Range, b: Range): boolean {
    return a.end.line === b.start.line
        && a.end.character === b.start.character;
}

/**
 * Join items that touch a macro reference into words. A quote never
 * joins the word before it: `` c_local `n'"v" `` names `` `n' ``.
 */
export function group_name_words(
    items: readonly IdentifierNode[]
): NameWord[] {
    const the_words: NameWord[] = [];
    let previous: IdentifierNode | undefined;
    for (const my_item of items) {
        const last = the_words[the_words.length - 1];
        if (
            last !== undefined
            && previous !== undefined
            && touches(previous.range, my_item.range)
            && !is_quote_opener(my_item)
            && (is_macro_item(previous) || is_macro_item(my_item))
        ) {
            last.items.push(my_item);
            last.range = { start: last.range.start, end: my_item.range.end };
        } else {
            the_words.push({ items: [my_item], range: my_item.range });
        }
        previous = my_item;
    }
    return the_words;
}

/**
 * The word's only item, or undefined when the word joins a name to a
 * macro (`` foo`x' ``, `` `x'foo ``, `` `a'`b' ``): its name is known
 * only at run time.
 */
export function whole_word_item(
    word: NameWord | undefined
): IdentifierNode | undefined {
    return word !== undefined && word.items.length === 1
        ? word.items[0]
        : undefined;
}
