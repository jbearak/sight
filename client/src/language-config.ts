import {
    Disposable,
    SyntaxTokenType,
    languages,
    workspace,
} from 'vscode';

/**
 * The full language configuration object matching language-configuration.json,
 * minus the dynamic lineComment field which is applied separately.
 */
const STATA_LANGUAGE_CONFIG_BASE = {
    comments: {
        blockComment: ['/*', '*/'] as [string, string],
    },
    wordPattern: /[a-zA-Z_][a-zA-Z0-9_]*/,
    brackets: [
        ['{', '}'],
        ['[', ']'],
        ['(', ')'],
    ] as [string, string][],
    autoClosingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '"', close: '"', notIn: [SyntaxTokenType.String] },
        { open: '`', close: "'", notIn: [] as SyntaxTokenType[] },
    ],
    surroundingPairs: [
        ['{', '}'],
        ['[', ']'],
        ['(', ')'],
        ['"', '"'],
    ] as [string, string][],
    indentationRules: {
        increaseIndentPattern:
            /^\s*(program\s+define|if|else|foreach|forvalues|while)\b.*$|^\s*\{\s*$/,
        decreaseIndentPattern: /^\s*(end|else|\})\s*$/,
    },
};

/**
 * Read the current line comment style from workspace settings.
 * Returns '//' for any unrecognized value (safe fallback).
 */
export function read_line_comment_style(): '//' | '*' {
    const config = workspace.getConfiguration('sight');
    const style = config.get<string>('lineCommentStyle', '//');
    return style === '*' ? '*' : '//';
}

/**
 * Apply the Stata language configuration with the given line comment style.
 * Returns a Disposable that must be disposed before re-applying.
 */
export function apply_language_configuration(
    line_comment: '//' | '*'
): Disposable {
    return languages.setLanguageConfiguration('stata', {
        ...STATA_LANGUAGE_CONFIG_BASE,
        comments: {
            lineComment: line_comment,
            blockComment: ['/*', '*/'] as [string, string],
        },
    });
}
