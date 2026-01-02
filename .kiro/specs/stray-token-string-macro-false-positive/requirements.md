# Requirements Document

## Introduction

This document specifies requirements for fixing false positive diagnostics in the stray token detection feature. The current implementation incorrectly flags macro references inside string literals as stray tokens when they appear in if/in qualifier expressions.

## Glossary

- **Parser**: The component that builds an AST from tokens
- **Stray_Token_Detector**: The state machine within the parser that detects unexpected tokens in qualifier expressions
- **String_Literal**: A sequence of characters enclosed in quotes, which may contain embedded macro references
- **Macro_Reference**: A local (`` `name' ``) or global (`$name`) macro reference that gets expanded at runtime
- **Embedded_Macro**: A macro reference that appears inside a string literal

## Requirements

### Requirement 1: String Literal Context Tracking

**User Story:** As a developer, I want the parser to recognize when tokens are part of a string literal, so that embedded macro references are not incorrectly flagged as stray tokens.

#### Acceptance Criteria

1. WHEN the parser encounters a STRING token that is an opening quote, THE Stray_Token_Detector SHALL enter a string context
2. WHEN the parser is in a string context and encounters a MACRO_REF_LOCAL token, THE Stray_Token_Detector SHALL NOT emit a stray token diagnostic
3. WHEN the parser is in a string context and encounters a MACRO_REF_GLOBAL token, THE Stray_Token_Detector SHALL NOT emit a stray token diagnostic
4. WHEN the parser is in a string context and encounters a STRING token that is a closing quote, THE Stray_Token_Detector SHALL exit the string context
5. WHEN the parser encounters a STRING token that contains the full string content (not just a quote), THE Stray_Token_Detector SHALL treat it as a single operand

### Requirement 2: Compound Condition Handling

**User Story:** As a developer, I want compound conditions with string comparisons containing macros to parse without false positives, so that I can write valid Stata code without spurious warnings.

#### Acceptance Criteria

1. WHEN parsing `x == 1 & y == "\`macro'"`, THE Parser SHALL NOT emit any stray token diagnostics
2. WHEN parsing `x == 1 & y == "$macro"`, THE Parser SHALL NOT emit any stray token diagnostics
3. WHEN parsing `x == "\`a'" & y == "\`b'"`, THE Parser SHALL NOT emit any stray token diagnostics
4. WHEN parsing `x == 1 & program == "\`program'" & level == "births"`, THE Parser SHALL NOT emit any stray token diagnostics
5. WHEN parsing compound strings with macros like `x == \`"\`macro'"'`, THE Parser SHALL NOT emit any stray token diagnostics
6. WHEN parsing nested compound strings with macros, THE Parser SHALL NOT emit any stray token diagnostics

### Requirement 3: Preserve Existing Stray Token Detection

**User Story:** As a developer, I want genuine stray tokens to still be detected, so that I receive helpful diagnostics for actual errors.

#### Acceptance Criteria

1. WHEN parsing `x == 1 oops`, THE Parser SHALL emit a stray token diagnostic for `oops`
2. WHEN parsing `x == 1 y == 2` (missing logical operator), THE Parser SHALL emit a stray token diagnostic
3. WHEN parsing `x == . 5` (split literal), THE Parser SHALL emit a split literal diagnostic
