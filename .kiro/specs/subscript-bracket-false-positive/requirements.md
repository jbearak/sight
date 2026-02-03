# Requirements Document

## Introduction

This document specifies the requirements for fixing a false positive diagnostic in the Stata LSP parser. The parser incorrectly flags subscript notation like `total_check[_n-1]` as a stray token when it appears after a comparison expression in `if` or `in` qualifiers. The fix ensures that square bracket subscript expressions are properly tracked in the state machine, similar to how parentheses are handled.

## Glossary

- **Parser**: The `StataParser` class in `src/parser/index.ts` that builds an AST from tokens
- **Qualifier_Expression**: An expression following `if` or `in` keywords in Stata commands
- **Subscript_Expression**: A bracket-enclosed expression like `[_n-1]` used to access array elements or observations
- **State_Machine**: The expression state tracking logic in `parseQualifierExpressionWithStrayDetection()` that detects stray tokens
- **Stray_Token**: An unexpected token after a comparison expression that likely indicates a syntax error
- **Bracket_Depth**: A counter tracking nested square bracket levels, analogous to `paren_depth`

## Requirements

### Requirement 1: Subscript Expression Recognition

**User Story:** As a Stata developer, I want subscript notation like `var[_n-1]` to be recognized as valid syntax in if/in qualifiers, so that I don't receive false positive diagnostics.

#### Acceptance Criteria

1. WHEN the Parser encounters a `LBRACKET` token in a qualifier expression, THE State_Machine SHALL increment the Bracket_Depth counter
2. WHEN the Parser encounters a `RBRACKET` token in a qualifier expression, THE State_Machine SHALL decrement the Bracket_Depth counter
3. WHEN the Bracket_Depth is greater than zero, THE Parser SHALL NOT emit stray token diagnostics for tokens inside the bracket expression
4. WHEN a closing bracket `]` is encountered, THE State_Machine SHALL treat the outer level as having seen an operand (transition to AFTER_OPERAND or AFTER_RHS depending on prior state)

### Requirement 2: Subscript Position Support

**User Story:** As a Stata developer, I want subscript notation to work on both sides of comparison operators, so that I can write expressions like `var1[_n] == var2[_n-1]`.

#### Acceptance Criteria

1. WHEN a Subscript_Expression appears on the left-hand side of a comparison, THE Parser SHALL NOT emit stray token diagnostics
2. WHEN a Subscript_Expression appears on the right-hand side of a comparison, THE Parser SHALL NOT emit stray token diagnostics
3. WHEN multiple Subscript_Expressions appear in the same condition, THE Parser SHALL handle each independently without false positives

### Requirement 3: Nested Bracket Handling

**User Story:** As a Stata developer, I want nested subscript expressions to be handled correctly, so that complex expressions don't trigger false positives.

#### Acceptance Criteria

1. WHEN nested brackets appear like `matrix[row[i], col]`, THE Parser SHALL track the Bracket_Depth correctly
2. WHEN brackets are nested inside parentheses like `(var[_n-1])`, THE Parser SHALL handle both depth counters independently
3. WHEN parentheses are nested inside brackets like `var[func(x)]`, THE Parser SHALL handle both depth counters independently

### Requirement 4: Stray Token Detection Preservation

**User Story:** As a Stata developer, I want actual stray tokens to still be detected, so that I receive helpful diagnostics for genuine syntax errors.

#### Acceptance Criteria

1. WHEN a genuine stray token appears after a comparison (e.g., `if x == y oops`), THE Parser SHALL emit a STRAY_TOKEN_IN_CONDITION diagnostic
2. WHEN a stray token appears after a subscript expression (e.g., `if var[_n] == 1 oops`), THE Parser SHALL emit a STRAY_TOKEN_IN_CONDITION diagnostic
3. WHEN an unbalanced bracket appears in a qualifier expression, THE Parser SHALL emit an UNBALANCED_PARENTHESES diagnostic

### Requirement 5: State Machine Consistency

**User Story:** As a maintainer, I want the bracket handling to follow the same patterns as parenthesis handling, so that the code remains consistent and maintainable.

#### Acceptance Criteria

1. THE State_Machine SHALL use a bracket state stack analogous to the existing parenthesis state stack
2. WHEN entering a bracket expression, THE State_Machine SHALL push a new INITIAL state onto the bracket state stack
3. WHEN exiting a bracket expression, THE State_Machine SHALL pop the bracket state stack and update the outer state appropriately
4. THE `isValidAfterComparison()` method SHALL return true for `LBRACKET` tokens (subscript expressions are valid continuations)
