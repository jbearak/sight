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

This document specifies requirements for fixing the workspace root fallback path resolution in the Stata LSP. The workspace root fallback logic exists in the analyzer but is never activated because the server fails to set the workspace root on the document store.

When a file like `/dhs/survey.do` contains `include dhs/year_recodes` and `/dhs/dhs/year_recodes.do` does not exist but `/dhs/year_recodes.do` does exist, the LSP should resolve to the workspace-root-relative path as a fallback.

## Glossary

- **Document_Store**: The `DocumentStore` class that manages open document state and parsing
- **Analyzer**: The `SemanticAnalyzer` class that performs semantic analysis including forward call detection
- **Workspace_Root**: The root directory of the user's workspace (first workspace folder)
- **Forward_Call**: A `do`, `run`, or `include` command that references another file
- **Script_Relative_Path**: A path resolved relative to the containing script's directory
- **Workspace_Relative_Path**: A path resolved relative to the workspace root directory

## Requirements

### Requirement 1: Set Workspace Root on Document Store

**User Story:** As a Stata developer, I want the LSP to use the workspace root for fallback path resolution, so that cross-file features work when files are organized relative to the workspace root.

#### Acceptance Criteria

1. WHEN workspace folders are available during server initialization, THE Server SHALL call `document_store.set_workspace_root()` with the first workspace folder path
2. WHEN workspace folders change, THE Server SHALL update the document store's workspace root accordingly
3. WHEN no workspace folders are available, THE Document_Store SHALL have `workspace_root` set to `undefined`

### Requirement 2: Workspace Root Fallback Resolution

**User Story:** As a Stata developer, I want the LSP to try workspace-root-relative paths when script-relative paths don't exist, so that I can organize my files relative to the project root.

#### Acceptance Criteria

1. WHEN a forward call path does not exist relative to the script directory AND the path exists relative to the workspace root, THE Analyzer SHALL resolve to the workspace-root-relative path
2. WHEN a forward call path exists relative to the script directory, THE Analyzer SHALL use the script-relative path (no fallback needed)
3. WHEN a forward call path does not exist at either location, THE Analyzer SHALL return the script-relative path (for diagnostic purposes)
4. WHEN `@lsp-working-directory` is set, THE Analyzer SHALL NOT use workspace root fallback (working directory takes precedence)

### Requirement 3: Diagnostic Accuracy

**User Story:** As a Stata developer, I want accurate diagnostics when files are not found, so that I can fix path issues.

#### Acceptance Criteria

1. WHEN a file is found via workspace root fallback, THE Analyzer SHALL NOT emit a "file not found" diagnostic
2. WHEN a file is not found at either script-relative or workspace-relative locations, THE Analyzer SHALL emit a diagnostic indicating the file was not found
3. WHEN workspace root fallback is used, THE Forward_Call.path SHALL contain the resolved workspace-relative path

