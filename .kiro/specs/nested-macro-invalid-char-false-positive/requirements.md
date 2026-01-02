# Requirements Document

## Introduction

This document specifies requirements for fixing a false positive diagnostic where nested Stata macro references like `` `one`two'' `` are incorrectly flagged as "Invalid character in macro name". In Stata, macros can be nested to arbitrary depths using balanced backtick-apostrophe pairs, and this is valid Stata syntax that should not produce errors.

## Glossary

- **Local_Macro_Reference**: A Stata local macro reference using backtick-apostrophe syntax: `` `name' ``
- **Nested_Macro_Reference**: A local macro reference containing one or more inner macro references, e.g., `` `one`two'' `` where `two` is resolved first, then concatenated with `one` to form the outer macro name
- **Global_Macro_Reference**: A Stata global macro reference using `$name` or `${name}` syntax
- **Nested_Global_Macro**: A global macro reference containing inner macro references, e.g., `${one${two}}` or `${one`two'}`
- **Invalid_Macro_Char_Diagnostic**: The diagnostic that reports "Invalid character in macro name" when non-identifier characters are found in a macro reference
- **Analyzer**: The semantic analysis component that validates macro references and produces diagnostics
- **Macro_Identifier_Char**: Valid characters for macro names: letters (`A-Za-z`), digits (`0-9`), and underscore (`_`)

## Requirements

### Requirement 1: Recognize Nested Local Macro References

**User Story:** As a Stata developer, I want the LSP to recognize nested local macro references as valid syntax, so that I don't receive false positive diagnostics when using macro nesting.

#### Acceptance Criteria

1. WHEN the Analyzer encounters a local macro reference token containing inner backtick-apostrophe pairs like `` `one`two'' ``, THE Analyzer SHALL recognize it as a nested macro reference
2. WHEN the Analyzer encounters a deeply nested local macro reference like `` `one`two`three''' ``, THE Analyzer SHALL recognize it as a nested macro reference
3. WHEN the Analyzer encounters a local macro reference with multiple levels of nesting like `` `one`two`three`four`five`six'''''' ``, THE Analyzer SHALL recognize it as a nested macro reference
4. WHEN the Analyzer recognizes a nested local macro reference, THE Analyzer SHALL NOT produce an "Invalid character in macro name" diagnostic

### Requirement 2: Recognize Nested Global Macro References

**User Story:** As a Stata developer, I want the LSP to recognize nested global macro references as valid syntax, so that I don't receive false positive diagnostics when using macro nesting in globals.

#### Acceptance Criteria

1. WHEN the Analyzer encounters a braced global macro reference containing inner braced globals like `${one${two}}`, THE Analyzer SHALL recognize it as a nested macro reference
2. WHEN the Analyzer encounters a braced global macro reference containing a local macro like `${one`two'}`, THE Analyzer SHALL recognize it as a nested macro reference
3. WHEN the Analyzer encounters a braced global macro reference with mixed nesting like `${one`two'$three}`, THE Analyzer SHALL recognize it as a nested macro reference
4. WHEN the Analyzer recognizes a nested global macro reference, THE Analyzer SHALL NOT produce an "Invalid character in macro name" diagnostic

### Requirement 3: Preserve Invalid Character Detection for Non-Nested Macros

**User Story:** As a Stata developer, I want the LSP to continue detecting genuinely invalid macro names, so that I receive helpful diagnostics for actual errors.

#### Acceptance Criteria

1. WHEN the Analyzer encounters a local macro reference with invalid characters that is NOT a nested macro reference, THE Analyzer SHALL produce an "Invalid character in macro name" diagnostic
2. WHEN the Analyzer encounters a local macro reference like `` `foo.bar' ``, THE Analyzer SHALL produce an "Invalid character in macro name" diagnostic
3. WHEN the Analyzer encounters a local macro reference like `` `my var' ``, THE Analyzer SHALL produce an "Invalid character in macro name" diagnostic
4. WHEN the Analyzer encounters a braced global macro reference like `${foo.bar}`, THE Analyzer SHALL produce an "Invalid character in macro name" diagnostic
5. WHEN the Analyzer encounters a braced global macro reference like `${my var}`, THE Analyzer SHALL produce an "Invalid character in macro name" diagnostic

### Requirement 4: Lexer Brace-Depth Tracking for Nested Global Macros

**User Story:** As a Stata developer, I want the lexer to correctly tokenize nested braced global macros like `${one${two}}`, so that the entire expression is captured as a single token.

#### Acceptance Criteria

1. WHEN the Lexer encounters a braced global macro reference containing nested braced globals like `${one${two}}`, THE Lexer SHALL track brace depth and consume all characters until the outermost closing brace
2. WHEN the Lexer encounters a braced global macro reference containing nested local macros like `${one`two'}`, THE Lexer SHALL track both brace depth and backtick/apostrophe nesting
3. WHEN the Lexer encounters a deeply nested braced global macro like `${a${b${c}}}`, THE Lexer SHALL correctly consume all nested braces and return a single MACRO_REF_GLOBAL token
4. WHEN the Lexer tokenizes `${one${two}}`, THE Lexer SHALL NOT leave any orphan `}` characters in the token stream

### Requirement 5: Defer to Lexer for Unbalanced Nesting

**User Story:** As a Stata developer, I want the LSP to properly handle malformed nested macros, so that I receive appropriate diagnostics for syntax errors.

#### Acceptance Criteria

1. WHEN the Lexer encounters a local macro reference with unbalanced backticks/apostrophes like `` `one`two' `` (missing closing apostrophe), THE Lexer SHALL emit an "Incomplete macro expression" error
2. WHEN the Analyzer receives a token from an unbalanced macro expression, THE Analyzer SHALL NOT produce an additional "Invalid character in macro name" diagnostic (the lexer error is sufficient)
3. WHEN the Analyzer encounters a braced global macro reference with unbalanced braces, THE Analyzer SHALL defer to the lexer's error handling
