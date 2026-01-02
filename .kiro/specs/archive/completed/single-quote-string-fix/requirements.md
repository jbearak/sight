# Requirements Document

## Introduction

This feature fixes a bug in the Stata LSP lexer where single-quoted text (`'word'`) is incorrectly tokenized as a string literal. In Stata, single quotes are NOT string delimiters. The valid string literal syntaxes in Stata are:

1. Simple double quotes: `"word"`
2. Compound quotes: `` `"word"' `` (backtick-double-quote to open, double-quote-apostrophe to close)

The compound quote syntax allows embedding double quotes within strings, e.g., `` `"The person stated, "some stuff""' ``.

Single quotes (`'`) in Stata have a different purpose: they close local macro references that were opened with a backtick (`` ` ``), e.g., `` `macroname' ``.

## Glossary

- **Lexer**: The component that tokenizes Stata source code into tokens
- **String_Literal**: A sequence of characters enclosed in valid Stata string delimiters
- **Simple_String**: A string literal using double quotes: `"content"`
- **Compound_String**: A string literal using compound quotes: `` `"content"' ``
- **Local_Macro_Reference**: A reference to a local macro using backtick-apostrophe syntax: `` `name' ``
- **Apostrophe**: The single quote character (`'`), used only to close local macro references in Stata

## Requirements

### Requirement 1: Remove Single-Quote String Tokenization

**User Story:** As a Stata developer, I want the LSP to correctly recognize that single quotes are not string delimiters, so that my code is parsed accurately.

#### Acceptance Criteria

1. WHEN the Lexer encounters a standalone apostrophe (`'`) not preceded by a backtick, THE Lexer SHALL NOT tokenize it as the start of a string literal
2. WHEN the Lexer encounters `'word'` (text between single quotes), THE Lexer SHALL tokenize the apostrophes as separate tokens (OPERATOR or similar) and the word as a WORD token
3. WHEN the Lexer encounters a backtick followed by an apostrophe (`` `' ``), THE Lexer SHALL tokenize it as an empty local macro reference
4. WHEN the Lexer encounters a backtick followed by content and an apostrophe (`` `name' ``), THE Lexer SHALL tokenize it as a local macro reference (existing behavior, preserved)

### Requirement 2: Preserve Valid String Literal Tokenization

**User Story:** As a Stata developer, I want the LSP to correctly tokenize valid Stata string literals, so that strings are properly recognized.

#### Acceptance Criteria

1. WHEN the Lexer encounters a double quote (`"`), THE Lexer SHALL tokenize the content until the closing double quote as a STRING token with quoteStyle 'simple'
2. WHEN the Lexer encounters a backtick followed by a double quote (`` `" ``), THE Lexer SHALL tokenize the content until the closing double-quote-apostrophe (`"'`) as a STRING token with quoteStyle 'compound'
3. WHEN the Lexer encounters nested compound quotes, THE Lexer SHALL correctly track nesting depth and tokenize the entire compound string

### Requirement 3: Handle Apostrophe in Various Contexts

**User Story:** As a Stata developer, I want apostrophes to be handled correctly in all contexts, so that my code parses without false errors.

#### Acceptance Criteria

1. WHEN an apostrophe appears after a backtick (`` `name' ``), THE Lexer SHALL treat it as closing a local macro reference
2. WHEN an apostrophe appears in isolation (not closing a macro reference), THE Lexer SHALL tokenize it as an OPERATOR token
3. WHEN an apostrophe appears inside a double-quoted string (`"it's"`), THE Lexer SHALL include it as part of the string content
4. WHEN an apostrophe appears inside a compound string (`` `"it's"' ``), THE Lexer SHALL include it as part of the string content
5. IF an apostrophe appears without a matching backtick, THEN THE Lexer SHALL NOT report an "unclosed string literal" error
