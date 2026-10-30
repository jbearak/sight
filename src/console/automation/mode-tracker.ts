/**
 * Predicts which prompt Stata shows next, from the lines sent, for the
 * Automation backend (Stata's log has no prompts of its own).
 *
 * The prediction decides the prompt drawn and which completion rule
 * applies; it never decides what is sent. Log evidence corrects it:
 * an error or `--Break--` returns to top level, and Stata reporting
 * itself free means top level (it is busy whenever it waits for more
 * block, program, Mata or Python input).
 *
 * Stata syntax is case-sensitive, so every keyword here is matched
 * exactly.
 */

import { StataLexer } from '../../lexer';

export type Mode =
    | { kind: 'stata' }
    /** Inside braces opened at top level; `line` numbers the next prompt. */
    | { kind: 'block'; depth: number; line: number }
    /** Inside `program define` until `end`. */
    | { kind: 'program'; line: number }
    /** Mata; `depth` counts open braces (continuation rows). */
    | { kind: 'mata'; depth: number }
    /** Python; `continuation` after a line ending in `:`. */
    | { kind: 'python'; continuation: boolean };

// `program`, abbreviated to `pr` at least, optionally with `define`
// (abbreviated to `de`), then a name; not `program drop/dir/list`.
const PROGRAM_DEFINE = /^pr(?:o(?:g(?:r(?:a(?:m)?)?)?)?)?(?:\s+de(?:f(?:i(?:n(?:e)?)?)?)?)?\s+([A-Za-z_][A-Za-z0-9_]*)\b/;
const PROGRAM_NOT_DEFINE = /^pr(?:o(?:g(?:r(?:a(?:m)?)?)?)?)?\s+(?:drop|di(?:r)?|l(?:i(?:s(?:t)?)?)?)\b/;
// `mata` or `mata:` alone (an optional `, options` tail), not `mata: stmt`.
const MATA_ENTER = /^mata(?:\s*:)?\s*(?:,.*)?$/;
const PYTHON_ENTER = /^python(?:\s*:)?\s*(?:,.*)?$/;

export class ModeTracker {
    private mode: Mode = { kind: 'stata' };

    get current(): Mode {
        return this.mode;
    }

    /** True when Stata is predicted to be waiting for more input. */
    awaiting_input(): boolean {
        return this.mode.kind !== 'stata';
    }

    /** The prompt console Stata would print for the current mode. */
    prompt(): string {
        switch (this.mode.kind) {
            case 'stata':
                return '. ';
            case 'block':
            case 'program':
                return `${String(this.mode.line).padStart(3)}. `;
            case 'mata':
                return this.mode.depth > 0 ? '> ' : ': ';
            case 'python':
                return this.mode.continuation ? '... ' : '>>> ';
        }
    }

    /**
     * Advance past a line sent in the current mode. Returns true when
     * the line enters Mata or Python (whose start can be slow).
     */
    advance(line: string): boolean {
        const text = line.trim();
        const mode = this.mode;
        switch (mode.kind) {
            case 'stata': {
                if (MATA_ENTER.test(text)) {
                    this.mode = { kind: 'mata', depth: 0 };
                    return true;
                }
                if (PYTHON_ENTER.test(text)) {
                    this.mode = { kind: 'python', continuation: false };
                    return true;
                }
                if (PROGRAM_DEFINE.test(text) && !PROGRAM_NOT_DEFINE.test(text)) {
                    this.mode = { kind: 'program', line: 1 };
                    return false;
                }
                const net = brace_balance(line);
                if (net > 0) {
                    this.mode = { kind: 'block', depth: net, line: 2 };
                }
                return false;
            }
            case 'block': {
                const depth = mode.depth + brace_balance(line);
                this.mode = depth <= 0
                    ? { kind: 'stata' }
                    : { kind: 'block', depth, line: mode.line + 1 };
                return false;
            }
            case 'program':
                this.mode = text === 'end'
                    ? { kind: 'stata' }
                    : { kind: 'program', line: mode.line + 1 };
                return false;
            case 'mata': {
                if (mode.depth === 0 && text === 'end') {
                    this.mode = { kind: 'stata' };
                    return false;
                }
                const depth = Math.max(0, mode.depth + brace_balance(line));
                this.mode = { kind: 'mata', depth };
                return false;
            }
            case 'python':
                if (!mode.continuation && text === 'end') {
                    this.mode = { kind: 'stata' };
                } else if (text.endsWith(':')) {
                    this.mode = { kind: 'python', continuation: true };
                } else if (text.length === 0) {
                    this.mode = { kind: 'python', continuation: false };
                }
                return false;
        }
    }

    /** Stata reported an error (`r(N);`). */
    observe_error(): void {
        // An error abandons a block or program definition; Mata and
        // Python stay where they are.
        if (this.mode.kind === 'block' || this.mode.kind === 'program') {
            this.mode = { kind: 'stata' };
        }
    }

    /** `--Break--`, a break we sent, or Stata reporting itself free. */
    reset_top(): void {
        this.mode = { kind: 'stata' };
    }

    /**
     * An echo read at `prefix` that the console didn't send (typed in
     * the Stata window): adopt what it says about the mode.
     */
    observe_foreign_echo(prefix: string): void {
        const trimmed = prefix.trim();
        if (trimmed === ':') {
            this.mode = { kind: 'mata', depth: 0 };
        } else if (trimmed === '>>>') {
            this.mode = { kind: 'python', continuation: false };
        }
    }
}

/** Opening minus closing braces, by Sight's lexer (strings, comments). */
export function brace_balance(line: string): number {
    if (!line.includes('{') && !line.includes('}')) {
        return 0;
    }
    try {
        let net = 0;
        for (const my_token of new StataLexer().tokenize(line).tokens) {
            if (my_token.type === 'LBRACE') {
                net++;
            } else if (my_token.type === 'RBRACE') {
                net--;
            }
        }
        return net;
    } catch {
        return 0;
    }
}

/** Prompt prefixes Stata writes before echoed lines in its log. */
const ECHO_PREFIX = /^(\.\.\.|>>>|:|>|\.|\s+\d+\.)(?: (.*))?$/;

export interface ParsedEcho {
    prefix: string;
    rest: string;
}

/** Split a log line into Stata's prompt prefix and the echoed text. */
export function parse_echo(line: string): ParsedEcho | null {
    const match = ECHO_PREFIX.exec(line);
    if (!match) {
        return null;
    }
    return { prefix: match[1] ?? '', rest: match[2] ?? '' };
}
