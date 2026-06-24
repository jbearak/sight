/**
 * Real TextMate tokenizer harness for grammar tests.
 *
 * The other grammar tests (textmate-grammar.test.ts,
 * textmate-grammar-star-comments.test.ts) only run individual patterns through
 * `new RegExp(...)`. That cannot validate begin/end region behavior such as
 * nested block comments, which is inherently multiline and stateful. This
 * helper drives the grammar through the same engine VS Code uses
 * (vscode-textmate + vscode-oniguruma) so tests can assert the real scope
 * stack produced for a snippet.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Registry, parseRawGrammar, INITIAL } from 'vscode-textmate';
import type { IGrammar } from 'vscode-textmate';
import {
    loadWASM,
    createOnigScanner,
    createOnigString,
} from 'vscode-oniguruma';

const GRAMMAR_PATH = path.join(
    __dirname,
    '../../../client/syntaxes/stata.tmLanguage.json'
);
const WASM_PATH = path.join(
    __dirname,
    '../../../node_modules/vscode-oniguruma/release/onig.wasm'
);

// A single token of source text and the full scope stack that applies to it.
export interface ScopedToken {
    text: string;
    line: number; // 0-indexed
    start_column: number; // 0-indexed, inclusive
    end_column: number; // 0-indexed, exclusive
    scopes: string[];
}

let grammar_promise: Promise<IGrammar> | null = null;

function load_grammar(): Promise<IGrammar> {
    if (grammar_promise) {
        return grammar_promise;
    }

    const wasm_bin = fs.readFileSync(WASM_PATH);
    const onig_lib = loadWASM(wasm_bin).then(() => ({
        createOnigScanner,
        createOnigString,
    }));

    const registry = new Registry({
        onigLib: onig_lib,
        loadGrammar: async (scope_name: string) => {
            if (scope_name !== 'source.stata') {
                return null;
            }
            const content = fs.readFileSync(GRAMMAR_PATH, 'utf-8');
            return parseRawGrammar(content, GRAMMAR_PATH);
        },
    });

    grammar_promise = registry.loadGrammar('source.stata').then((my_grammar) => {
        if (!my_grammar) {
            throw new Error('Failed to load source.stata grammar');
        }
        return my_grammar;
    });
    return grammar_promise;
}

/**
 * Tokenize a multiline Stata snippet, returning every token with its scope
 * stack. The rule stack is carried from one line to the next so that
 * multiline state (block comments, mata blocks) is honored.
 */
export async function tokenize_stata(source: string): Promise<ScopedToken[]> {
    const grammar = await load_grammar();
    const the_lines = source.split('\n');
    const the_tokens: ScopedToken[] = [];

    let rule_stack = INITIAL;
    for (let i = 0; i < the_lines.length; i++) {
        const my_line = the_lines[i];
        const result = grammar.tokenizeLine(my_line, rule_stack);
        for (const my_token of result.tokens) {
            the_tokens.push({
                text: my_line.substring(my_token.startIndex, my_token.endIndex),
                line: i,
                start_column: my_token.startIndex,
                end_column: my_token.endIndex,
                scopes: my_token.scopes,
            });
        }
        rule_stack = result.ruleStack;
    }

    return the_tokens;
}

/**
 * Convenience: return the scope stack that applies at a given line/column.
 */
export function scopes_at(
    the_tokens: ScopedToken[],
    line: number,
    column: number
): string[] {
    for (const my_token of the_tokens) {
        if (
            my_token.line === line &&
            column >= my_token.start_column &&
            column < my_token.end_column
        ) {
            return my_token.scopes;
        }
    }
    return [];
}

/**
 * Convenience: find the first token whose text exactly equals `text`.
 */
export function find_token(
    the_tokens: ScopedToken[],
    text: string
): ScopedToken | undefined {
    return the_tokens.find((my_token) => my_token.text === text);
}

/**
 * Convenience: does any scope in the token's stack equal `scope`?
 */
export function has_scope(
    token: ScopedToken | undefined,
    scope: string
): boolean {
    return !!token && token.scopes.includes(scope);
}

/**
 * Convenience: the texts of all tokens carrying `scope`, in source order.
 */
export function texts_with_scope(
    the_tokens: ScopedToken[],
    scope: string
): string[] {
    return the_tokens
        .filter((my_token) => my_token.scopes.includes(scope))
        .map((my_token) => my_token.text);
}
