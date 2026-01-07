# Requirements Document

## Introduction

This feature changes the default value of the `sight.diagnostics.indentation` setting from `true` to `false` and exposes it in VS Code settings. Indentation diagnostics are stylistic warnings that don't affect code execution in Stata (unlike Python). Defaulting to disabled provides a better first-run experience and follows the opt-in philosophy used by mature LSPs for stylistic rules.

## Glossary

- **Indentation_Diagnostics**: Warnings emitted when code indentation doesn't match expected depth based on control flow structure
- **DEFAULT_SETTINGS**: The server-side configuration object containing default values for all LSP settings
- **VS_Code_Settings**: The configuration schema exposed in the VS Code extension's `package.json` that appears in VS Code's Settings UI

## Requirements

### Requirement 1: Change Default Value

**User Story:** As a user opening a legacy codebase, I want indentation diagnostics to be disabled by default, so that I don't see walls of stylistic warnings on first use.

#### Acceptance Criteria

1. THE DEFAULT_SETTINGS object SHALL set `diagnostics.indentation` to `false`
2. WHEN a user has not configured `sight.diagnostics.indentation`, THE LSP SHALL NOT emit indentation diagnostics
3. WHEN a user explicitly sets `sight.diagnostics.indentation` to `true`, THE LSP SHALL emit indentation diagnostics

### Requirement 2: Expose Setting in VS Code

**User Story:** As a VS Code user, I want to see and configure the indentation diagnostics setting in VS Code's Settings UI, so that I can easily enable it if desired.

#### Acceptance Criteria

1. THE VS_Code_Settings schema SHALL include a `sight.diagnostics.indentation` property
2. THE `sight.diagnostics.indentation` property SHALL have type `boolean`
3. THE `sight.diagnostics.indentation` property SHALL have default value `false`
4. THE `sight.diagnostics.indentation` property SHALL have a description explaining its purpose
5. WHEN a user searches for "indentation" in VS Code settings, THE `sight.diagnostics.indentation` setting SHALL appear in results

### Requirement 3: Configuration Propagation

**User Story:** As a developer, I want the VS Code setting to be properly propagated to the LSP server, so that my configuration choice takes effect.

#### Acceptance Criteria

1. WHEN the VS Code extension reads `sight.diagnostics.indentation` from settings, THE value SHALL be passed to the LSP server
2. WHEN the LSP server receives the configuration, THE `IndentationDiagnosticAnalyzer` SHALL respect the configured value
3. WHEN the setting is changed while the LSP is running, THE new value SHALL take effect on subsequent diagnostic runs

### Requirement 4: Documentation Update

**User Story:** As a user reading the README, I want to understand that indentation diagnostics are disabled by default and why, so that I can make an informed decision about enabling them.

#### Acceptance Criteria

1. THE README examples section (where the indentation diagnostic screenshot appears) SHALL include a brief note explaining indentation diagnostics are disabled by default
2. THE README examples section SHALL include a link to a more detailed explanation in the Configuration section
3. THE README Configuration section SHALL explain why indentation diagnostics are disabled by default, including:
   - Indentation is stylistic, not semantic (Stata ignores indentation unlike Python)
   - Legacy codebases may produce many warnings causing alert fatigue
   - Follows opt-in philosophy for stylistic rules used by mature LSPs
4. THE README Configuration section SHALL explain how to enable indentation diagnostics via VS Code settings or `.sight.json`
