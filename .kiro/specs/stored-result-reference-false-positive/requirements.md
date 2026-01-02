# Requirements Document

## Introduction

This document specifies requirements for fixing a false positive diagnostic where Stata stored result references like `` `r(values)' `` are incorrectly flagged as "Invalid character in macro name". In Stata, stored result functions (`r()`, `e()`, `c()`, `s()`) can be wrapped in backtick-apostrophe syntax for string interpolation, and this is valid Stata syntax that should not produce errors.

## Glossary

- **Stored_Result_Reference**: A Stata expression that accesses stored results from commands, using the pattern `r(name)`, `e(name)`, `c(name)`, or `s(name)` where `name` is the result identifier
- **Local_Macro_Reference**: A Stata local macro reference using backtick-apostrophe syntax: `` `name' ``
- **Stored_Result_Function**: One of the four Stata functions that return stored results: `r()` (return values), `e()` (estimation results), `c()` (system constants), `s()` (string scalars)
- **Invalid_Macro_Char_Diagnostic**: The diagnostic that reports "Invalid character in macro name" when non-identifier characters are found in a macro reference
- **Analyzer**: The semantic analysis component that validates macro references and produces diagnostics

## Requirements

### Requirement 1: Recognize Stored Result References

**User Story:** As a Stata developer, I want the LSP to recognize stored result references wrapped in backtick-apostrophe syntax, so that I don't receive false positive errors for valid Stata code.

#### Acceptance Criteria

1. WHEN the Analyzer encounters a local macro reference token with content matching the pattern `r(identifier)`, THE Analyzer SHALL recognize it as a stored result reference
2. WHEN the Analyzer encounters a local macro reference token with content matching the pattern `e(identifier)`, THE Analyzer SHALL recognize it as a stored result reference
3. WHEN the Analyzer encounters a local macro reference token with content matching the pattern `c(identifier)`, THE Analyzer SHALL recognize it as a stored result reference
4. WHEN the Analyzer encounters a local macro reference token with content matching the pattern `s(identifier)`, THE Analyzer SHALL recognize it as a stored result reference
5. WHEN the Analyzer recognizes a stored result reference, THE Analyzer SHALL NOT produce an "Invalid character in macro name" diagnostic

### Requirement 2: Preserve Invalid Character Detection for True Macros

**User Story:** As a Stata developer, I want the LSP to continue detecting invalid characters in actual macro names, so that I catch typos and syntax errors.

#### Acceptance Criteria

1. WHEN the Analyzer encounters a local macro reference with invalid characters that is NOT a stored result reference, THE Analyzer SHALL produce an "Invalid character in macro name" diagnostic
2. WHEN the Analyzer encounters a local macro reference like `` `foo.bar' ``, THE Analyzer SHALL produce an "Invalid character in macro name" diagnostic
3. WHEN the Analyzer encounters a local macro reference like `` `my var' ``, THE Analyzer SHALL produce an "Invalid character in macro name" diagnostic

### Requirement 3: Handle Nested Stored Result References

**User Story:** As a Stata developer, I want the LSP to handle stored result references that contain macro expansions, so that dynamic stored result access works correctly.

#### Acceptance Criteria

1. WHEN the Analyzer encounters a stored result reference containing a nested macro like `` `r(`varname')' ``, THE Analyzer SHALL NOT produce an "Invalid character in macro name" diagnostic
2. WHEN the Analyzer encounters a stored result reference with a complex identifier like `` `r(mean_`i')' ``, THE Analyzer SHALL NOT produce an "Invalid character in macro name" diagnostic

### Requirement 4: Support Stored Result Subscripts

**User Story:** As a Stata developer, I want the LSP to recognize stored result matrix subscripts, so that matrix element access doesn't produce false positives.

#### Acceptance Criteria

1. WHEN the Analyzer encounters a stored result reference with matrix subscripts like `` `r(table)[1,1]' ``, THE Analyzer SHALL NOT produce an "Invalid character in macro name" diagnostic
2. WHEN the Analyzer encounters a stored result reference with variable subscripts like `` `e(b)[1,`i']' ``, THE Analyzer SHALL NOT produce an "Invalid character in macro name" diagnostic
