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

This feature exposes the existing `StataLSPConfig` settings to users through VS Code's settings UI. Currently, the LSP server has a comprehensive configuration interface (`StataLSPConfig`) with defaults, but users cannot modify these settings because the VS Code extension lacks a `contributes.configuration` section in its `package.json`. This feature bridges that gap, making all LSP settings user-configurable.

## Glossary

- **Extension**: The VS Code client extension (`client/` directory) that communicates with the LSP server
- **LSP_Server**: The Language Server Protocol server (`src/server.ts`) that processes Stata files
- **Settings_UI**: VS Code's built-in settings interface where users configure extensions
- **Configuration_Section**: The `stata-lsp` namespace used for all Stata LSP settings

## Requirements

### Requirement 1: Expose Diagnostic Settings

**User Story:** As a Stata developer, I want to configure diagnostic behavior, so that I can control which warnings and errors are shown and their severity levels.

#### Acceptance Criteria

1. THE Extension SHALL expose `stata-lsp.diagnostics.enabled` as a boolean setting with default `true`
2. THE Extension SHALL expose `stata-lsp.diagnostics.severity.undefinedMacro` as an enum setting with options `error`, `warning`, `information`, `hint`, `off` and default `warning`
3. THE Extension SHALL expose `stata-lsp.diagnostics.severity.undefinedVariable` as an enum setting with options `error`, `warning`, `information`, `hint`, `off` and default `warning`
4. THE Extension SHALL expose `stata-lsp.diagnostics.severity.styleWarnings` as an enum setting with options `error`, `warning`, `information`, `hint`, `off` and default `hint`
5. THE Extension SHALL expose `stata-lsp.diagnostics.undefinedVariableEnabled` as a boolean setting with default `true`
6. WHEN a user changes any diagnostic setting, THE LSP_Server SHALL apply the new configuration to subsequent diagnostic computations

### Requirement 2: Expose Completion Settings

**User Story:** As a Stata developer, I want to configure auto-completion behavior, so that I can customize what suggestions appear when I type.

#### Acceptance Criteria

1. THE Extension SHALL expose `stata-lsp.completion.includeAbbreviations` as a boolean setting with default `true`
2. THE Extension SHALL expose `stata-lsp.completion.includeSnippets` as a boolean setting with default `true`
3. WHEN a user changes any completion setting, THE LSP_Server SHALL apply the new configuration to subsequent completion requests

### Requirement 3: Expose Formatting Settings

**User Story:** As a Stata developer, I want to configure code formatting options, so that formatted code matches my preferred style.

#### Acceptance Criteria

1. THE Extension SHALL expose `stata-lsp.formatting.indentSize` as a number setting with default `4` and minimum `1`
2. THE Extension SHALL expose `stata-lsp.formatting.indentStyle` as an enum setting with options `spaces`, `tabs` and default `spaces`
3. THE Extension SHALL expose `stata-lsp.formatting.lineWidth` as a number setting with default `80` and minimum `40`
4. THE Extension SHALL expose `stata-lsp.formatting.preferredCommentStyle` as an enum setting with options `//`, `*`, `/* */` and default `//`
5. THE Extension SHALL expose `stata-lsp.formatting.normalizeCommentStyle` as a boolean setting with default `false`
6. THE Extension SHALL expose `stata-lsp.formatting.commentLineWidth` as a number setting with default `72` and minimum `40`
7. WHEN a user changes any formatting setting, THE LSP_Server SHALL apply the new configuration to subsequent formatting requests

### Requirement 4: Expose Indexing Settings

**User Story:** As a Stata developer, I want to configure workspace indexing behavior, so that I can control performance and resource usage.

#### Acceptance Criteria

1. THE Extension SHALL expose `stata-lsp.indexing.maxFileSizeBytes` as a number setting with default `524288` (512KB)
2. THE Extension SHALL expose `stata-lsp.indexWorkspace` as a boolean setting with default `true`
3. WHEN a user changes any indexing setting, THE LSP_Server SHALL apply the new configuration to subsequent indexing operations

### Requirement 5: Expose ADO Path Settings

**User Story:** As a Stata developer, I want to configure additional ADO file search paths, so that the LSP can find custom commands and programs.

#### Acceptance Criteria

1. THE Extension SHALL expose `stata-lsp.adoPaths` as an array of strings setting with default `[]`
2. WHEN a user changes the ADO paths setting, THE LSP_Server SHALL use the new paths for symbol resolution

### Requirement 6: Configuration Change Propagation

**User Story:** As a Stata developer, I want configuration changes to take effect immediately, so that I don't need to restart the extension.

#### Acceptance Criteria

1. WHEN a user modifies any `stata-lsp.*` setting, THE Extension SHALL notify the LSP_Server of the configuration change
2. WHEN the LSP_Server receives a configuration change notification, THE LSP_Server SHALL clear cached settings and re-fetch configuration
3. WHEN diagnostic settings change, THE LSP_Server SHALL revalidate all open documents with the new settings
4. THE Extension SHALL register for configuration change notifications during initialization

### Requirement 7: Setting Descriptions and Documentation

**User Story:** As a Stata developer, I want clear descriptions for each setting, so that I understand what each option does.

#### Acceptance Criteria

1. THE Extension SHALL provide a human-readable description for each exposed setting
2. THE Extension SHALL provide markdown documentation for complex settings explaining valid values and their effects
3. THE Extension SHALL group related settings under appropriate categories in the Settings_UI

### Requirement 8: Remove normalizeOnSave Setting

**User Story:** As a developer, I want the LSP to follow proper architectural patterns, so that format-on-save behavior is controlled by the editor (VS Code) rather than duplicated in the LSP.

#### Acceptance Criteria

1. THE LSP_Server SHALL NOT have a `normalizeOnSave` configuration option
2. THE LSP_Server SHALL rely on VS Code's `editor.formatOnSave` setting for format-on-save behavior
3. THE README SHALL document that users should enable `editor.formatOnSave` for automatic formatting on save
4. WHEN `editor.formatOnSave` is enabled AND `stata-lsp.formatting.normalizeCommentStyle` is enabled, THE LSP_Server SHALL normalize comments during the format request

### Requirement 9: README Documentation

**User Story:** As a Stata developer, I want comprehensive documentation in the README, so that I can discover and understand all available configuration options.

#### Acceptance Criteria

1. THE README SHALL include a "Configuration" or "Settings" section documenting all available settings
2. THE README SHALL list each setting with its name, type, default value, and description
3. THE README SHALL organize settings by category (diagnostics, completion, formatting, indexing)
4. THE README SHALL include example configuration snippets showing common use cases
5. WHEN a new setting is added to the extension, THE README SHALL be updated to include the new setting
