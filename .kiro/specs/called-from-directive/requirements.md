---
Last Updated: 2025-01-01
Change History:
  - 2025-01-01: Added standardized change tracking headers
Dependencies:
  - forward-scope-resolution: [Core dependency]
  - quoted-path-parsing: [Core dependency]
Status: Active
Related Specs:
  - forward-scope-resolution: [Related cross-file spec]
  - cross-file-awareness: [Related cross-file spec]
  - working-directory-inheritance: [Related cross-file spec]
---

# Requirements Document

## Introduction

This feature adds an `@lsp-working-directory` directive (with synonyms `@lsp-working-dir`, `@lsp-current-directory`, `@lsp-current-dir`, `@lsp-cd`, and `@lsp-wd`) that specifies the working directory context for a Stata script. When the LSP processes `do`, `run`, and `include` commands for forward scope resolution, it needs to resolve relative paths. Currently, paths are resolved relative to the script's location. However, Stata scripts are often executed from a different working directory than where they reside. The working directory directive allows users to specify this working directory, enabling accurate path resolution for forward scope analysis.

Additionally, when no working directory directive is present, the LSP should implement a fallback strategy: first try resolving paths relative to the script, then try resolving relative to the workspace root.

## Glossary

- **LSP**: Language Server Protocol - the communication protocol between the IDE and the language server
- **Forward_Scope_Resolver**: The component that follows `do`, `run`, and `include` commands to inherit symbols from called files
- **Directive_Parser**: The component that parses `@lsp-*` directives from file headers
- **Analyzer**: The semantic analyzer that extracts forward calls from `do`, `run`, and `include` commands
- **Working_Directory**: The directory from which a Stata script is executed (may differ from the script's location)
- **Workspace_Root**: The root directory of the currently open workspace/project
- **Header_Directive**: A directive that must appear in the file header (before any non-comment, non-blank code)
- **Working_Directory_Directive**: Any of the synonyms: `@lsp-working-directory`, `@lsp-working-dir`, `@lsp-current-directory`, `@lsp-current-dir`, `@lsp-cd`, `@lsp-wd`

## Requirements

### Requirement 1: Parse Working Directory Directive

**User Story:** As a Stata developer, I want to specify the working directory context for my script using a working directory directive, so that the LSP can correctly resolve relative paths in `do`, `run`, and `include` commands.

#### Acceptance Criteria

1. WHEN a file header contains a working directory directive with a quoted path (e.g., `@lsp-working-directory: "<path>"`) THEN THE Directive_Parser SHALL extract the path and store it as the working directory context
2. WHEN a file header contains a working directory directive without quotes (legacy form) THEN THE Directive_Parser SHALL also accept and parse the directive
3. WHEN a working directory directive appears after non-comment, non-blank code THEN THE Directive_Parser SHALL ignore the directive (header-only constraint)
4. WHEN multiple working directory directives appear in the header THEN THE Directive_Parser SHALL use the last one and emit a warning diagnostic indicating that multiple directives were found
5. WHEN the working directory directive path begins with `/` THEN THE Directive_Parser SHALL interpret it as relative to the workspace root, not the filesystem root

### Requirement 2: Resolve Paths Using Working Directory Context

**User Story:** As a Stata developer, I want the LSP to use my specified working directory when resolving paths in `do`, `run`, and `include` commands, so that forward scope resolution works correctly for scripts executed from different directories.

#### Acceptance Criteria

1. WHEN a working directory directive is present AND the Analyzer encounters a `do`, `run`, or `include` command with a relative path THEN THE Analyzer SHALL resolve the path relative to the specified working directory
2. WHEN a working directory directive specifies a path starting with `/` THEN THE Analyzer SHALL resolve it relative to the workspace root
3. WHEN a working directory directive specifies a relative path (not starting with `/`) THEN THE Analyzer SHALL resolve it relative to the script's containing directory
4. WHEN the resolved working directory does not exist THEN THE Analyzer SHALL emit a warning diagnostic and fall back to the script's containing directory
5. WHEN a `do`, `run`, or `include` command references a file that cannot be found using the working directory context THEN THE Forward_Scope_Resolver SHALL emit a warning diagnostic indicating the file was not found
6. THE working directory directive SHALL NOT affect path resolution for `@lsp-do`, `@lsp-run`, `@lsp-include`, `@lsp-done-by`, or `@lsp-included-by` directives (these directives always resolve paths relative to the script's containing directory)

### Requirement 3: Fallback Path Resolution Without Directive

**User Story:** As a Stata developer, I want the LSP to try multiple path resolution strategies when no working directory directive is present, so that forward scope resolution works in common project structures without requiring explicit configuration.

#### Acceptance Criteria

1. WHEN no working directory directive is present AND the Analyzer encounters a `do`, `run`, or `include` command with a relative path THEN THE Analyzer SHALL first attempt to resolve the path relative to the script's containing directory
2. WHEN the path cannot be resolved relative to the script's containing directory THEN THE Analyzer SHALL attempt to resolve the path relative to the workspace root
3. WHEN the path cannot be resolved by either strategy THEN THE Analyzer SHALL use the script-relative path and emit an informational diagnostic suggesting the user may need to add a working directory directive

### Requirement 4: Document the Directive in README

**User Story:** As a Stata developer, I want clear documentation of the working directory directive, so that I understand how to use it and what behavior to expect.

#### Acceptance Criteria

1. THE README SHALL document the working directory directive syntax with examples, including all synonym forms
2. THE README SHALL explain that the directive must appear in the file header (before non-comment, non-blank code)
3. THE README SHALL explain the `/` prefix behavior for workspace-relative paths
4. THE README SHALL explain the fallback behavior when no directive is present
5. THE README SHALL include examples showing common use cases (e.g., scripts in subdirectories executed from project root)
6. THE README SHALL clarify that the working directory directive only affects path resolution for `do`, `run`, and `include` commands in Stata code, not for other `@lsp-*` directives

### Requirement 5: Pretty-Print Working Directory Directive

**User Story:** As a Stata developer, I want the directive parser to correctly round-trip the working directory directive, so that formatting operations preserve my configuration.

#### Acceptance Criteria

1. FOR ALL valid working directory directives, parsing then printing SHALL produce an equivalent directive
