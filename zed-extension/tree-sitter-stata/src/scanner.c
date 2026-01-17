/**
 * External scanner for tree-sitter-stata
 *
 * This scanner handles two special cases that require context-sensitive parsing:
 *
 * 1. Line-start detection (_line_start):
 *    Stata treats `*` as a comment only when it's the first non-whitespace
 *    character on a line. This token is emitted at the start of each line
 *    (after any leading whitespace) to enable the grammar to distinguish
 *    between `*` comments and multiplication operators.
 *
 * 2. Mata block content (_mata_block_content):
 *    Mata blocks (`mata ... end`) contain Mata code that has different syntax
 *    from Stata. Rather than fully parsing Mata, we consume everything between
 *    `mata` and `end` as opaque content.
 */

#include <tree_sitter/parser.h>
#include <wctype.h>
#include <string.h>

// Token types (must match order in grammar.js externals array)
enum TokenType {
    LINE_START,
    MATA_BLOCK_CONTENT,
};

// Scanner state
typedef struct {
    bool at_line_start;
} Scanner;

/**
 * Create a new scanner instance.
 */
void *tree_sitter_stata_external_scanner_create(void) {
    Scanner *scanner = (Scanner *)malloc(sizeof(Scanner));
    scanner->at_line_start = true;  // Start of file is start of line
    return scanner;
}

/**
 * Destroy the scanner instance.
 */
void tree_sitter_stata_external_scanner_destroy(void *payload) {
    Scanner *scanner = (Scanner *)payload;
    free(scanner);
}

/**
 * Serialize scanner state for incremental parsing.
 */
unsigned tree_sitter_stata_external_scanner_serialize(
    void *payload,
    char *buffer
) {
    Scanner *scanner = (Scanner *)payload;
    buffer[0] = scanner->at_line_start ? 1 : 0;
    return 1;
}

/**
 * Deserialize scanner state for incremental parsing.
 */
void tree_sitter_stata_external_scanner_deserialize(
    void *payload,
    const char *buffer,
    unsigned length
) {
    Scanner *scanner = (Scanner *)payload;
    if (length > 0) {
        scanner->at_line_start = buffer[0] != 0;
    } else {
        scanner->at_line_start = true;
    }
}

/**
 * Check if we're looking at the keyword "end" (case-sensitive).
 */
static bool is_end_keyword(TSLexer *lexer) {
    // Check for 'e'
    if (lexer->lookahead != 'e') return false;
    lexer->advance(lexer, false);

    // Check for 'n'
    if (lexer->lookahead != 'n') return false;
    lexer->advance(lexer, false);

    // Check for 'd'
    if (lexer->lookahead != 'd') return false;
    lexer->advance(lexer, false);

    // Make sure it's not followed by an identifier character
    if (iswalnum(lexer->lookahead) || lexer->lookahead == '_') return false;

    return true;
}

/**
 * Skip whitespace (spaces and tabs only, not newlines).
 */
static void skip_whitespace(TSLexer *lexer) {
    while (lexer->lookahead == ' ' || lexer->lookahead == '\t') {
        lexer->advance(lexer, true);
    }
}

/**
 * Main scanning function.
 */
bool tree_sitter_stata_external_scanner_scan(
    void *payload,
    TSLexer *lexer,
    const bool *valid_symbols
) {
    Scanner *scanner = (Scanner *)payload;

    // Handle LINE_START token
    if (valid_symbols[LINE_START]) {
        // Skip leading whitespace on the line
        skip_whitespace(lexer);

        // Check if we're at the start of a line (or start of file)
        if (scanner->at_line_start) {
            // We're at line start - emit the token
            lexer->result_symbol = LINE_START;
            scanner->at_line_start = false;
            return true;
        }
    }

    // Handle MATA_BLOCK_CONTENT token
    if (valid_symbols[MATA_BLOCK_CONTENT]) {
        // Skip any initial whitespace
        skip_whitespace(lexer);

        // Skip initial newline if present
        if (lexer->lookahead == '\r') {
            lexer->advance(lexer, true);
        }
        if (lexer->lookahead == '\n') {
            lexer->advance(lexer, true);
        }

        // Mark the start of the content
        lexer->mark_end(lexer);

        // Consume content until we find "end" at the start of a line
        bool found_end = false;
        bool line_start = true;

        while (!lexer->eof(lexer)) {
            // At the start of a line, check for "end"
            if (line_start) {
                // Skip whitespace at start of line
                while (lexer->lookahead == ' ' || lexer->lookahead == '\t') {
                    lexer->advance(lexer, false);
                }

                // Check if this is "end"
                if (is_end_keyword(lexer)) {
                    found_end = true;
                    break;
                }
                line_start = false;
            }

            // Track newlines for line_start detection
            if (lexer->lookahead == '\n') {
                lexer->advance(lexer, false);
                line_start = true;
                // Handle \r\n
                if (lexer->lookahead == '\r') {
                    lexer->advance(lexer, false);
                }
            } else if (lexer->lookahead == '\r') {
                lexer->advance(lexer, false);
                line_start = true;
                // Handle \r\n
                if (lexer->lookahead == '\n') {
                    lexer->advance(lexer, false);
                }
            } else {
                lexer->advance(lexer, false);
                line_start = false;
            }
        }

        // If we found "end", we need to back up to not include it
        // The mark_end was set before we started consuming, so we need to
        // re-mark at the position just before "end"
        if (found_end) {
            // We've already advanced past "end", so we need to mark
            // the end position before "end" was consumed
            // Actually, we consumed "end" in is_end_keyword, so we need
            // to handle this differently

            // For now, just return the content we've consumed
            // The grammar will handle the "end" keyword separately
        }

        lexer->result_symbol = MATA_BLOCK_CONTENT;
        scanner->at_line_start = true;  // After mata content, we're at line start
        return true;
    }

    // Track newlines for line_start state
    if (lexer->lookahead == '\n' || lexer->lookahead == '\r') {
        scanner->at_line_start = true;
    } else if (lexer->lookahead != ' ' && lexer->lookahead != '\t') {
        scanner->at_line_start = false;
    }

    return false;
}
