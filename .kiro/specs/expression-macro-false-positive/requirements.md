# Requirements Document

## Introduction

This document specifies requirements for fixing a false positive diagnostic where Stata expression evaluation macro syntax like `` `=uchar(65533)' `` is incorrectly flagged as "Invalid character in macro name". In Stata, the `` `=expr' `` syntax evaluates an expression and substitutes the result as a string. This is valid Stata syntax that should not produce errors.

## Glossary

- **Local_Macro_Reference**: A Stata local macro reference using backtick-apostrophe syntax: `` `name' ``
- **Expression_Evaluation_Macro**: A Stata macro reference that evaluates an expression using `` `=expr' `` syntax, where `expr` is any valid Stata expression
- **Invalid_Macro_Char_Diagnostic**: The diagnostic that reports "Invalid character in macro name" when non-identifier characters are found in a macro reference
- **Analyzer**: The semantic analysis component that validates macro references and produces diagnostics
- **Macro_Identifier_Char**: Valid characters for macro names: letters (`A-Za-z`), digits (`0-9`), and underscore (`_`)

## Requirements

### Requirement 1: Recognize Expression Evaluation Macro Syntax

**User Story:** As a Stata developer, I want the LSP to recognize `` `=expr' `` syntax as valid expression evaluation, so that I don't receive false positive diagnostics when using this common Stata pattern.

#### Acceptance Criteria

1. WHEN the Analyzer encounters a local macro reference token starting with `=`, THE Analyzer SHALL recognize it as an expression evaluation macro
2. WHEN the Analyzer recognizes an expression evaluation macro, THE Analyzer SHALL NOT produce an "Invalid character in macro name" diagnostic
3. WHEN the Analyzer encounters `` `=uchar(65533)' ``, THE Analyzer SHALL NOT produce any diagnostic
4. WHEN the Analyzer encounters `` `=1+2' ``, THE Analyzer SHALL NOT produce any diagnostic
5. WHEN the Analyzer encounters `` `=string(varname)' ``, THE Analyzer SHALL NOT produce any diagnostic

### Requirement 2: Preserve Invalid Character Detection for True Macros

**User Story:** As a Stata developer, I want the LSP to continue detecting genuinely invalid macro names, so that I can catch typos and syntax errors.

#### Acceptance Criteria

1. WHEN the Analyzer encounters a local macro reference with invalid characters that is NOT an expression evaluation macro, THE Analyzer SHALL produce an "Invalid character in macro name" diagnostic
2. WHEN the Analyzer encounters a local macro reference like `` `foo.bar' ``, THE Analyzer SHALL produce an "Invalid character in macro name" diagnostic
3. WHEN the Analyzer encounters a local macro reference like `` `my var' ``, THE Analyzer SHALL produce an "Invalid character in macro name" diagnostic

### Requirement 3: Handle Complex Expression Evaluation Patterns

**User Story:** As a Stata developer, I want the LSP to handle complex expression evaluation patterns including nested macros and function calls, so that all valid Stata code is accepted.

#### Acceptance Criteria

1. WHEN the Analyzer encounters an expression evaluation macro containing nested local macros like `` `=`varname'' ``, THE Analyzer SHALL NOT produce an "Invalid character in macro name" diagnostic
2. WHEN the Analyzer encounters an expression evaluation macro with function calls like `` `=substr("`str'", 1, 5)' ``, THE Analyzer SHALL NOT produce an "Invalid character in macro name" diagnostic
3. WHEN the Analyzer encounters an expression evaluation macro with operators like `` `=`a' + `b'' ``, THE Analyzer SHALL NOT produce an "Invalid character in macro name" diagnostic
4. WHEN the Analyzer encounters an expression evaluation macro with matrix subscripts like `` `=r(table)[1,1]' ``, THE Analyzer SHALL NOT produce an "Invalid character in macro name" diagnostic
