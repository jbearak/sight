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

This specification addresses gaps in the document symbols implementation for the Stata LSP. The current implementation provides document symbols for programs, global macros, local macros, and embedded language blocks, but omits scalars and matrices. Additionally, local macros defined within programs are not hierarchically nested under their containing program, which reduces the usefulness of the document outline for navigating complex Stata files.

## Glossary

- **Document_Symbols_Provider**: The LSP component that returns document symbols for the outline view
- **SymbolTable**: The data structure containing all symbols (programs, macros, scalars, matrices, variables) extracted from a document
- **Program_Symbol**: A symbol representing a Stata program definition
- **Local_Macro**: A macro defined with `local` command, scoped to the current do-file or program
- **Global_Macro**: A macro defined with `global` command, accessible across files
- **Scalar_Symbol**: A Stata scalar value defined with `scalar` command
- **Matrix_Symbol**: A Stata matrix defined with `matrix` or `matrix define` command
- **Hierarchical_Nesting**: Organizing child symbols under their containing parent symbol in the outline
- **Range_Containment**: Determining if a symbol's definition position falls within another symbol's range

## Requirements

### Requirement 1: Include Scalars in Document Symbols

**User Story:** As a Stata developer, I want to see scalar definitions in the document outline, so that I can quickly navigate to scalar definitions in my code.

#### Acceptance Criteria

1. WHEN a document contains scalar definitions THEN THE Document_Symbols_Provider SHALL include each scalar as a document symbol
2. WHEN displaying a scalar symbol THEN THE Document_Symbols_Provider SHALL use SymbolKind.Variable for consistency with macro symbols
3. WHEN displaying a scalar symbol THEN THE Document_Symbols_Provider SHALL include "Scalar" as the detail string
4. THE Document_Symbols_Provider SHALL only include scalars where the scalar's sourceUri matches the current document URI

### Requirement 2: Include Matrices in Document Symbols

**User Story:** As a Stata developer, I want to see matrix definitions in the document outline, so that I can quickly navigate to matrix definitions in my code.

#### Acceptance Criteria

1. WHEN a document contains matrix definitions THEN THE Document_Symbols_Provider SHALL include each matrix as a document symbol
2. WHEN displaying a matrix symbol THEN THE Document_Symbols_Provider SHALL use SymbolKind.Variable for consistency with macro symbols
3. WHEN displaying a matrix symbol THEN THE Document_Symbols_Provider SHALL include "Matrix" as the detail string
4. THE Document_Symbols_Provider SHALL only include matrices where the matrix's sourceUri matches the current document URI

### Requirement 3: Hierarchical Nesting of Local Macros Under Programs

**User Story:** As a Stata developer, I want local macros defined inside programs to appear nested under those programs in the outline, so that I can understand the scope and organization of my code.

#### Acceptance Criteria

1. WHEN a local macro is defined within a program's range THEN THE Document_Symbols_Provider SHALL include that macro as a child of the program symbol
2. WHEN a local macro is defined outside any program THEN THE Document_Symbols_Provider SHALL include that macro as a top-level symbol
3. WHEN determining containment THEN THE Document_Symbols_Provider SHALL check if the macro's location.range.start falls within the program's range
4. IF multiple programs contain a macro's position THEN THE Document_Symbols_Provider SHALL assign the macro to the program with the smallest containing range
5. WHEN a program has child local macros THEN THE Document_Symbols_Provider SHALL populate the program symbol's children array with those macros

### Requirement 4: All Local Macros Within Programs Are Nested

**User Story:** As a Stata developer, I want all local macros defined within a program (including implicit locals from syntax) to appear nested under that program, so that I can see the complete scope of locals available in each program.

#### Acceptance Criteria

1. WHEN a program contains any local macros (explicit or implicit) THEN THE Document_Symbols_Provider SHALL include them as children of the program symbol
2. THE Document_Symbols_Provider SHALL use "Local Macro" as the detail string for all nested local macros

### Requirement 5: Preserve Existing Symbol Behavior

**User Story:** As a Stata developer, I want the existing document symbols functionality to continue working, so that my workflow is not disrupted.

#### Acceptance Criteria

1. THE Document_Symbols_Provider SHALL continue to include programs as top-level symbols with SymbolKind.Function
2. THE Document_Symbols_Provider SHALL continue to include global macros as top-level symbols
3. THE Document_Symbols_Provider SHALL continue to include embedded language blocks as top-level structural symbols
4. WHEN no programs exist THEN THE Document_Symbols_Provider SHALL include all local macros as top-level symbols
