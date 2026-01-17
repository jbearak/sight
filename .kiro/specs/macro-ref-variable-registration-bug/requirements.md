# Requirements Document

## Introduction

This feature fixes a bug in the Stata LSP analyzer where macro references (both local and global) are incorrectly registered as variable symbols. When parsing commands like `capture confirm variable `my_var'`, the analyzer incorrectly registers `` `my_var' `` as a variable in the symbol table. The same bug exists for global macro references like `$my_var` or `${my_var}`.

The root cause is that the parser correctly accepts `MACRO_REF_LOCAL` and `MACRO_REF_GLOBAL` tokens as valid varlist items, but the analyzer's variable extraction functions don't check whether a varlist item is a macro reference before registering it as a variable.

## Glossary

- **Analyzer**: The semantic analysis component (`src/analyzer/index.ts`) that builds symbol tables from parsed AST
- **SymbolTable**: Data structure containing all defined symbols (variables, macros, programs, etc.)
- **VariableSymbol**: Symbol type representing a Stata variable with name, location, source, and optional type/label
- **CommandNode**: AST node representing a Stata command with name, varlist, options, etc.
- **Varlist_Item**: An item in a command's varlist, containing a name and range
- **Local_Macro_Reference**: A macro reference in the form `` `name' `` (backtick + name + single quote)
- **Global_Macro_Reference**: A macro reference in the form `$name` or `${name}`
- **is_valid_identifier**: Utility function that returns true for valid Stata identifiers (letters, digits, underscores, starting with letter or underscore)

## Requirements

### Requirement 1: Skip Local Macro References in Variable Extraction

**User Story:** As a Stata developer, I want the LSP to NOT register local macro references as variables, so that my symbol table only contains actual variable definitions.

#### Acceptance Criteria

1. WHEN the Analyzer extracts variables from `confirm variable` command, THE Analyzer SHALL skip varlist items that are local macro references (start with backtick and end with single quote)
2. WHEN the Analyzer extracts variables from `gen` command, THE Analyzer SHALL skip varlist items that are local macro references
3. WHEN the Analyzer extracts variables from `egen` command, THE Analyzer SHALL skip varlist items that are local macro references
4. WHEN the Analyzer extracts variables from `input` command, THE Analyzer SHALL skip varlist items that are local macro references
5. WHEN the Analyzer extracts variables from `rename` command, THE Analyzer SHALL skip varlist items that are local macro references

### Requirement 2: Skip Global Macro References in Variable Extraction

**User Story:** As a Stata developer, I want the LSP to NOT register global macro references as variables, so that my symbol table only contains actual variable definitions.

#### Acceptance Criteria

1. WHEN the Analyzer extracts variables from `confirm variable` command, THE Analyzer SHALL skip varlist items that are global macro references (start with `$` or `${`)
2. WHEN the Analyzer extracts variables from `gen` command, THE Analyzer SHALL skip varlist items that are global macro references
3. WHEN the Analyzer extracts variables from `egen` command, THE Analyzer SHALL skip varlist items that are global macro references
4. WHEN the Analyzer extracts variables from `input` command, THE Analyzer SHALL skip varlist items that are global macro references
5. WHEN the Analyzer extracts variables from `rename` command, THE Analyzer SHALL skip varlist items that are global macro references

### Requirement 3: Utility Function for Macro Reference Detection

**User Story:** As a maintainer, I want a reusable utility function to detect macro references, so that the detection logic is consistent across all variable extraction functions.

#### Acceptance Criteria

1. THE Analyzer SHALL provide a helper function `is_macro_reference(name: string): boolean` that returns true for local macro references
2. THE Analyzer SHALL provide a helper function `is_macro_reference(name: string): boolean` that returns true for global macro references
3. THE helper function SHALL return false for plain identifiers
4. THE helper function SHALL be used consistently in all variable extraction functions

### Requirement 4: Preserve Valid Variable Registration

**User Story:** As a Stata developer, I want the LSP to continue registering valid variable names correctly, so that completions and go-to-definition still work.

#### Acceptance Criteria

1. WHEN the Analyzer extracts variables from commands with plain identifier varlist items, THE Analyzer SHALL register them as VariableSymbols
2. WHEN the Analyzer extracts variables from commands with valid identifier varlist items, THE Analyzer SHALL preserve the existing behavior for non-macro-reference items
