# Requirements Document

## Introduction

This feature addresses a bug in the Stata LSP lexer where nested local macro references are incorrectly flagged as "Unclosed string literal" errors. In Stata, local macro references can be nested, such as `` `path`i'' ``, where the inner macro `` `i' `` is expanded first, then concatenated with `path` to form a new macro name that is then expanded. The current lexer does not track nesting depth and incorrectly interprets the first single quote as the closing delimiter.

## Glossary

- **Lexer**: The component that tokenizes Stata source code into tokens
- **Local_Macro_Reference**: A Stata syntax construct using backtick and single quote delimiters (`` `name' ``) to reference local macro values
- **Nested_Macro_Reference**: A local macro reference that contains another macro reference within its name, such as `` `path`i'' `` where `` `i' `` is expanded first
- **Nesting_Depth**: The count of unmatched opening backticks encountered while scanning a macro reference

## Requirements

### Requirement 1: Nested Macro Reference Recognition

**User Story:** As a Stata developer, I want the LSP to correctly recognize nested local macro references, so that I don't receive false positive "Unclosed string literal" errors.

#### Acceptance Criteria

1. WHEN the Lexer encounters a backtick character, THE Lexer SHALL track the nesting depth by incrementing a counter
2. WHEN the Lexer encounters a single quote while scanning a local macro reference, THE Lexer SHALL decrement the nesting depth counter
3. WHEN the nesting depth reaches zero, THE Lexer SHALL consider the macro reference complete
4. THE Lexer SHALL produce a single MACRO_REF_LOCAL token for the entire nested macro reference including all nested parts

### Requirement 2: Correct Token Value Extraction

**User Story:** As a Stata developer, I want nested macro references to be tokenized with their complete value, so that downstream analysis can correctly identify the macro structure.

#### Acceptance Criteria

1. FOR ALL nested macro references, THE Lexer SHALL include the complete text from the opening backtick to the final closing single quote in the token value
2. WHEN tokenizing `` `path`i'' ``, THE Lexer SHALL produce a token with value `` `path`i'' ``
3. WHEN tokenizing `` `var`j'_suffix' ``, THE Lexer SHALL produce a token with value `` `var`j'_suffix' ``

### Requirement 3: Error Handling for Incomplete Nested Macros

**User Story:** As a Stata developer, I want appropriate error messages when nested macro references are genuinely incomplete, so that I can fix actual syntax errors.

#### Acceptance Criteria

1. WHEN a newline is encountered before all nesting levels are closed, THE Lexer SHALL emit an "Incomplete macro expression" error
2. WHEN end-of-file is reached before all nesting levels are closed, THE Lexer SHALL emit an "Incomplete macro expression" error
3. THE Lexer SHALL NOT emit false positive errors for correctly formed nested macro references

### Requirement 4: Deeply Nested Macro References

**User Story:** As a Stata developer, I want the LSP to handle arbitrarily deep nesting of macro references, so that complex macro constructs work correctly.

#### Acceptance Criteria

1. THE Lexer SHALL correctly handle macro references nested to any depth (e.g., `` `a`b`c''' ``)
2. FOR ALL valid nested macro references, the number of closing single quotes SHALL equal the number of opening backticks
3. WHEN the nesting depth exceeds a reasonable limit (e.g., 100), THE Lexer SHALL emit a warning but continue processing

### Requirement 5: No Regression for Simple Macro References

**User Story:** As a Stata developer, I want simple (non-nested) macro references to continue working correctly, so that existing code is not affected.

#### Acceptance Criteria

1. THE Lexer SHALL correctly tokenize simple macro references like `` `name' `` as before
2. THE Lexer SHALL correctly tokenize macro references with underscores like `` `my_var' ``
3. THE Lexer SHALL correctly tokenize macro references with numbers like `` `var1' ``
