# Requirements Document

## Introduction

This feature addresses a false positive diagnostic issue where the LSP incorrectly reports "Unbalanced parentheses: missing closing parenthesis" when parentheses span across line continuations using `///`. The parser currently validates parenthesis balance on a per-line basis without accounting for Stata's line continuation syntax, leading to spurious warnings for valid multi-line expressions.

## Glossary

- **Parser**: The component that builds an AST from tokens and validates syntax structure
- **Line_Continuation**: Stata's `///` syntax that continues a logical line across physical lines
- **Parenthesis_Tracker**: The mechanism that tracks opening and closing parentheses for balance validation
- **Diagnostic**: An error or warning message reported by the LSP to the editor

## Requirements

### Requirement 1: Parenthesis Balance Across Line Continuations

**User Story:** As a Stata developer, I want the LSP to correctly track parenthesis balance across line continuations, so that I don't receive false positive diagnostics for valid multi-line expressions.

#### Acceptance Criteria

1. WHEN an opening parenthesis appears before a `///` continuation AND the closing parenthesis appears on a subsequent line, THE Parser SHALL treat them as balanced and not emit an unbalanced parenthesis diagnostic
2. WHEN multiple nested parentheses span across multiple continuation lines, THE Parser SHALL correctly track all nesting levels across the entire logical line
3. WHEN a parenthesis is genuinely unbalanced (missing closer even after all continuations), THE Parser SHALL emit the unbalanced parenthesis diagnostic
4. WHEN a closing parenthesis appears without a matching opener across the logical line, THE Parser SHALL emit an appropriate diagnostic

### Requirement 2: Diagnostic Position Accuracy

**User Story:** As a Stata developer, I want diagnostics for genuinely unbalanced parentheses to point to the correct location, so that I can quickly fix the issue.

#### Acceptance Criteria

1. WHEN an unbalanced parenthesis diagnostic is emitted for a multi-line expression, THE Diagnostic SHALL reference the position of the unmatched parenthesis
2. WHEN multiple unbalanced parentheses exist in a logical line, THE Parser SHALL emit separate diagnostics for each unmatched parenthesis

### Requirement 3: Other Bracket Types

**User Story:** As a Stata developer, I want consistent balance tracking for all bracket types across continuations, so that square brackets and curly braces also work correctly.

#### Acceptance Criteria

1. WHEN square brackets `[]` span across line continuations, THE Parser SHALL track their balance across the entire logical line
2. WHEN curly braces `{}` span across line continuations, THE Parser SHALL track their balance across the entire logical line
3. WHEN mixed bracket types span continuations, THE Parser SHALL track each type independently and report type-specific diagnostics for mismatches
