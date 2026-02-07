# Requirements Document

## Introduction

This feature adds variable definitions to the document outline (document symbols) in the Sight LSP for Stata. Currently, the outline displays programs, macros, scalars, matrices, and embedded language blocks, but omits variables created via `gen`, `egen`, and other variable-creating commands. Adding variables to the outline enables developers to quickly navigate to where variables are defined in their Stata code.

## Glossary

- **Document_Outline**: The hierarchical list of symbols displayed in the IDE's outline view, provided via the LSP `textDocument/documentSymbol` request
- **Symbol_Provider**: The LSP component (`src/providers/symbols.ts`) that generates document symbols from parsed document state
- **Variable_Symbol**: A symbol representing a Stata variable, tracked in the analyzer's symbol table with source information (`gen`, `egen`, `input`, `inferred`, `directive`, `rename`, `confirm`)
- **Document_State**: The parsed state of a document including tokens, AST, symbol table, and diagnostics

## Requirements

### Requirement 1: Display Variable Definitions in Document Outline

**User Story:** As a Stata developer, I want to see variable definitions in the document outline, so that I can quickly navigate to where variables are created in my code.

#### Acceptance Criteria

1. WHEN the document outline is requested, THE Symbol_Provider SHALL include variables from the document's symbol table that have `sourceUri` matching the current document and have a source of `gen` or `egen`
2. WHEN the document outline is requested, THE Symbol_Provider SHALL exclude variables with source `input`, `confirm`, `rename`, `inferred`, or `directive` from the outline
3. WHEN displaying a variable in the outline, THE Symbol_Provider SHALL use `SymbolKind.Field` as the symbol kind
4. WHEN displaying a variable in the outline, THE Symbol_Provider SHALL set the detail field to indicate the variable source (e.g., "Variable (gen)", "Variable (egen)")
5. WHEN displaying a variable in the outline, THE Symbol_Provider SHALL use the variable's name as the symbol name without any prefix or suffix decoration

### Requirement 2: Variable Symbol Ordering

**User Story:** As a Stata developer, I want variables to appear in the outline in document order alongside other symbols, so that the outline reflects the structure of my code.

#### Acceptance Criteria

1. WHEN multiple symbols exist in a document, THE Symbol_Provider SHALL sort all top-level symbols (including variables) by their start position (line, then character)
2. WHEN a variable is defined inside a section, THE Symbol_Provider SHALL nest the variable under that section following existing section nesting logic

### Requirement 3: Variable Symbol in Workspace Search

**User Story:** As a Stata developer, I want to find variable definitions across my workspace, so that I can locate where variables are created in any file.

#### Acceptance Criteria

1. WHEN a workspace symbol search is performed, THE Symbol_Provider SHALL include variables from both open documents and the workspace symbol index
2. WHEN displaying a variable in workspace search results, THE Symbol_Provider SHALL include the source file information in the `containerName` field
