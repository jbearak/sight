/**
 * Classifies the trailing partial line of Stata console output as one of
 * the prompts the console knows how to serve.
 *
 * The console only treats a partial line as a prompt after output has
 * been quiet for a short while (see `session.ts`). Classification is
 * exact: Stata prints these prompts byte-for-byte, so no case folding or
 * whitespace trimming.
 */

export type PromptKind =
    | 'stata'
    | 'block'
    | 'mata'
    | 'python'
    | 'continuation'
    | 'pause'
    | 'more';

const PROMPT_PATTERNS: ReadonlyArray<readonly [PromptKind, RegExp]> = [
    ['stata', /^\. $/],
    ['block', /^ +\d+\. $/],
    ['mata', /^: $/],
    ['python', /^(?:>>>|\.\.\.) $/],
    ['continuation', /^> $/],
    ['pause', /^-> $/],
    ['more', /^--more--$/],
];

/** Prompts where the user types a command (everything but `--more--`). */
export const COMMAND_PROMPT_KINDS: ReadonlySet<PromptKind> = new Set([
    'stata',
    'block',
    'mata',
    'python',
    'continuation',
    'pause',
]);

/** Prompts whose input is Stata code and gets syntax highlighting. */
export const HIGHLIGHT_PROMPT_KINDS: ReadonlySet<PromptKind> = new Set([
    'stata',
    'block',
    'continuation',
    'pause',
]);

/** Prompts where Tab completion is offered. */
export const COMPLETION_PROMPT_KINDS: ReadonlySet<PromptKind> = new Set([
    'stata',
    'block',
]);

// Matches CSI/OSC escape sequences so a prompt Stata (or a profile)
// colored is still recognized. Escape sequences start with ESC (and OSC
// ends with BEL), so the pattern must contain control characters.
// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\))/g;

export function strip_ansi(text: string): string {
    return text.replace(ANSI_PATTERN, '');
}

/**
 * Return the prompt kind for `partial` (the text after the last newline),
 * or null when it is not a recognized prompt.
 */
export function classify_prompt(partial: string): PromptKind | null {
    const plain = strip_ansi(partial);
    for (const [my_kind, my_pattern] of PROMPT_PATTERNS) {
        if (my_pattern.test(plain)) {
            return my_kind;
        }
    }
    return null;
}
