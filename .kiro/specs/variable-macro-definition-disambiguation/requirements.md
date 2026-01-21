# Requirements Document

## Introduction

This document specifies the requirements for fixing a bug in the Stata LSP's go-to-definition feature. Currently, when using cmd-click (go-to-definition) on a variable name in commands like `tab cm_birth` or `gen cm_birth`, the LSP incorrectly jumps to a `local cm_birth` macro definition instead of the variable definition. The fix requires the definition provider to use token type information to disambiguate between variable references and macro references.

## Glossary

- **Definition_Provider**: The LSP component responsible for handling go-to-definition requests and returning the location of symbol definitions.
- **Token**: A lexical unit produced by the lexer, containing type information (e.g., WORD, MACRO_REF_LOCAL, MACRO_REF_GLOBAL).
- **Variable**: A Stata data variable, referenced directly by name (e.g., `tab varname`).
- **Local_Macro**: A Stata local macro, referenced with backtick-quote syntax (e.g., `` `macroname' ``).
- **Global_Macro**: A Stata global macro, referenced with dollar sign syntax (e.g., `$macroname` or `${macroname}`).
- **Extended_Macro_Function**: A macro operation using colon syntax (e.g., `local result : list a | b`) where bare identifiers after the function name are macro references.
- **Symbol_Table**: A data structure storing all defined symbols (variables, macros, programs, etc.) with their locations.

## Requirements

### Requirement 1: Token-Based Symbol Type Detection

**User Story:** As a developer, I want go-to-definition to correctly identify whether I'm clicking on a variable or a macro reference, so that I navigate to the correct definition.

#### Acceptance Criteria

1. WHEN a user invokes go-to-definition on a WORD token in a regular command context, THE Definition_Provider SHALL treat it as a potential variable, program, scalar, or matrix reference (not a macro reference).
2. WHEN a user invokes go-to-definition on a MACRO_REF_LOCAL token, THE Definition_Provider SHALL treat it as a local macro reference.
3. WHEN a user invokes go-to-definition on a MACRO_REF_GLOBAL token, THE Definition_Provider SHALL treat it as a global macro reference.
4. WHEN the token at the cursor position cannot be determined, THE Definition_Provider SHALL fall back to context-based heuristics (checking preceding characters for `` ` `` or `$`).

### Requirement 2: Variable Definition Priority

**User Story:** As a developer, I want go-to-definition on a plain identifier to navigate to the variable definition when both a variable and a macro with the same name exist, so that I can inspect the correct symbol.

#### Acceptance Criteria

1. WHEN a user invokes go-to-definition on a WORD token that matches both a variable name and a local macro name, THE Definition_Provider SHALL return the variable definition.
2. WHEN a user invokes go-to-definition on a WORD token that matches both a variable name and a global macro name, THE Definition_Provider SHALL return the variable definition.
3. WHEN a user invokes go-to-definition on a WORD token that matches only a macro name (no variable), THE Definition_Provider SHALL NOT return the macro definition (macros require explicit syntax).

### Requirement 3: Macro Definition Resolution

**User Story:** As a developer, I want go-to-definition on macro reference syntax to navigate to the macro definition, so that I can inspect macro values.

#### Acceptance Criteria

1. WHEN a user invokes go-to-definition on a MACRO_REF_LOCAL token (`` `name' `` syntax), THE Definition_Provider SHALL return the local macro definition if it exists.
2. WHEN a user invokes go-to-definition on a MACRO_REF_GLOBAL token (`$name` or `${name}` syntax), THE Definition_Provider SHALL return the global macro definition if it exists.
3. IF a macro reference token is used but no matching macro definition exists, THEN THE Definition_Provider SHALL return null.

### Requirement 4: Token Retrieval at Position

**User Story:** As a developer, I want the definition provider to accurately determine the token type at my cursor position, so that symbol resolution is context-aware.

#### Acceptance Criteria

1. THE Definition_Provider SHALL retrieve the token at the cursor position from the document's token list.
2. WHEN the cursor position falls within a token's range, THE Definition_Provider SHALL use that token's type for symbol resolution.
3. WHEN no token contains the cursor position, THE Definition_Provider SHALL fall back to word extraction and context-based heuristics.

### Requirement 5: Extended Macro Function Context

**User Story:** As a developer, I want go-to-definition on bare identifiers in extended macro functions to navigate to the macro definition, so that I can inspect macro values used in list operations.

#### Acceptance Criteria

1. WHEN a user invokes go-to-definition on a WORD token that appears as an argument in an extended macro function (e.g., `local result : list a | b`), THE Definition_Provider SHALL treat it as a local macro reference.
2. WHEN the cursor is on a bare identifier after a list operation keyword (list, word, piece, etc.), THE Definition_Provider SHALL resolve it to the local macro definition if one exists.
3. IF no local macro definition exists for the bare identifier in extended macro context, THEN THE Definition_Provider SHALL return null (not fall back to variable lookup).

### Requirement 6: Backward Compatibility

**User Story:** As a developer, I want existing go-to-definition functionality to continue working for programs, scalars, matrices, and file paths, so that the fix doesn't break other features.

#### Acceptance Criteria

1. WHEN a user invokes go-to-definition on a program name, THE Definition_Provider SHALL continue to return the program definition.
2. WHEN a user invokes go-to-definition on a scalar name, THE Definition_Provider SHALL continue to return the scalar definition.
3. WHEN a user invokes go-to-definition on a matrix name, THE Definition_Provider SHALL continue to return the matrix definition.
4. WHEN a user invokes go-to-definition on a file path in do/run/include commands, THE Definition_Provider SHALL continue to return the file location.
5. WHEN a user invokes go-to-definition in an embedded language context (Mata/Python), THE Definition_Provider SHALL continue to resolve only macros (not programs or variables).
