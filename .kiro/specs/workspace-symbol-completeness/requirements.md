# Requirements Document

## Introduction

This document specifies the requirements for fixing a bug in the workspace symbol provider where variables, scalars, matrices, and local macros from the workspace index are not included in workspace symbol search results. Currently, only programs and global macros from the workspace index are searchable via `workspace/symbol` (Cmd+T / Ctrl+T), while other symbol types are only searchable if their defining file is currently open in the editor.

## Glossary

- **Workspace_Symbol_Provider**: The LSP component that handles `workspace/symbol` requests, returning symbols matching a query across the entire workspace.
- **Workspace_Index**: The in-memory index built by scanning `.do`, `.ado`, `.doh`, and `.mata` files in the workspace, containing programs, macros, variables, scalars, and matrices.
- **Symbol_Table**: A data structure containing maps for programs, local macros, global macros, variables, scalars, and matrices.
- **Open_Documents**: Files currently open in the editor with live document state.

## Requirements

### Requirement 1: Include Variables from Workspace Index

**User Story:** As a developer, I want to search for variable definitions across my workspace, so that I can navigate to variable declarations without having the defining file open.

#### Acceptance Criteria

1. WHEN a user performs a workspace symbol search with a query, THE Workspace_Symbol_Provider SHALL include variables from the Workspace_Index that match the query.
2. WHEN a variable from the Workspace_Index matches the query, THE Workspace_Symbol_Provider SHALL return a SymbolInformation with kind `Field`, the variable name, its source URI, and containerName indicating it is a Variable.

### Requirement 2: Include Scalars from Workspace Index

**User Story:** As a developer, I want to search for scalar definitions across my workspace, so that I can navigate to scalar declarations without having the defining file open.

#### Acceptance Criteria

1. WHEN a user performs a workspace symbol search with a query, THE Workspace_Symbol_Provider SHALL include scalars from the Workspace_Index that match the query.
2. WHEN a scalar from the Workspace_Index matches the query, THE Workspace_Symbol_Provider SHALL return a SymbolInformation with kind `Variable`, the scalar name, its source URI, and containerName indicating it is a Scalar.

### Requirement 3: Include Matrices from Workspace Index

**User Story:** As a developer, I want to search for matrix definitions across my workspace, so that I can navigate to matrix declarations without having the defining file open.

#### Acceptance Criteria

1. WHEN a user performs a workspace symbol search with a query, THE Workspace_Symbol_Provider SHALL include matrices from the Workspace_Index that match the query.
2. WHEN a matrix from the Workspace_Index matches the query, THE Workspace_Symbol_Provider SHALL return a SymbolInformation with kind `Variable`, the matrix name, its source URI, and containerName indicating it is a Matrix.

### Requirement 4: Include Local Macros from Workspace Index

**User Story:** As a developer, I want to search for local macro definitions across my workspace, so that I can navigate to local macro declarations without having the defining file open.

#### Acceptance Criteria

1. WHEN a user performs a workspace symbol search with a query, THE Workspace_Symbol_Provider SHALL include local macros from the Workspace_Index that match the query.
2. WHEN a local macro from the Workspace_Index matches the query, THE Workspace_Symbol_Provider SHALL return a SymbolInformation with kind `Variable`, the macro name with backtick-quote syntax, its source URI, and containerName indicating it is a Local Macro.

### Requirement 5: Maintain Existing Program and Global Macro Support

**User Story:** As a developer, I want workspace symbol search to continue including programs and global macros from the workspace index, so that existing functionality is preserved.

#### Acceptance Criteria

1. THE Workspace_Symbol_Provider SHALL continue to include programs from the Workspace_Index that match the query.
2. THE Workspace_Symbol_Provider SHALL continue to include global macros from the Workspace_Index that match the query.

### Requirement 6: Case-Insensitive Query Matching

**User Story:** As a developer, I want workspace symbol search to match symbols regardless of case in my query, so that I can find symbols without remembering exact casing.

#### Acceptance Criteria

1. WHEN matching variables, scalars, matrices, and local macros from the Workspace_Index, THE Workspace_Symbol_Provider SHALL perform case-insensitive comparison between the query and symbol names.
