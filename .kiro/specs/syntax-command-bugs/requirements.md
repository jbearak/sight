---
Last Updated: 2025-01-01
Change History:
  - 2025-01-01: Added standardized change tracking headers
Dependencies:
  - stata-lsp: [Core dependency]
  - syntax-command-parsing: [Core dependency]
Status: Active
Related Specs:
  - forward-scope-resolution: [Related cross-file spec]
  - cross-file-awareness: [Related cross-file spec]
  - working-directory-inheritance: [Related cross-file spec]
---

# Requirements Document

## Introduction

This document specifies requirements for fixing two related bugs in the Stata LSP's handling of the `syntax` command:

1. When `syntax` is preceded by a prefix command (e.g., `qui syntax`), it is incorrectly parsed as a regular command, causing the `[if]` argument specifier to be misinterpreted as an if-statement control flow construct.

2. The `[weight]` argument type in syntax commands is not recognized, causing false "undefined local macro" warnings for `weight` and `exp` macros that Stata automatically creates.

## Glossary

- **Syntax_Command**: The `syntax` statement inside a program that declares its interface, specifying what arguments and options the program accepts
- **Prefix_Command**: Commands like `quietly`, `capture`, `noisily` that modify the behavior of the following command
- **Weight_Argument**: A special syntax argument type `[weight]` that creates two implicit local macros: `weight` (the weight type) and `exp` (the weight expression)
- **Implicit_Local**: Local macros automatically created by the `syntax` command (e.g., `varlist`, `if`, `in`, `weight`, `exp`)
- **Parser**: The component that builds an AST from tokens
- **Analyzer**: The semantic analysis component that builds symbol tables and detects undefined references

## Requirements

### Requirement 1: Parse Syntax Command After Prefix Commands

**User Story:** As a Stata developer, I want the LSP to correctly parse `syntax` commands that follow prefix commands like `quietly`, so that I don't get false parse errors and the program signature is correctly extracted.

#### Acceptance Criteria

1. WHEN a `syntax` command follows a prefix command (e.g., `qui syntax anything [if] [in]`), THE Parser SHALL parse it as a SyntaxNode, not as a CommandNode.
2. WHEN parsing a prefixed syntax command, THE Parser SHALL correctly identify argument specifiers like `[if]` and `[in]` as syntax arguments, not as control flow statements.
3. WHEN a program contains a prefixed syntax command, THE Parser SHALL NOT emit "Missing end for program definition" errors.
4. WHEN a program contains a prefixed syntax command, THE Parser SHALL correctly extract the program signature including all arguments and options.

### Requirement 2: Recognize Weight Argument Type

**User Story:** As a Stata developer, I want the LSP to recognize `[weight]` and its variants as valid syntax argument types, so that I don't get false "undefined local macro" warnings when using `weight` and `exp` macros.

#### Acceptance Criteria

1. WHEN parsing a `syntax` command containing `[weight]`, THE Parser SHALL recognize it as a valid argument type.
2. WHEN a `syntax` command includes `[weight]`, THE Analyzer SHALL register both `weight` and `exp` as implicit local macros in the program scope.
3. THE Analyzer SHALL NOT report "Undefined local macro" diagnostics for references to `weight` within the program body after the `syntax` command.
4. THE Analyzer SHALL NOT report "Undefined local macro" diagnostics for references to `exp` within the program body after the `syntax` command.
5. WHEN parsing specific weight type variants, THE Parser SHALL recognize all of the following forms and their abbreviations:
   - `[fweight]` or `[fw]` - frequency weights
   - `[aweight]` or `[aw]` - analytic weights  
   - `[pweight]` or `[pw]` - probability/sampling weights
   - `[iweight]` or `[iw]` - importance weights
6. WHEN a specific weight type variant is used (e.g., `[pw]`), THE Analyzer SHALL still register `weight` and `exp` as implicit local macros (Stata uses the same macro names regardless of weight type).
7. THE Parser SHALL recognize weight arguments in both required and optional positions.

### Requirement 3: Preserve Existing Functionality

**User Story:** As a Stata developer, I want the LSP to continue working correctly for syntax commands without prefixes and without weight arguments.

#### Acceptance Criteria

1. WHEN parsing a `syntax` command without a prefix, THE Parser SHALL continue to parse it correctly as a SyntaxNode.
2. WHEN parsing a `syntax` command without `[weight]`, THE Parser SHALL continue to recognize all existing argument types (`varlist`, `varname`, `newvarname`, `anything`, `if`, `in`, `using`, `name`, `namelist`, `exp`).
3. THE Parser SHALL continue to correctly parse syntax options after the comma.
