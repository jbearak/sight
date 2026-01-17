/**
 * External scanner for tree-sitter-stata
 *
 * This scanner handles line-start detection for star comments.
 * Stata treats `*` as a comment only when it's the first non-whitespace
 * character on a line.
 */

#include <tree_sitter/parser.h>
#include <stdlib.h>

enum TokenType {
    LINE_START,
};

typedef struct {
    bool at_line_start;
} Scanner;

void *tree_sitter_stata_external_scanner_create(void) {
    Scanner *scanner = (Scanner *)malloc(sizeof(Scanner));
    scanner->at_line_start = true;
    return scanner;
}

void tree_sitter_stata_external_scanner_destroy(void *payload) {
    free(payload);
}

unsigned tree_sitter_stata_external_scanner_serialize(void *payload, char *buffer) {
    Scanner *scanner = (Scanner *)payload;
    buffer[0] = scanner->at_line_start ? 1 : 0;
    return 1;
}

void tree_sitter_stata_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {
    Scanner *scanner = (Scanner *)payload;
    scanner->at_line_start = (length > 0) ? (buffer[0] != 0) : true;
}

static void skip_whitespace(TSLexer *lexer) {
    while (lexer->lookahead == ' ' || lexer->lookahead == '\t') {
        lexer->advance(lexer, true);
    }
}

bool tree_sitter_stata_external_scanner_scan(
    void *payload,
    TSLexer *lexer,
    const bool *valid_symbols
) {
    Scanner *scanner = (Scanner *)payload;

    // Handle LINE_START token - only emit if we're at line start AND next char is *
    if (valid_symbols[LINE_START] && scanner->at_line_start) {
        skip_whitespace(lexer);
        if (lexer->lookahead == '*') {
            lexer->result_symbol = LINE_START;
            return true;
        }
        scanner->at_line_start = false;
    }

    // Track newlines
    if (lexer->lookahead == '\n' || lexer->lookahead == '\r') {
        scanner->at_line_start = true;
    }

    return false;
}
