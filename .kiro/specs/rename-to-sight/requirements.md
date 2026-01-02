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

This document specifies the requirements for renaming the Stata LSP project from "stata-lsp" to "sight". The rename affects package names, configuration files, documentation, VS Code extension identifiers, and internal references throughout the codebase.

## Glossary

- **Sight**: The new name for the Stata language server and VS Code extension
- **LSP**: Language Server Protocol - the communication protocol between the editor and language server
- **Extension_Identifier**: The unique identifier used by VS Code to identify extensions (e.g., publisher.extension-name)
- **Package_Name**: The name field in package.json files
- **Configuration_Prefix**: The prefix used for VS Code settings (e.g., "stataLsp" becomes "sight")

## Requirements

### Requirement 1: Package Name Updates

**User Story:** As a developer, I want the package names updated to "sight", so that the project has a consistent identity across all package manifests.

#### Acceptance Criteria

1. WHEN the root package.json is read, THE Package_Name SHALL be "sight"
2. WHEN the client package.json is read, THE Package_Name SHALL be "sight" or "sight-client"
3. WHEN npm/bun install is run, THE system SHALL resolve dependencies correctly with the new package names

### Requirement 2: VS Code Extension Identifier Update

**User Story:** As a VS Code user, I want the extension to be identified as "sight", so that I can find and install it under the new name.

#### Acceptance Criteria

1. WHEN the extension is published, THE Extension_Identifier SHALL use "sight" as the extension name
2. WHEN the extension contributes configuration, THE Configuration_Prefix SHALL be "sight" instead of "stataLsp"
3. WHEN the extension registers commands, THE command identifiers SHALL use "sight" prefix
4. WHEN the extension is displayed in VS Code, THE display name SHALL be "Sight" or "Sight - Stata Language Server"

### Requirement 3: Configuration Key Migration

**User Story:** As a user with existing settings, I want the configuration keys updated consistently, so that the extension settings work under the new naming scheme.

#### Acceptance Criteria

1. WHEN configuration keys are defined, THE system SHALL use "sight" prefix (e.g., "sight.crossFile.maxDepth")
2. WHEN the server reads configuration, THE system SHALL look for "sight" prefixed settings
3. WHEN documentation references settings, THE documentation SHALL use the new "sight" prefix

### Requirement 4: Internal Reference Updates

**User Story:** As a developer, I want all internal references updated, so that the codebase is consistent and searchable.

#### Acceptance Criteria

1. WHEN source files reference the project name, THE references SHALL use "sight" or "Sight"
2. WHEN log messages include the project name, THE messages SHALL use "Sight"
3. WHEN error messages reference the project, THE messages SHALL use "Sight"

### Requirement 5: Documentation Updates

**User Story:** As a user reading documentation, I want all references to use the new name, so that the documentation is accurate and consistent.

#### Acceptance Criteria

1. WHEN README.md is read, THE project name SHALL be "Sight"
2. WHEN AGENTS.md is read, THE project references SHALL use "Sight"
3. WHEN any markdown documentation is read, THE project name SHALL be consistent as "Sight"

### Requirement 6: File and Directory Naming

**User Story:** As a developer, I want configuration files to use the new name where appropriate, so that the project structure reflects the new identity.

#### Acceptance Criteria

1. WHEN workspace configuration files exist (e.g., .stata-lsp.json), THE filename SHALL be updated to .sight.json or similar
2. WHEN the extension looks for configuration files, THE system SHALL look for the new filename
3. IF backward compatibility is needed, THEN THE system SHALL also check for legacy filenames

### Requirement 7: Build Artifacts

**User Story:** As a developer building the extension, I want the output artifacts to use the new name, so that published packages have the correct identity.

#### Acceptance Criteria

1. WHEN the extension is packaged, THE .vsix filename SHALL include "sight"
2. WHEN the server is bundled, THE output SHALL be named appropriately for the "sight" project
