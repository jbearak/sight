# Requirements Document

## Introduction

This feature adds diagnostic detection for malformed operator sequences in Stata code. The LSP should detect suspicious adjacent operator pairs and emit diagnostics. There are two categories:

1. **Spaced compound operators**: When the lexer tokenizes operators like `<` and `=` as separate tokens due to intervening whitespace, the LSP should suggest the intended compound operator (e.g., `< =` → `<=`, `> =` → `>=`, `! =` → `!=`, `~ =` → `~=`, `= =` → `==`).

2. **Invalid operator combinations**: Sequences that have no valid meaning in Stata, including:
   - Comparison + logical: `< |`, `< &`, `> |`, `> &`
   - Logical + comparison: `| <`, `| >`, `& <`, `& >`
   - Logical/C-style assignment: `| =`
   - Double logical: `| &`, `& |`
   - Double comparison: `< <`, `> >`, `< >`, `> <`
   - C-style logical (context-dependent): `| |`, `& &`

Note: Sequences starting with `=` followed by a comparison or logical operator (e.g., `= <`, `= >`, `= |`, `= &`) are intentionally excluded. These can occur in valid Stata code where an assignment is followed by an expression beginning with a unary or comparison operator.

**Important context distinction for C-style logical operators (`&&` and `||`):**
- In `if` or `else if` control flow statement contexts (e.g., `if condition { ... }`), `&&` and `||` work synonymously with `&` and `|`. In these contexts, they should NOT emit error diagnostics — only optional informational messages about stylistic preference.
- In `if` qualifier contexts (e.g., `gen x = 1 if a == 1 && b == 1`), `&&` and `||` are NOT valid and should emit error diagnostics.

## Prerequisites

**Lexer change required**: The current lexer does not produce `~=` as a compound token — the `case '~':` branch returns a single-character OPERATOR with no lookahead for `=`. Before implementing the analyzer, the lexer must be updated to recognize `~=` as a compound operator token (matching the existing behavior for `!=`, `<=`, `>=`, `==`). Without this change, `~=` written without spaces would produce two adjacent OPERATOR tokens and be incorrectly flagged as a suggestible sequence.

## Glossary

- **Operator_Sequence_Analyzer**: The component that inspects adjacent operator tokens to detect malformed sequences. Follows the `IndentationDiagnosticAnalyzer` pattern as a separate analyzer class invoked by `DiagnosticsProvider`. The `DiagnosticsProvider` filters operator diagnostics through the existing embedded-context check, consistent with how indentation diagnostics are handled.
- **Adjacent_Operator_Tokens**: Two OPERATOR tokens with no intervening non-trivia tokens. Trivia includes WHITESPACE and CONTINUATION (`///`) tokens between them. Tokens separated by a STATEMENT_TERMINATOR (newline in CR mode, `;` in semicolon mode) are NOT considered adjacent. COMMENT_LINE and COMMENT_BLOCK tokens between operators also break adjacency (they are not trivia for this purpose).
- **Malformed_Operator_Sequence**: Two Adjacent_Operator_Tokens that form a suspicious or invalid combination
- **Suggestible_Sequence**: A malformed operator sequence where the intended compound operator can be inferred (e.g., `< =` → `<=`, `! =` → `!=`, `~ =` → `~=`, `= =` → `==`)
- **Invalid_Sequence**: A malformed operator sequence that has no valid Stata interpretation (e.g., `< |`, `> &`, `& |`, `< <`). Note: `| |` and `& &` are only invalid in certain contexts — see Context_Dependent_Sequence.
- **Context_Dependent_Sequence**: A malformed operator sequence whose validity depends on the syntactic context. Specifically, `| |` and `& &` are valid (though stylistically discouraged) in `if`/`else if` control flow statement conditions, but invalid in `if` qualifier expressions.
- **If_Control_Flow_Context**: The condition expression within an `if` or `else if` control flow statement (e.g., `if condition { ... }` or `else if condition { ... }`). In this context, `&&` and `||` work synonymously with `&` and `|`.
- **If_Qualifier_Context**: The condition expression within an `if` qualifier on a command (e.g., `gen x = 1 if condition`). In this context, `&&` and `||` are NOT valid Stata syntax.
- **Operator_Token**: A token of type OPERATOR produced by the lexer. Note: operators inside string literals are tokenized as STRING tokens, and operators inside comments are tokenized as COMMENT tokens — the lexer already prevents false positives from these contexts.

## Requirements

### Requirement 1: Detect Spaced Compound Operators with Suggestions

**User Story:** As a Stata developer, I want the LSP to detect when I accidentally write a compound operator with a space (e.g., `< =`, `! =`, `~ =`, `= =`), so that I can fix the typo to use the intended operator.

#### Acceptance Criteria

1. WHEN two Adjacent_Operator_Tokens form the sequence `<` followed by `=`, THE Operator_Sequence_Analyzer SHALL emit a diagnostic on the span covering both tokens
2. WHEN two Adjacent_Operator_Tokens form the sequence `>` followed by `=`, THE Operator_Sequence_Analyzer SHALL emit a diagnostic on the span covering both tokens
3. WHEN two Adjacent_Operator_Tokens form the sequence `!` followed by `=`, THE Operator_Sequence_Analyzer SHALL emit a diagnostic on the span covering both tokens
4. WHEN two Adjacent_Operator_Tokens form the sequence `~` followed by `=`, THE Operator_Sequence_Analyzer SHALL emit a diagnostic on the span covering both tokens
5. WHEN two Adjacent_Operator_Tokens form the sequence `=` followed by `=`, THE Operator_Sequence_Analyzer SHALL emit a diagnostic on the span covering both tokens
6. WHEN a Suggestible_Sequence is detected, THE Operator_Sequence_Analyzer SHALL include a suggestion in the diagnostic message indicating the likely intended operator

Note: Code actions (quick fixes) for suggestible sequences are deferred to a future iteration. This feature provides diagnostics with helpful explanations only.

### Requirement 2: Detect Invalid Operator Sequences

**User Story:** As a Stata developer, I want the LSP to flag invalid operator combinations like `< |` or `> &`, so that I can identify and fix syntax errors before running my code.

#### Acceptance Criteria

1. WHEN two Adjacent_Operator_Tokens form a comparison + logical sequence (`< |`, `< &`, `> |`, `> &`), THE Operator_Sequence_Analyzer SHALL emit a diagnostic error
2. WHEN two Adjacent_Operator_Tokens form a logical + comparison sequence (`| <`, `| >`, `& <`, `& >`), THE Operator_Sequence_Analyzer SHALL emit a diagnostic error
3. WHEN two Adjacent_Operator_Tokens form the sequence `|` followed by `=`, THE Operator_Sequence_Analyzer SHALL emit a diagnostic error with a message noting that Stata does not support compound assignment operators like `|=`
4. WHEN two Adjacent_Operator_Tokens form a double logical sequence (`| &`, `& |`), THE Operator_Sequence_Analyzer SHALL emit a diagnostic error
5. WHEN two Adjacent_Operator_Tokens form a double comparison sequence (`< <`, `> >`, `< >`, `> <`), THE Operator_Sequence_Analyzer SHALL emit a diagnostic error
6. WHEN two Adjacent_Operator_Tokens form a C-style logical operator (`| |`, `& &`) in an If_Qualifier_Context, THE Operator_Sequence_Analyzer SHALL emit a diagnostic error with a message noting that Stata uses single `|` and `&` for logical operations in this context
7. WHEN an Invalid_Sequence is detected (other than C-style logical or `| =`), THE Operator_Sequence_Analyzer SHALL emit a diagnostic message stating that the operator combination is not valid in Stata

### Requirement 2a: Context-Aware C-Style Logical Operator Handling

**User Story:** As a Stata developer, I want the LSP to correctly distinguish between contexts where `&&` and `||` are valid (if/else if control flow statements) versus invalid (if qualifiers), so that I receive accurate diagnostics.

#### Acceptance Criteria

1. WHEN two Adjacent_Operator_Tokens form a C-style logical operator (`| |`, `& &`) in an If_Control_Flow_Context, THE Operator_Sequence_Analyzer SHALL NOT emit an error diagnostic
2. WHEN two Adjacent_Operator_Tokens form a C-style logical operator (`| |`, `& &`) in an If_Control_Flow_Context AND the `cStyleLogicalInControlFlow` config is NOT `'off'`, THE Operator_Sequence_Analyzer SHALL emit an informational diagnostic suggesting the use of single `|` or `&` for consistency
3. WHEN the `cStyleLogicalInControlFlow` config is set to `'off'`, THE Operator_Sequence_Analyzer SHALL NOT emit any diagnostic for C-style logical operators in If_Control_Flow_Context
4. THE default value for `cStyleLogicalInControlFlow` SHALL be `'information'`

### Requirement 3: Scope Detection to Stata Context Only

**User Story:** As a Stata developer, I want malformed operator detection to apply only within Stata code, so that embedded Mata or Python blocks are not incorrectly flagged.

#### Acceptance Criteria

1. WHILE an operator token's position is within a Mata embedded block, THE Operator_Sequence_Analyzer SHALL NOT emit malformed operator diagnostics
2. WHILE an operator token's position is within a Python embedded block, THE Operator_Sequence_Analyzer SHALL NOT emit malformed operator diagnostics

Note: The lexer already ensures that operators inside string literals are tokenized as STRING tokens, and operators inside comments are tokenized as COMMENT tokens (not OPERATOR tokens). Therefore, string and comment contexts are excluded by the token type system and require no additional filtering by the analyzer.

### Requirement 4: Avoid False Positives for Valid Operator Adjacency

**User Story:** As a Stata developer, I want the LSP to correctly distinguish malformed sequences from valid adjacent operators, so that I do not receive spurious warnings.

#### Acceptance Criteria

1. WHEN two operators are separated by a non-operator token (e.g., an identifier or number), THE Operator_Sequence_Analyzer SHALL NOT emit a diagnostic
2. WHEN a valid compound operator (`<=`, `>=`, `==`, `!=`, `~=`) is written without spaces, THE Operator_Sequence_Analyzer SHALL NOT emit a diagnostic (these are single tokens produced by the lexer; see Prerequisites for `~=`)
3. WHEN a comparison operator (`<` or `>`) appears adjacent to an arithmetic operator (`+`, `-`, `*`, `/`, `^`) in either order (e.g., `< +`, `+ <`, `> *`, `^ >`), THE Operator_Sequence_Analyzer SHALL NOT emit a diagnostic
4. WHEN the negation operator `!` or `~` appears before a comparison operator (`<` or `>`), THE Operator_Sequence_Analyzer SHALL NOT emit a diagnostic

Note: ACs 3-4 ensure that valid expressions like `x > -1`, `x < +1`, and `!x > 0` are not flagged, since the arithmetic and negation operators adjacent to comparisons are valid Stata syntax.

### Requirement 5: Diagnostic Presentation and Severity

**User Story:** As a Stata developer, I want clear, actionable diagnostic messages for malformed operators, so that I can quickly understand and fix the issue.

#### Acceptance Criteria

1. WHEN a Suggestible_Sequence is detected, THE Operator_Sequence_Analyzer SHALL set the diagnostic severity to Warning (unless overridden by the `malformedOperator` config in Requirement 8)
2. WHEN an Invalid_Sequence is detected, THE Operator_Sequence_Analyzer SHALL set the diagnostic severity to Error (unless overridden by the `invalidOperatorSequence` config in Requirement 8)
3. WHEN a diagnostic is emitted, THE Operator_Sequence_Analyzer SHALL highlight the span from the start of the first operator token to the end of the second operator token
4. WHEN a Suggestible_Sequence `< =` is detected, THE diagnostic message SHALL read: "Malformed operator '< ='. Did you mean '<='?"
5. WHEN a Suggestible_Sequence `> =` is detected, THE diagnostic message SHALL read: "Malformed operator '> ='. Did you mean '>='?"
6. WHEN a Suggestible_Sequence `! =` is detected, THE diagnostic message SHALL read: "Malformed operator '! ='. Did you mean '!='?"
7. WHEN a Suggestible_Sequence `~ =` is detected, THE diagnostic message SHALL read: "Malformed operator '~ ='. Did you mean '~='?"
8. WHEN a Suggestible_Sequence `= =` is detected, THE diagnostic message SHALL read: "Malformed operator '= ='. Did you mean '=='?"
9. WHEN an Invalid_Sequence is detected (general case), THE diagnostic message SHALL include the specific operator combination found (e.g., "Invalid operator sequence '< |'. This operator combination is not valid in Stata")
10. WHEN a C-style logical operator `| |` is detected in If_Qualifier_Context, THE diagnostic message SHALL read: "Invalid operator sequence '| |'. Stata uses '|' for logical OR, not '||'"
11. WHEN a C-style logical operator `& &` is detected in If_Qualifier_Context, THE diagnostic message SHALL read: "Invalid operator sequence '& &'. Stata uses '&' for logical AND, not '&&'"
12. WHEN the sequence `| =` is detected, THE diagnostic message SHALL read: "Invalid operator sequence '| ='. Stata does not support compound assignment operators"
13. WHEN a C-style logical operator `| |` is detected in If_Control_Flow_Context (and config is not 'off'), THE diagnostic message SHALL read: "C-style '||' operator in if condition. Consider using '|' for consistency with Stata style"
14. WHEN a C-style logical operator `& &` is detected in If_Control_Flow_Context (and config is not 'off'), THE diagnostic message SHALL read: "C-style '&&' operator in if condition. Consider using '&' for consistency with Stata style"

### Requirement 6: Support Multi-line and Continuation Contexts

**User Story:** As a Stata developer, I want malformed operator detection to work across line continuations, so that errors spanning multiple lines are still caught.

#### Acceptance Criteria

1. WHEN a malformed operator sequence spans a `///` continuation (e.g., `<` on one line and `=` on the next), THE Operator_Sequence_Analyzer SHALL still detect and report the malformed sequence
2. WHEN operators are separated by a statement terminator (newline in CR mode or `;` in semicolon mode), THE Operator_Sequence_Analyzer SHALL NOT flag them as a malformed sequence, since they belong to different statements

### Requirement 7: Respect Suppression Directives

**User Story:** As a Stata developer, I want to be able to suppress malformed operator diagnostics using existing `@lsp-ignore` directives, so that I can override false positives in unusual code patterns.

#### Acceptance Criteria

1. WHEN a malformed operator sequence appears on a line annotated with `@lsp-ignore` in any comment style (`//`, `*`, or `/* */`), THE Operator_Sequence_Analyzer SHALL NOT emit a diagnostic for that sequence
2. WHEN a malformed operator sequence appears on a line targeted by `@lsp-ignore-next` in a preceding comment (in any comment style), THE Operator_Sequence_Analyzer SHALL NOT emit a diagnostic for that sequence. The directive targets the next non-trivia token's line — blank lines between the directive and the operator pair do not break suppression.

### Requirement 8: Configuration

**User Story:** As a Stata developer, I want to configure the severity of malformed operator diagnostics or disable them entirely, so that I can tailor the LSP to my workflow.

#### Acceptance Criteria

1. THE `StataLSPConfig.diagnostics.severity` SHALL include a `malformedOperator` field with allowed values `'error' | 'warning' | 'information' | 'hint' | 'off'`, controlling the severity of Suggestible_Sequence diagnostics
2. THE `StataLSPConfig.diagnostics.severity` SHALL include an `invalidOperatorSequence` field with allowed values `'error' | 'warning' | 'information' | 'hint' | 'off'`, controlling the severity of Invalid_Sequence diagnostics
3. WHEN `malformedOperator` is set to `'off'`, THE Operator_Sequence_Analyzer SHALL NOT emit Suggestible_Sequence diagnostics
4. WHEN `invalidOperatorSequence` is set to `'off'`, THE Operator_Sequence_Analyzer SHALL NOT emit Invalid_Sequence diagnostics
5. WHEN either field is set to a severity value other than `'off'`, THE Operator_Sequence_Analyzer SHALL use that severity (overriding the defaults in Requirement 5 ACs 1-2)
6. THE default value for `malformedOperator` SHALL be `'warning'`
7. THE default value for `invalidOperatorSequence` SHALL be `'error'`
8. THE `StataLSPConfig.diagnostics.severity` SHALL include a `cStyleLogicalInControlFlow` field with allowed values `'error' | 'warning' | 'information' | 'hint' | 'off'`, controlling the severity of C-style logical operator diagnostics (`&&`, `||`) in If_Control_Flow_Context
9. THE default value for `cStyleLogicalInControlFlow` SHALL be `'information'`
10. WHEN `cStyleLogicalInControlFlow` is set to `'off'`, THE Operator_Sequence_Analyzer SHALL NOT emit any diagnostic for C-style logical operators in If_Control_Flow_Context

### Requirement 9: Diagnostic Codes

**User Story:** As a tool author, I want malformed operator diagnostics to have unique diagnostic codes, so that they can be programmatically identified and filtered.

#### Acceptance Criteria

1. THE `StataDiagnosticCode` enum SHALL include codes in the 6xxx range for malformed operator diagnostics
2. Suggestible_Sequence diagnostics SHALL use code `MALFORMED_OPERATOR = 6001`
3. Invalid_Sequence diagnostics SHALL use code `INVALID_OPERATOR_SEQUENCE = 6002`
4. Context_Dependent_Sequence diagnostics (C-style logical in If_Control_Flow_Context) SHALL use code `CSTYLE_LOGICAL_IN_CONTROL_FLOW = 6003`
