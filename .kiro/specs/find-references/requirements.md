# Requirements Document

## Introduction

The Sight LSP currently lacks `textDocument/references` support. Users cannot find all locations where a symbol (macro, program, variable, etc.) is used across the workspace. This is a fundamental IDE feature that enables understanding code dependencies and impact analysis before making changes.

This feature implements the LSP `textDocument/references` method to search indexed workspace files for all usages of a symbol at the cursor position. The implementation leverages the existing workspace indexer and token scanning infrastructure.

## Glossary

- **Reference**: A usage of a symbol (as opposed to its definition)
- **Definition**: The location where a symbol is created or declared
- **Workspace_Indexer**: Component that scans and indexes files in the workspace
- **Token**: Lexical unit from the lexer (e.g., `MACRO_REF_LOCAL`, `MACRO_REF_GLOBAL`, `WORD`)
- **References_Provider**: The component that handles `textDocument/references` requests
- **Symbol**: A named entity in Stata code (macro, program, variable, scalar, or matrix)
- **Local_Macro**: A macro defined with `local` command, referenced as `` `name' ``
- **Global_Macro**: A macro defined with `global` command, referenced as `$name` or `${name}`
- **Document_Store**: Component that manages open document state in memory

## Requirements

### Requirement 1: Symbol Identification at Cursor

**User Story:** As a developer, I want to invoke find-references on any symbol so that I can see where it's used.

#### Acceptance Criteria

1. WHEN the user invokes find-references and the cursor is on a local macro reference (`` `name' ``), THE References_Provider SHALL identify the macro name and search for local macro references with that name
2. WHEN the user invokes find-references and the cursor is on a global macro reference (`$name` or `${name}`), THE References_Provider SHALL identify the macro name and search for global macro references with that name
3. WHEN the user invokes find-references and the cursor is on a program name in a definition or call, THE References_Provider SHALL identify the program name and search for program calls and definitions with that name
4. WHEN the user invokes find-references and the cursor is on a scalar name, THE References_Provider SHALL identify the scalar name and search for scalar usages with that name
5. WHEN the user invokes find-references and the cursor is on a matrix name, THE References_Provider SHALL identify the matrix name and search for matrix usages with that name
6. WHEN the user invokes find-references and the cursor is on a variable name, THE References_Provider SHALL identify the variable name and search for variable usages with that name
7. WHEN the user invokes find-references and the cursor is not on a valid symbol, THE References_Provider SHALL return an empty result array

### Requirement 2: Include Declaration Option

**User Story:** As a developer, I want to optionally include the definition location in results so that I can see the complete picture.

#### Acceptance Criteria

1. WHEN `context.includeDeclaration` is `true` and a definition exists, THE References_Provider SHALL include the definition location in the results
2. WHEN `context.includeDeclaration` is `false`, THE References_Provider SHALL exclude the definition location from the results
3. WHEN `context.includeDeclaration` is `true` but no definition can be found, THE References_Provider SHALL return only reference locations

### Requirement 3: Workspace-Wide Search

**User Story:** As a developer, I want to find references across all files in my workspace so that I understand the full impact of changes.

#### Acceptance Criteria

1. WHEN find-references is invoked, THE References_Provider SHALL search all files tracked by the Workspace_Indexer
2. WHEN a file is not tracked by the Workspace_Indexer, THE References_Provider SHALL exclude that file from the search
3. WHEN the current document has unsaved changes, THE References_Provider SHALL use the in-memory content from the Document_Store for the current document
4. WHEN searching files other than the current document, THE References_Provider SHALL use the indexed content from the Workspace_Indexer

### Requirement 4: Token-Based Reference Detection

**User Story:** As a developer, I want accurate reference detection based on token types so that false positives are minimized.

#### Acceptance Criteria

1. WHEN searching for local macro references, THE References_Provider SHALL match tokens of type `MACRO_REF_LOCAL` where the extracted name equals the target name
2. WHEN searching for global macro references, THE References_Provider SHALL match tokens of type `MACRO_REF_GLOBAL` where the extracted name equals the target name
3. WHEN searching for program references, THE References_Provider SHALL match `WORD` tokens in command position where the name equals the target program name
4. WHEN searching for variable references, THE References_Provider SHALL match `WORD` tokens in variable contexts where the name equals the target variable name
5. THE References_Provider SHALL use case-sensitive string comparison for all symbol name matching

### Requirement 5: Result Format

**User Story:** As a developer, I want results in standard LSP format so that my editor can display them correctly.

#### Acceptance Criteria

1. THE References_Provider SHALL return results as an array of `Location` objects per the LSP specification
2. FOR EACH Location in the results, THE References_Provider SHALL include the file URI and the range of the reference
3. FOR EACH reference range, THE References_Provider SHALL span the complete symbol reference (e.g., `` `name' `` including backtick and quote for local macros, `$name` including dollar sign for globals)

### Requirement 6: Result Ordering

**User Story:** As a developer, I want deterministic result ordering so that I can reliably navigate through references.

#### Acceptance Criteria

1. THE References_Provider SHALL sort results by file URI in ascending lexicographic order
2. WHEN multiple references exist in the same file, THE References_Provider SHALL sort them by line number in ascending order
3. WHEN multiple references exist on the same line, THE References_Provider SHALL sort them by character position in ascending order

### Requirement 7: Performance

**User Story:** As a developer, I want find-references to complete quickly so that my workflow is not interrupted.

#### Acceptance Criteria

1. WHEN searching workspaces with up to 1000 indexed files, THE References_Provider SHALL return results within 500 milliseconds
2. THE References_Provider SHALL yield to the event loop periodically during search to avoid blocking other LSP operations

### Requirement 8: Embedded Language Context

**User Story:** As a developer, I want find-references to handle embedded language blocks consistently with other LSP features.

#### Acceptance Criteria

1. WHEN searching for macro references (local or global), THE References_Provider SHALL include matches found within Mata and Python blocks (macros work across all contexts)
2. WHEN searching for non-macro Stata symbols (programs, variables, scalars, matrices), THE References_Provider SHALL exclude matches found within Mata and Python blocks
3. WHEN the cursor is within a Mata or Python block and on a macro reference, THE References_Provider SHALL search for that macro across all contexts
4. WHEN the cursor is within a Mata or Python block and not on a macro reference, THE References_Provider SHALL return an empty result array

### Requirement 9: LSP Capability Registration

**User Story:** As a developer, I want my editor to know that find-references is supported so that it enables the feature.

#### Acceptance Criteria

1. WHEN the LSP server initializes, THE Server SHALL advertise `referencesProvider: true` in its capabilities
2. WHEN a `textDocument/references` request is received, THE Server SHALL route it to the References_Provider
