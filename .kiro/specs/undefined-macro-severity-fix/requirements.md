# Requirements Document

## Introduction

This document specifies the requirements for fixing a bug where the `sight.diagnostics.severity.undefinedMacro` VS Code setting is ignored. The root cause is that `cross_file.diagnostics.undefined_symbol` has a default value of `'warning'` in `DEFAULT_SETTINGS`, which always takes precedence over the individual diagnostic severity settings.

The fix involves removing the `crossFile.diagnostics.undefinedSymbol` setting entirely, simplifying the configuration by using only the VS Code-exposed `diagnostics.severity.undefinedMacro` and `diagnostics.severity.undefinedVariable` settings.

## Glossary

- **Diagnostics_Provider**: The component responsible for converting semantic diagnostics to LSP diagnostics and applying severity configuration
- **DEFAULT_SETTINGS**: The default LSP configuration object defined in `server-handlers.ts`
- **diagnostics.severity.undefinedMacro**: A VS Code-exposed configuration setting that controls severity specifically for undefined macro diagnostics
- **diagnostics.severity.undefinedVariable**: A VS Code-exposed configuration setting that controls severity specifically for undefined variable diagnostics

## Requirements

### Requirement 1: Individual Severity Settings Work Correctly

**User Story:** As a user, I want my `diagnostics.severity.undefinedMacro` VS Code setting to work, so that I can control the severity of undefined macro warnings from the VS Code settings UI.

#### Acceptance Criteria

1. WHEN a user sets `diagnostics.severity.undefinedMacro` to `'error'` via VS Code settings, THEN THE Diagnostics_Provider SHALL display undefined macro diagnostics with error severity
2. WHEN a user sets `diagnostics.severity.undefinedMacro` to `'hint'` via VS Code settings, THEN THE Diagnostics_Provider SHALL display undefined macro diagnostics with hint severity
3. WHEN a user sets `diagnostics.severity.undefinedMacro` to `'off'` via VS Code settings, THEN THE Diagnostics_Provider SHALL suppress undefined macro diagnostics entirely
4. WHEN a user sets `diagnostics.severity.undefinedVariable` to `'error'` via VS Code settings, THEN THE Diagnostics_Provider SHALL display undefined variable diagnostics with error severity
5. WHEN a user sets `diagnostics.severity.undefinedVariable` to `'off'` via VS Code settings, THEN THE Diagnostics_Provider SHALL suppress undefined variable diagnostics entirely

### Requirement 2: Default Behavior When No Settings Are Configured

**User Story:** As a user, I want sensible defaults when I haven't configured any severity settings, so that I get useful diagnostics out of the box.

#### Acceptance Criteria

1. WHEN `diagnostics.severity.undefinedMacro` is not explicitly set, THEN THE Diagnostics_Provider SHALL use the default severity of `'warning'` for undefined macro diagnostics
2. WHEN `diagnostics.severity.undefinedVariable` is not explicitly set, THEN THE Diagnostics_Provider SHALL use the default severity of `'information'` for undefined variable diagnostics

### Requirement 3: Remove crossFile.diagnostics.undefinedSymbol Setting

**User Story:** As a developer, I want to remove the redundant `crossFile.diagnostics.undefinedSymbol` setting, so that the configuration is simplified and VS Code settings work as expected.

#### Acceptance Criteria

1. THE DEFAULT_SETTINGS object SHALL NOT include `cross_file.diagnostics.undefined_symbol`
2. THE Diagnostics_Provider SHALL NOT check for `cross_file.diagnostics.undefined_symbol` when determining severity
3. THE workspace config mapping SHALL NOT map `crossFile.diagnostics.undefinedSymbol` from `.sight.json`
4. THE config validator SHALL NOT validate `cross_file.diagnostics.undefined_symbol`
5. THE CrossFileConfig type SHALL NOT include `undefined_symbol` in its diagnostics object
6. THE README documentation SHALL NOT document `crossFile.diagnostics.undefinedSymbol` as a valid setting
