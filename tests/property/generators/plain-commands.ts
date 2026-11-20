/**
 * Command-name generator for parser property tests.
 */

import * as fc from 'fast-check';
import { StataLexer } from '../../../src/lexer';
import { StataParser } from '../../../src/parser';
import { arbitrary_non_reserved_identifier } from './primitives';

/**
 * A name the parser reads as an ordinary command. A random short name
 * is now and then one with its own syntax (`di` for display, `pr` for
 * a program definition), whose arguments are not a varlist; properties
 * about ordinary commands' parenthesized varlists draw from this.
 */
export function arbitrary_plain_command(): fc.Arbitrary<string> {
    return arbitrary_non_reserved_identifier().filter((my_name) => {
        const my_tokens = new StataLexer().tokenize(`${my_name} (zzv)=zzw`);
        const my_node = new StataParser().parse(my_tokens.tokens).ast
            ?.nodes?.[0];
        if (my_node?.type !== 'command' || my_node.name !== my_name) {
            return false;
        }
        const my_group = my_node.varlist?.find(
            my_item => my_item.name.startsWith('(') &&
                my_item.name.endsWith(')'),
        );
        return my_group?.name === '(zzv)' &&
            my_node.expression !== undefined;
    });
}
