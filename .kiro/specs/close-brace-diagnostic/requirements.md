---
Last Updated: 2025-01-01
Change History:
  - 2025-01-01: Added standardized change tracking headers
Dependencies:
  - stata-lsp: [Core dependency]
Status: Active
Related Specs:
  - forward-scope-resolution: [Related cross-file spec]
  - cross-file-awareness: [Related cross-file spec]
  - working-directory-inheritance: [Related cross-file spec]
---

# Requirements Document

## Introduction

This feature implements diagnostics that detect Stata's brace placement rules. In Stata, braces in block constructs (if/else, foreach, forvalues, while) have strict placement requirements:

1. Opening brace `{` must be on the same line as the condition (at the end), with no code following it
2. Opening brace `{` cannot be alone on its own line
3. Closing brace `}` must be alone on its line, with no code before or after it
4. `else` must appear on its own line, not on the same line as `}`

**Valid Stata code:**
```stata
if (1 == 2) {
    di 3
}
```

**Invalid examples:**

```stata
// Invalid: open brace alone on its line
if (1 == 1)
{
    di 3
}
// Stata reports: "{ required"

// Invalid: code after close brace
if (1 == 2) {
    di 3
} else {
    di 4
}
// Stata reports: "program error: code follows on the same line as close brace"

// Invalid: close brace not alone (code before it)
if (1 == 2) {
    di 3 }
// Stata reports: "program error: matching close brace not found"

// Invalid: code after open brace
if (1 == 2) {di 3}
// Stata reports: "program error: matching close brace not found"

// Problematic: code on same line as open brace (runs but code is silently ignored)
if (1 == 1) { display 3
    di 444
}
// This runs without error, but 'display 3' is NOT executed
```

The LSP currently has error codes defined for these (`BRACE_NOT_ALONE = 3002`, `BRACE_ELSE_SAME_LINE = 3001`) but does not emit the diagnostics.

## Glossary

- **Parser**: The component that builds an AST from tokens and detects structural syntax errors
- **Diagnostic**: An error, warning, or information message reported to the user via the LSP
- **Open_Brace**: The `{` character that starts a block construct
- **Close_Brace**: The `}` character that ends a block construct
- **Block_Construct**: Control flow statements that use braces: if, else, foreach, forvalues, while

## Requirements

### Requirement 1: Detect Code After Close Brace

**User Story:** As a Stata developer, I want the LSP to detect when code follows a closing brace on the same line, so that I can fix this syntax error before running my code.

#### Acceptance Criteria

1. WHEN the Parser encounters a closing brace `}` followed by non-whitespace, non-comment tokens on the same line, THEN the Parser SHALL emit a diagnostic with code `BRACE_NOT_ALONE` (3002)
2. WHEN the Parser encounters a closing brace `}` followed only by whitespace or comments on the same line, THEN the Parser SHALL NOT emit a `BRACE_NOT_ALONE` diagnostic
3. WHEN the Parser encounters a closing brace `}` at the end of a line, THEN the Parser SHALL NOT emit a `BRACE_NOT_ALONE` diagnostic
4. THE diagnostic message SHALL be "code follows on the same line as close brace"

### Requirement 2: Detect Code Before Close Brace

**User Story:** As a Stata developer, I want the LSP to detect when code appears before a closing brace on the same line, so that I can fix this syntax error.

#### Acceptance Criteria

1. WHEN the Parser encounters non-whitespace tokens followed by a closing brace `}` on the same line (where `}` is not at the start of the line), THEN the Parser SHALL emit a diagnostic with code `BRACE_NOT_ALONE` (3002)
2. WHEN the Parser encounters a closing brace `}` at the start of a line (after optional whitespace), THEN the Parser SHALL NOT emit a `BRACE_NOT_ALONE` diagnostic for code-before-brace
3. THE diagnostic message SHALL be "close brace must be alone on its line"

### Requirement 3: Detect Else on Same Line as Close Brace

**User Story:** As a Stata developer, I want the LSP to detect when `else` appears on the same line as a closing brace, so that I can fix this common syntax error.

#### Acceptance Criteria

1. WHEN the Parser encounters `} else` on the same line, THEN the Parser SHALL emit a diagnostic with code `BRACE_ELSE_SAME_LINE` (3001)
2. WHEN the Parser encounters `}` on one line and `else` on the next line, THEN the Parser SHALL NOT emit a `BRACE_ELSE_SAME_LINE` diagnostic
3. THE diagnostic message SHALL be "else must appear on a separate line from close brace"

### Requirement 4: Detect Open Brace Alone on Line

**User Story:** As a Stata developer, I want the LSP to detect when an opening brace appears alone on its own line, so that I can fix this syntax error.

#### Acceptance Criteria

1. WHEN the Parser encounters an opening brace `{` that is alone on its line (not on the same line as the condition), THEN the Parser SHALL emit a diagnostic
2. WHEN the Parser encounters an opening brace `{` on the same line as the condition (e.g., `if (1 == 1) {`), THEN the Parser SHALL NOT emit this diagnostic
3. THE diagnostic message SHALL be "open brace must be on the same line as the condition"

### Requirement 5: Detect Code After Open Brace

**User Story:** As a Stata developer, I want the LSP to detect when code follows an opening brace on the same line, so that I can avoid silent code execution failures.

#### Acceptance Criteria

1. WHEN the Parser encounters an opening brace `{` followed by non-whitespace, non-comment tokens on the same line, THEN the Parser SHALL emit a diagnostic
2. WHEN the Parser encounters an opening brace `{` followed only by whitespace or comments on the same line, THEN the Parser SHALL NOT emit a diagnostic
3. THE diagnostic message SHALL be "code after open brace may be silently ignored"
4. THE diagnostic severity SHALL be Warning (not Error), since Stata runs the code but ignores the content

### Requirement 6: Diagnostic Range Accuracy

**User Story:** As a Stata developer, I want the diagnostic to highlight the exact location of the error, so that I can quickly find and fix it.

#### Acceptance Criteria

1. FOR the `BRACE_NOT_ALONE` diagnostic (code after close brace), THE range SHALL span from the closing brace to the end of the offending code on that line
2. FOR the `BRACE_NOT_ALONE` diagnostic (code before close brace), THE range SHALL span from the start of the offending code to the closing brace
3. FOR the `BRACE_ELSE_SAME_LINE` diagnostic, THE range SHALL span from the closing brace to the `else` keyword
4. FOR the open-brace-alone diagnostic, THE range SHALL highlight the opening brace
5. FOR the code-after-open-brace diagnostic, THE range SHALL span from the opening brace to the end of the offending code on that line
6. THE diagnostic range SHALL NOT extend beyond the current line
