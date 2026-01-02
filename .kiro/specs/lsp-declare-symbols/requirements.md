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

This feature adds five new LSP directives that allow users to explicitly declare symbols to the language server. These directives tell the LSP that as of the line where the directive appears, the specified symbol should be considered declared. This is useful for suppressing false-positive "undefined" warnings when symbols are defined dynamically or in ways the LSP cannot detect.

The directives are:
- `@lsp-local` - Declares a local macro
- `@lsp-global` - Declares a global macro
- `@lsp-scalar` - Declares a scalar
- `@lsp-matrix` - Declares a matrix
- `@lsp-program` - Declares a program

## Glossary

- **Directive_Parser**: The component that parses LSP directives from comment lines in Stata source files
- **Symbol_Table**: The data structure that stores all known symbols (macros, scalars, matrices, programs) for a file
- **Declaration_Directive**: A comment-based directive that explicitly declares a symbol to the LSP
- **Analyzer**: The component that performs semantic analysis and detects undefined symbol references

## Requirements

### Requirement 1: Parse Declaration Directives

**User Story:** As a Stata developer, I want to declare symbols via comment directives, so that the LSP recognizes them as defined and doesn't show false-positive warnings.

#### Acceptance Criteria

1. WHEN a comment line contains `@lsp-local <name>`, THE Directive_Parser SHALL recognize it as a local macro declaration directive
2. WHEN a comment line contains `@lsp-global <name>`, THE Directive_Parser SHALL recognize it as a global macro declaration directive
3. WHEN a comment line contains `@lsp-scalar <name>`, THE Directive_Parser SHALL recognize it as a scalar declaration directive
4. WHEN a comment line contains `@lsp-matrix <name>`, THE Directive_Parser SHALL recognize it as a matrix declaration directive
5. WHEN a comment line contains `@lsp-program <name>`, THE Directive_Parser SHALL recognize it as a program declaration directive
6. THE Directive_Parser SHALL accept directives in both `*` and `//` comment styles
7. WHEN a directive is parsed, THE Directive_Parser SHALL extract the symbol name as the single argument following the directive keyword

### Requirement 2: Validate Single Argument Constraint

**User Story:** As a Stata developer, I want to be warned when I incorrectly use multiple arguments in a declaration directive, so that I understand each directive accepts exactly one symbol name.

#### Acceptance Criteria

1. WHEN a declaration directive contains exactly one non-whitespace argument, THE Directive_Parser SHALL accept it as valid
2. WHEN a declaration directive contains multiple space-separated tokens after the directive keyword (e.g., `@lsp-local apple berry`), THE Directive_Parser SHALL produce a warning diagnostic
3. WHEN a declaration directive contains trailing whitespace after a single argument (e.g., `@lsp-local apple `), THE Directive_Parser SHALL accept it as valid and ignore the trailing whitespace
4. WHEN a declaration directive contains no argument, THE Directive_Parser SHALL produce a warning diagnostic
5. THE warning message for multiple arguments SHALL indicate that each directive accepts exactly one argument

### Requirement 3: Register Declared Symbols

**User Story:** As a Stata developer, I want declared symbols to be added to the symbol table, so that they are recognized throughout the file from the point of declaration.

#### Acceptance Criteria

1. WHEN a `@lsp-local` directive is parsed, THE Analyzer SHALL add the symbol to the local macros in the Symbol_Table
2. WHEN a `@lsp-global` directive is parsed, THE Analyzer SHALL add the symbol to the global macros in the Symbol_Table
3. WHEN a `@lsp-scalar` directive is parsed, THE Analyzer SHALL add the symbol to the scalars in the Symbol_Table
4. WHEN a `@lsp-matrix` directive is parsed, THE Analyzer SHALL add the symbol to the matrices in the Symbol_Table
5. WHEN a `@lsp-program` directive is parsed, THE Analyzer SHALL add the symbol to the programs in the Symbol_Table
6. THE declared symbol's location SHALL reference the line where the directive appears
7. THE declared symbol's source SHALL be marked as `directive` to distinguish it from symbols detected through code analysis

### Requirement 4: Suppress Undefined Warnings

**User Story:** As a Stata developer, I want references to declared symbols to not trigger undefined warnings, so that I can suppress false positives for dynamically-defined symbols.

#### Acceptance Criteria

1. WHEN a local macro is referenced after an `@lsp-local` directive declares it, THE Analyzer SHALL NOT produce an undefined macro warning
2. WHEN a global macro is referenced after an `@lsp-global` directive declares it, THE Analyzer SHALL NOT produce an undefined macro warning
3. WHEN a scalar is referenced after an `@lsp-scalar` directive declares it, THE Analyzer SHALL NOT produce an undefined scalar warning
4. WHEN a matrix is referenced after an `@lsp-matrix` directive declares it, THE Analyzer SHALL NOT produce an undefined matrix warning
5. WHEN a program is called after an `@lsp-program` directive declares it, THE Analyzer SHALL NOT produce an undefined program warning

### Requirement 5: Declaration Directives Anywhere in File

**User Story:** As a Stata developer, I want to place declaration directives anywhere in my file, so that I can declare symbols close to where they are used.

#### Acceptance Criteria

1. THE Directive_Parser SHALL recognize declaration directives in comment lines anywhere in the file, not just in the header
2. WHEN a declaration directive appears mid-file, THE Directive_Parser SHALL parse it and register the symbol
3. THE declaration directive's effect SHALL apply from the line where it appears through the end of the file

### Requirement 6: Document Declaration Directives

**User Story:** As a Stata developer, I want documentation for the declaration directives, so that I can learn how to use them correctly.

#### Acceptance Criteria

1. THE README.md SHALL document all five declaration directives (`@lsp-local`, `@lsp-global`, `@lsp-scalar`, `@lsp-matrix`, `@lsp-program`)
2. THE documentation SHALL explain that each directive accepts exactly one argument
3. THE documentation SHALL provide usage examples showing the correct syntax
4. THE documentation SHALL explain the purpose of declaration directives (suppressing false-positive undefined warnings)
