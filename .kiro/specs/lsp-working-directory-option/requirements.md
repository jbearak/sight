# Requirements Document

## Introduction

This feature adds a fourth option "lsp" to the `sight.sendToStata.workingDirectory` VS Code setting and makes it the new default. When selected, the extension will query the LSP server for the working directory determined from `@lsp-cd` / `@lsp-working-directory` directives or inherited from parent files via `@lsp-done-by` / `@lsp-included-by` directives.

Currently, the setting supports three options:
- "none" (current default) - Do not change working directory
- "file" - Change to the directory of the current file  
- "workspace" - Change to the workspace root directory

The new "lsp" option becomes the default, enabling users to leverage the LSP's cross-file awareness for consistent working directory management. When no LSP working directory is available, it gracefully falls back to "none" behavior.

## Glossary

- **LSP_Server**: The Sight Language Server Protocol server that provides language features
- **Client_Extension**: The VS Code extension that communicates with the LSP_Server
- **Working_Directory**: The directory Stata uses for resolving relative paths
- **DocumentState**: Internal LSP server state containing parsed document information including working_directory
- **Custom_Request**: An LSP protocol extension for client-server communication beyond standard LSP methods

## Requirements

### Requirement 1: Add LSP Option to Configuration

**User Story:** As a Stata developer, I want to select "lsp" as a working directory option, so that I can use the LSP-determined working directory when sending code to Stata.

#### Acceptance Criteria

1. THE Client_Extension SHALL provide "lsp" as a fourth enum value for the `sight.sendToStata.workingDirectory` setting
2. THE Client_Extension SHALL set "lsp" as the default value for the `sight.sendToStata.workingDirectory` setting
3. WHEN the user selects "lsp" THEN the Client_Extension SHALL display the description "Use working directory from LSP (from @lsp-cd, @lsp-working-directory, @lsp-wd directives or inherited from parent files)"
4. THE Client_Extension SHALL preserve backward compatibility with existing "none", "file", and "workspace" options

### Requirement 2: Custom LSP Request for Working Directory

**User Story:** As a client extension, I want to query the LSP server for a document's working directory, so that I can prepend the correct cd command when sending code to Stata.

#### Acceptance Criteria

1. THE LSP_Server SHALL implement a custom request method `sight/getWorkingDirectory`
2. WHEN the Client_Extension sends a `sight/getWorkingDirectory` request with a document URI THEN the LSP_Server SHALL return the working directory for that document
3. THE LSP_Server SHALL return the working directory as an object with a `workingDirectory` property containing the absolute path string, or `null` if no working directory is set
4. IF the document has a `@lsp-cd` or `@lsp-working-directory` directive THEN the LSP_Server SHALL return the resolved working directory from that directive
5. IF the document inherits a working directory from parent files via `@lsp-done-by` or `@lsp-included-by` THEN the LSP_Server SHALL return the inherited working directory
6. IF no working directory is set or inherited THEN the LSP_Server SHALL return `null` for the `workingDirectory` property

### Requirement 3: Client Integration with LSP Working Directory

**User Story:** As a Stata developer, I want the extension to automatically use the LSP working directory when I send code to Stata, so that relative paths in my code resolve correctly.

#### Acceptance Criteria

1. WHEN the `sight.sendToStata.workingDirectory` setting is "lsp" AND the user sends code to Stata THEN the Client_Extension SHALL query the LSP_Server for the working directory
2. WHEN the LSP_Server returns a valid working directory THEN the Client_Extension SHALL prepend a `cd` command with that directory to the code being sent
3. WHEN the LSP_Server returns `null` for the working directory THEN the Client_Extension SHALL fall back to "none" behavior (do not change working directory)
4. WHEN the LSP request fails or times out THEN the Client_Extension SHALL fall back to "none" behavior (do not change working directory)

### Requirement 4: CD Menu Visibility

**User Story:** As a Stata developer, I want the CD menu items to be visible when appropriate, so that I can manually change directories when needed.

#### Acceptance Criteria

1. WHEN the `sight.sendToStata.workingDirectory` setting is "lsp" AND the LSP returns a valid working directory THEN the Client_Extension SHALL hide the CD menu items
2. WHEN the `sight.sendToStata.workingDirectory` setting is "lsp" AND the LSP returns `null` THEN the Client_Extension SHALL show the CD menu items (since it falls back to "none" behavior)
3. THE CD menu items SHALL be visible when the setting is "none"
4. THE CD menu items SHALL be hidden when the setting is "file" or "workspace"
