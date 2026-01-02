# Requirements Document

## Introduction

This feature addresses a bug where the Stata LSP incorrectly reports false positive "split literal" diagnostics for extended missing values (`.a` through `.z`). The lexer currently tokenizes `.a` as two separate tokens (`.` and `a`), causing the parser's split literal detection to incorrectly warn about code that is already correctly written.

In Stata, extended missing values are `.a`, `.b`, `.c`, ... `.z` (26 lowercase values only), which represent different types of missing data. These should be tokenized as single tokens, not as a dot followed by a letter. Note that uppercase variants (`.A` through `.Z`) are NOT valid Stata syntax and should be reported as errors.

## Glossary

- **Extended_Missing_Value**: A Stata value representing missing data, written as `.a` through `.z` (26 lowercase values only). These are distinct from the system missing value (`.`). Uppercase variants are NOT valid.
- **System_Missing_Value**: The basic Stata missing value, written as `.` (a single dot).
- **Lexer**: The component that tokenizes Stata source code into tokens.
- **Split_Literal_Detection**: Parser logic that warns when tokens that could form a single literal are separated by whitespace (e.g., `. a` suggesting `.a`).
- **NUMBER_Token**: A token type representing numeric literals, including decimals like `.5` or `3.14`.

## Requirements

### Requirement 1: Extended Missing Value Tokenization

**User Story:** As a Stata developer, I want extended missing values (`.a` through `.z`) to be recognized as single tokens, so that I don't receive false positive diagnostics when using them in my code.

#### Acceptance Criteria

1. WHEN the Lexer encounters a dot immediately followed by a single lowercase letter (`a` through `z`), THE Lexer SHALL tokenize it as a single NUMBER token with value `.a` through `.z`
2. WHEN the Lexer encounters a dot immediately followed by a single uppercase letter (`A` through `Z`), THE Lexer SHALL tokenize it as a single WORD token (e.g., `.A`) which will be reported as a syntax error by the parser/analyzer
3. WHEN the Lexer encounters a dot followed by whitespace and then a letter, THE Lexer SHALL tokenize them as separate tokens (dot as WORD, letter as WORD)
4. WHEN the Lexer encounters a dot followed by a digit, THE Lexer SHALL continue to tokenize it as a NUMBER token (existing behavior for decimals like `.5`)
5. WHEN the Lexer encounters a dot followed by multiple letters (e.g., `.ab`), THE Lexer SHALL tokenize it as a single WORD token (e.g., `.ab`)

### Requirement 2: Split Literal Detection Accuracy

**User Story:** As a Stata developer, I want the split literal detection to only warn about actual split literals (where whitespace separates tokens that should be together), so that I don't receive false positives for correctly written code.

#### Acceptance Criteria

1. WHEN the Parser encounters a dot token followed by a letter token with whitespace between them (e.g., `. a`), THE Parser SHALL emit a diagnostic suggesting `.a` (extended missing value)
2. WHEN the Parser encounters an extended missing value token (e.g., `.a`), THE Parser SHALL NOT emit any split literal diagnostic
3. WHEN the Parser encounters a dot token followed by a number token with whitespace between them (e.g., `. 5`), THE Parser SHALL emit a diagnostic suggesting `.5`
4. WHEN the Parser encounters a decimal number token (e.g., `.5`), THE Parser SHALL NOT emit any split literal diagnostic

### Requirement 3: Backward Compatibility

**User Story:** As a Stata developer, I want existing code that uses extended missing values to continue working correctly, so that the fix doesn't break any existing functionality.

#### Acceptance Criteria

1. WHEN code contains extended missing values in if-qualifiers (e.g., `if x == .a`), THE Lexer and Parser SHALL process it without errors or warnings
2. WHEN code contains extended missing values in expressions (e.g., `replace x = .b if missing(x)`), THE Lexer and Parser SHALL process it without errors or warnings
3. WHEN code contains the system missing value (`.`), THE Lexer SHALL continue to tokenize it as a WORD token (existing behavior)
4. WHEN code contains decimal numbers (e.g., `.5`, `3.14`), THE Lexer SHALL continue to tokenize them as NUMBER tokens (existing behavior)
