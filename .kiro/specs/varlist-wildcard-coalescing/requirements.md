# Requirements Document

## Introduction

This document specifies requirements for coalescing wildcard patterns in Stata varlist parsing. In Stata, patterns like `var*` (all variables starting with "var") and `x?` (single-character wildcard) are single semantic units, not separate tokens. Currently, the parser treats `var*` as two separate varlist items (`var` and `*`), which is incorrect. The parser should coalesce adjacent word + wildcard tokens into single varlist items when they represent wildcard patterns.

## Glossary

- **Parser**: The component (`src/parser/index.ts`) that builds an AST from tokens
- **Varlist**: A list of variable names, expressions, or parenthesized groups in a Stata command
- **Wildcard Pattern**: A variable name pattern using `*` (matches zero or more characters) or `?` (matches exactly one character)
- **VarlistItem**: An AST node representing a single item in a varlist, with a `name` property and `range`
- **Token Coalescing**: The process of combining adjacent tokens into a single semantic unit

## Requirements

### Requirement 1: Coalesce Trailing Wildcard Patterns

**User Story:** As a Stata developer, I want wildcard patterns like `var*` to be parsed as single varlist items, so that the AST accurately represents Stata's variable expansion semantics.

#### Acceptance Criteria

1. WHEN the Parser encounters a WORD token immediately followed by an `*` OPERATOR token with no whitespace between them, THE Parser SHALL coalesce them into a single VarlistItem with the combined name (e.g., `var*`)
2. WHEN the Parser encounters a WORD token immediately followed by a `?` token with no whitespace between them, THE Parser SHALL coalesce them into a single VarlistItem with the combined name (e.g., `x?`)
3. WHEN the Parser coalesces wildcard tokens, THE Parser SHALL set the VarlistItem range to span from the start of the WORD token to the end of the wildcard token
4. WHEN there is whitespace between a WORD token and a wildcard token, THE Parser SHALL NOT coalesce them (they are separate items)

### Requirement 2: Handle Multiple Wildcard Patterns in Varlist

**User Story:** As a Stata developer, I want commands with multiple wildcard patterns to parse correctly, so that commands like `rename old* new*` work as expected.

#### Acceptance Criteria

1. WHEN a command contains multiple wildcard patterns (e.g., `rename old* new*`), THE Parser SHALL coalesce each pattern independently
2. WHEN wildcard patterns are separated by whitespace, THE Parser SHALL produce separate VarlistItems for each pattern
3. WHEN a varlist contains a mix of wildcard patterns and regular variables (e.g., `summarize var* other`), THE Parser SHALL correctly distinguish between coalesced patterns and regular variables

### Requirement 3: Preserve Existing Behavior for Non-Wildcard Contexts

**User Story:** As a Stata developer, I want the `*` operator to continue working correctly in expression contexts, so that arithmetic operations are not affected.

#### Acceptance Criteria

1. WHEN `*` appears in an expression context (e.g., `generate y = x*2`), THE Parser SHALL NOT coalesce it with the preceding token
2. WHEN `*` appears after an `=` sign in an assignment, THE Parser SHALL treat it as a multiplication operator
3. WHEN `*` appears at the start of a line, THE Parser SHALL continue to treat it as a comment marker (existing behavior)

### Requirement 4: Support Underscore-Only Wildcard Patterns

**User Story:** As a Stata developer, I want patterns like `_*` to be parsed correctly, so that I can match all variables starting with underscore.

#### Acceptance Criteria

1. WHEN the Parser encounters an underscore WORD token (`_`) immediately followed by a wildcard token, THE Parser SHALL coalesce them into a single VarlistItem (e.g., `_*`)
2. WHEN the Parser encounters a WORD token ending with underscore followed by a wildcard, THE Parser SHALL coalesce them (e.g., `my_var*`)

### Requirement 5: Handle Question Mark Wildcard Patterns

**User Story:** As a Stata developer, I want single-character wildcard patterns like `var?` to be parsed correctly, so that I can match variables with single-character suffixes.

#### Acceptance Criteria

1. WHEN the Parser encounters a WORD token immediately followed by a `?` token with no whitespace, THE Parser SHALL coalesce them into a single VarlistItem (e.g., `var?`)
2. WHEN multiple `?` wildcards follow a WORD token (e.g., `var??`), THE Parser SHALL coalesce all adjacent wildcards into the pattern
