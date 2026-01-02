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

This feature adds support for the Stata `confirm variable` (and `confirm var`) command to register the variable name in the LSP's symbol table. When a user writes `confirm variable myvar` or `capture confirm var myvar`, the LSP should recognize `myvar` as a defined variable, enabling completions, go-to-definition, and suppressing undefined variable warnings for subsequent references to `myvar`.

The `confirm variable` command is commonly used in Stata to verify that a variable exists before operating on it. When the LSP sees this command, it's a strong signal that the variable is expected to exist in the dataset, making it appropriate to register it as a known variable.

## Glossary

- **Analyzer**: The semantic analysis component (`src/analyzer/index.ts`) that builds symbol tables from parsed AST
- **SymbolTable**: Data structure containing all defined symbols (variables, macros, programs, etc.)
- **VariableSymbol**: Symbol type representing a Stata variable with name, location, source, and optional type/label
- **CommandNode**: AST node representing a Stata command with name, varlist, options, etc.
- **Prefix Command**: A command that precedes another command (e.g., `capture`, `quietly`, `noisily`)

## Requirements

### Requirement 1: Register Variable Name from Confirm Variable Command

**User Story:** As a Stata developer, I want the LSP to recognize variables referenced via `confirm variable varname`, so that I get proper completions and no false-positive undefined variable warnings.

#### Acceptance Criteria

1. WHEN the Analyzer processes a `confirm variable` command with a variable name, THE Analyzer SHALL register the variable name in the symbol table as a VariableSymbol
2. WHEN the Analyzer processes a `confirm var` command (abbreviated form), THE Analyzer SHALL register the variable name in the symbol table as a VariableSymbol
3. WHEN the Analyzer registers a variable from `confirm variable`, THE VariableSymbol SHALL have source set to `'confirm'`
4. WHEN the Analyzer registers a variable from `confirm variable`, THE VariableSymbol SHALL have its location range set to the range of the variable name token
5. WHEN the `confirm variable` command has no variable name in the varlist, THE Analyzer SHALL not register any variable (graceful handling of incomplete commands)

### Requirement 2: Support Prefixed Confirm Variable Commands

**User Story:** As a Stata developer using prefix commands like `capture confirm variable myvar` or `capture: confirm var myvar`, I want the LSP to recognize the variable name.

#### Acceptance Criteria

1. WHEN the Analyzer processes a `confirm variable` command prefixed with `capture`, THE Analyzer SHALL register the variable name in the symbol table
2. WHEN the Analyzer processes a `confirm variable` command prefixed with `capture:` (colon syntax), THE Analyzer SHALL register the variable name in the symbol table
3. WHEN the Analyzer processes a `confirm variable` command prefixed with `quietly` or `noisily`, THE Analyzer SHALL register the variable name in the symbol table
4. WHEN the Analyzer processes a `confirm variable` command with multiple prefix commands (e.g., `capture noisily confirm var`), THE Analyzer SHALL register the variable name in the symbol table

### Requirement 3: Support Confirm Variable Options

**User Story:** As a Stata developer using `confirm variable myvar, exact`, I want the LSP to still recognize the variable name.

#### Acceptance Criteria

1. WHEN the Analyzer processes a `confirm variable` command with the `exact` option, THE Analyzer SHALL register the variable name in the symbol table
2. WHEN the Analyzer processes a `confirm variable` command with any options, THE Analyzer SHALL extract the variable name correctly regardless of options

### Requirement 4: Type System Update

**User Story:** As a maintainer, I want the VariableSymbol source type to include 'confirm' so the type system accurately reflects all variable creation sources.

#### Acceptance Criteria

1. THE VariableSymbol interface SHALL include `'confirm'` as a valid value in the `source` union type
