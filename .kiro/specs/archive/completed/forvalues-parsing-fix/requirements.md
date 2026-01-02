# Requirements Document

## Introduction

This document specifies the fix for a bug in the `forvalues` loop parsing logic that causes false positive diagnostics. The parser incorrectly checks if the current token (the loop variable) has a value of `=`, `in`, or `of`, when it should check the next token. This causes the loop specification to be skipped, leading to the `{` being parsed as a standalone token and triggering a false "open brace must be on the same line as the condition" error.

## Glossary

- **Parser**: The component that builds an AST from tokens
- **Loop_Spec**: The specification part of a loop (e.g., `= 1/9` in `forvalues b = 1/9 {`)
- **Loop_Variable**: The iterator variable in a loop (e.g., `b` in `forvalues b = 1/9 {`)
- **LBRACE**: The opening brace token `{`
- **OPERATOR**: Token type for operators like `=`, `+`, `-`, etc.
- **WORD**: Token type for identifiers and keywords

## Requirements

### Requirement 1: Correct Loop Specification Detection

**User Story:** As a Stata developer, I want the parser to correctly identify the loop specification in `forvalues` statements, so that valid code does not produce false positive diagnostics.

#### Acceptance Criteria

1. WHEN the Parser encounters a `forvalues` statement with syntax `forvalues var = range {`, THE Parser SHALL correctly identify `=` as the start of the loop specification
2. WHEN the Parser encounters a `forvalues` statement with syntax `forvalues var = start/end {`, THE Parser SHALL consume all tokens up to and including the `{` as part of the loop
3. WHEN the Parser parses `forvalues b = 1/9 {`, THE Parser SHALL NOT emit an "open brace must be on the same line as the condition" diagnostic
4. WHEN the Parser parses `forvalues b = 1/9 { command }` (single-line loop), THE Parser SHALL correctly parse the body and closing brace

### Requirement 2: Preserve Existing foreach Parsing

**User Story:** As a Stata developer, I want `foreach` loops to continue working correctly after the fix, so that existing functionality is not broken.

#### Acceptance Criteria

1. WHEN the Parser encounters a `foreach` statement with syntax `foreach var in list {`, THE Parser SHALL correctly identify `in` as the start of the loop specification
2. WHEN the Parser encounters a `foreach` statement with syntax `foreach var of varlist {`, THE Parser SHALL correctly identify `of` as the start of the loop specification
3. THE Parser SHALL continue to correctly parse all existing `foreach` loop variants

### Requirement 3: Handle Edge Cases

**User Story:** As a Stata developer, I want the parser to handle edge cases in loop syntax, so that unusual but valid code is parsed correctly.

#### Acceptance Criteria

1. WHEN the Parser encounters a `forvalues` loop with the body on the same line as the header, THE Parser SHALL correctly parse both the header and body
2. WHEN the Parser encounters a `forvalues` loop with the `{` on a separate line (invalid Stata), THE Parser SHALL emit the appropriate diagnostic
3. WHEN the Parser encounters a `forvalues` loop with continuation lines in the specification, THE Parser SHALL correctly handle the continuation
