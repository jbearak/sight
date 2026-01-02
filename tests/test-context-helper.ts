import { ContextTracker } from '../src/context-tracker';
import { StataLexer } from '../src/lexer';

/**
 * Helper to initialize a ContextTracker from source code.
 * Lexes the source and calls initialize_from_tokens().
 * 
 * This replaces the removed initialize(string) method for tests.
 */
export function init_tracker_from_source(tracker: ContextTracker, source: string): void {
    const lexer = new StataLexer();
    const lex_result = lexer.tokenize(source);
    tracker.initialize_from_tokens(lex_result.tokens, source);
}
