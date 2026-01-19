/**
 * Send-to-Stata module for VS Code extension.
 * Provides functionality to send Stata code to Stata application (macOS) or terminal.
 */

// Core types
export type StataVariant = 'StataMP' | 'StataSE' | 'StataIC' | 'Stata';
export type StataCommand = 'do' | 'include';
export type SendTarget = 'app' | 'terminal';

export interface StatementBounds {
    start_line: number;  // 0-indexed, inclusive
    end_line: number;    // 0-indexed, inclusive
}

// Module exports
export {
    ends_with_continuation,
    detect_statement,
    get_statement_text
} from './statement-detector';
