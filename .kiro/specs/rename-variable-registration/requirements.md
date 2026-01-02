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

This feature adds support for the Stata `rename` command to register the new variable name in the LSP's symbol table. When a user writes `rename oldvar newvar`, the LSP should recognize `newvar` as a defined variable, enabling completions, go-to-definition, and suppressing undefined variable warnings for subsequent references to `newvar`.

## Glossary

- **Analyzer**: The semantic analysis component (`src/analyzer/index.ts`) that builds symbol tables from parsed AST
- **SymbolTable**: Data structure containing all defined symbols (variables, macros, programs, etc.)
- **VariableSymbol**: Symbol type representing a Stata variable with name, location, source, and optional type/label
- **CommandNode**: AST node representing a Stata command with name, varlist, options, etc.

## Requirements

### Requirement 1: Register New Variable Name from Rename Command

**User Story:** As a Stata developer, I want the LSP to recognize variables created via `rename oldvar newvar`, so that I get proper completions and no false-positive undefined variable warnings.

#### Acceptance Criteria

1. WHEN the Analyzer processes a `rename` command with two variable names, THE Analyzer SHALL register the second variable name in the symbol table as a VariableSymbol
2. WHEN the Analyzer processes a `rename` command with abbreviated form `ren`, THE Analyzer SHALL register the second variable name in the symbol table
3. WHEN the Analyzer registers a variable from `rename`, THE VariableSymbol SHALL have source set to `'rename'`
4. WHEN the Analyzer registers a variable from `rename`, THE VariableSymbol SHALL have its location range set to the range of the new variable name token
5. WHEN the `rename` command has fewer than two variable names in the varlist, THE Analyzer SHALL not register any variable (graceful handling of incomplete commands)

### Requirement 2: Support Rename Group Syntax

**User Story:** As a Stata developer using rename groups like `rename (old1 old2) (new1 new2)`, I want the LSP to recognize all new variable names.

#### Acceptance Criteria

1. WHEN the Analyzer processes a `rename` command with grouped syntax `(old1 old2) (new1 new2)`, THE Analyzer SHALL register all new variable names from the second group
2. WHEN the Analyzer processes a `rename` command with wildcard patterns like `rename * , lower`, THE Analyzer SHALL not register any variables (pattern-based renames cannot be statically resolved)
3. WHEN the Analyzer processes a `rename` command with stub patterns like `rename old* new*`, THE Analyzer SHALL not register any variables (pattern-based renames cannot be statically resolved)

### Requirement 3: Type System Update

**User Story:** As a maintainer, I want the VariableSymbol source type to include 'rename' so the type system accurately reflects all variable creation sources.

#### Acceptance Criteria

1. THE VariableSymbol interface SHALL include `'rename'` as a valid value in the `source` union type
