# Requirements Document

## Introduction

This document specifies the requirements for adding Zed editor extension support to the Sight LSP project. The extension will provide Stata language support in Zed with feature parity to the existing VS Code extension, including syntax highlighting via Tree-sitter, LSP integration, and Stata-specific editing features like auto-closing pairs for local macro quotes.

## Glossary

- **Zed_Extension**: A WebAssembly-based plugin that integrates language support into the Zed editor, written in Rust and compiled to WASM
- **Tree_Sitter**: An incremental parsing library used by Zed for syntax highlighting and code analysis
- **Tree_Sitter_Grammar**: A parser definition that describes the syntax of a programming language for Tree-sitter
- **Highlights_Query**: A Tree-sitter query file (.scm) that maps syntax tree nodes to highlight capture names
- **LSP**: Language Server Protocol - a standardized protocol for communication between editors and language servers
- **Sight_Server**: The existing Stata LSP server implementation that provides completions, diagnostics, hover, and go-to-definition
- **Local_Macro**: A Stata macro defined with `local` command, referenced using backtick-quote syntax (`` `name' ``)
- **Global_Macro**: A Stata macro defined with `global` command, referenced using `$name` or `${name}` syntax
- **Compound_String**: A Stata string literal using backtick-double-quote syntax (`` `"..."' ``) that supports nesting
- **Extension_Manifest**: The `extension.toml` file that declares extension metadata, grammars, and language servers

## Requirements

### Requirement 1: Extension Directory Structure

**User Story:** As a developer, I want the Zed extension to follow Zed's standard directory structure, so that it can be properly recognized and loaded by Zed.

#### Acceptance Criteria

1. THE Zed_Extension SHALL be located in a `zed-extension/` directory at the project root (parallel to `client/`)
2. THE Zed_Extension SHALL contain an `extension.toml` file with required metadata (id, name, version, schema_version, authors, description, repository)
3. THE Zed_Extension SHALL contain a `Cargo.toml` file for Rust/WebAssembly compilation
4. THE Zed_Extension SHALL contain a `src/lib.rs` file implementing the extension trait
5. THE Zed_Extension SHALL contain a `languages/stata/` directory with language configuration files
6. THE Zed_Extension SHALL include a LICENSE file with GPL-3.0 license (consistent with the rest of the Sight project)

### Requirement 2: Language Registration

**User Story:** As a Stata developer using Zed, I want Stata files to be automatically recognized, so that I get language support when opening them.

#### Acceptance Criteria

1. THE Zed_Extension SHALL register the Stata language with identifier "stata"
2. THE Zed_Extension SHALL associate file extensions `.do`, `.ado`, and `.mata` with the Stata language
3. THE Zed_Extension SHALL provide a `config.toml` file in `languages/stata/` with language configuration
4. WHEN a user opens a file with extension `.do`, `.ado`, or `.mata`, THEN the Zed_Extension SHALL activate Stata language support

### Requirement 3: Tree-sitter Grammar Creation

**User Story:** As a Stata developer, I want syntax highlighting in Zed that matches the VS Code extension, so that I have a consistent experience across editors.

#### Acceptance Criteria

1. THE Zed_Extension SHALL create a new Tree-sitter grammar for Stata based on the existing TextMate grammar (`client/syntaxes/stata.tmLanguage.json`)
2. THE Tree_Sitter_Grammar SHALL be included within the Zed extension directory (not a separate repository)
3. THE Tree_Sitter_Grammar source files SHALL be located in `zed-extension/tree-sitter-stata/` directory
4. THE Tree_Sitter_Grammar SHALL focus on parsing Stata structure needed for editor features (comments, strings, macro syntax, blocks, basic statements) rather than embedding a versioned list of built-in commands/keywords
5. THE Tree_Sitter_Grammar SHALL parse comments:
   - `//` line comments
   - `///` line-continuation comments
   - `*` line comments ONLY when `*` is the first non-whitespace token on the line
   - `/* ... */` block comments
6. THE Tree_Sitter_Grammar SHALL parse string literals (double-quoted strings and compound strings with `` `\"...\"' `` syntax)
7. THE Tree_Sitter_Grammar SHALL parse local macro references with `` `name' `` syntax
8. THE Tree_Sitter_Grammar SHALL parse global macro references with `$name` and `${name}` syntax
9. THE Tree_Sitter_Grammar SHALL parse program definitions (`program define name ... end` and `program name ... end`)
10. THE Tree_Sitter_Grammar SHALL parse Mata blocks (`mata ... end`)
11. THE Tree_Sitter_Grammar SHALL parse basic literals and atoms needed for highlighting (identifiers, numbers, missing values, built-in variables)
12. THE Tree_Sitter_Grammar SHALL parse operators (arithmetic, comparison, logical, assignment) sufficiently for tokenization/highlighting
13. THE Tree_Sitter_Grammar SHALL support nested highlighting depth for:
    - compound strings
    - local macro references
14. THE Tree_Sitter_Grammar SHALL encode depth in the parse tree up to depth 6 (and allow wrap-around behavior in highlighting via repeated captures).
15. THE nested depth model SHALL be independent per construct:
    - local macro depth SHALL be based only on nested local macros
    - compound string depth SHALL be based only on nested compound strings
    - local macros inside compound strings SHALL NOT have their depth offset by compound string nesting

### Requirement 4: Syntax Highlighting Queries

**User Story:** As a Stata developer, I want comprehensive syntax highlighting, so that different code elements are visually distinguishable.

#### Acceptance Criteria

1. THE Zed_Extension SHALL provide a `highlights.scm` file with Tree-sitter queries for syntax highlighting
2. THE Highlights_Query SHALL highlight comments with `@comment` capture
3. THE Highlights_Query SHALL highlight string literals with `@string` capture
4. THE Highlights_Query SHALL highlight local and global macros with `@variable` capture
5. THE Highlights_Query SHALL highlight keywords with `@keyword` capture
6. THE Highlights_Query SHALL highlight program names with `@function` capture
7. THE Highlights_Query SHALL highlight numeric literals with `@number` capture
8. THE Highlights_Query SHALL highlight operators with `@operator` capture
9. THE Highlights_Query SHALL highlight Stata types (byte, int, long, float, double, str*) with `@type` capture
10. THE Highlights_Query SHALL highlight generic commands (e.g., `generate`, `regress`) with `@function` capture
11. THE Highlights_Query SHALL support depth-based highlighting for nested constructs using distinct captures per depth (1-6) for:
    - compound strings
    - local macro references
12. The depth-based captures SHALL apply to the entire span of the construct (delimiters and contents).
13. Depth-based highlighting SHALL NOT be implemented for global macros (they remain a non-depth `@variable` capture).

### Requirement 5: Bracket Matching

**User Story:** As a Stata developer, I want bracket matching support, so that I can easily navigate paired delimiters.

#### Acceptance Criteria

1. THE Zed_Extension SHALL provide a `brackets.scm` file with bracket matching queries
2. THE Zed_Extension SHALL match curly braces `{` and `}`
3. THE Zed_Extension SHALL match square brackets `[` and `]`
4. THE Zed_Extension SHALL match parentheses `(` and `)`
5. THE Zed_Extension SHALL match double quotes `"` and `"`
6. THE Zed_Extension SHALL match Stata local macro delimiters `` ` `` (backtick) and `'` (single quote)

### Requirement 6: Auto-indentation Rules

**User Story:** As a Stata developer, I want automatic indentation, so that my code is properly formatted as I type.

#### Acceptance Criteria

1. THE Zed_Extension SHALL provide an `indents.scm` file with indentation queries
2. WHEN a user opens a block with `program`, `if`, `else`, `foreach`, `forvalues`, or `while`, THEN the Zed_Extension SHALL increase indentation for subsequent lines
3. WHEN a user types `end`, `else`, or `}`, THEN the Zed_Extension SHALL decrease indentation

### Requirement 7: Code Outline Support

**User Story:** As a Stata developer, I want to see a code outline, so that I can navigate to program definitions quickly.

#### Acceptance Criteria

1. THE Zed_Extension SHALL provide an `outline.scm` file with outline queries
2. THE Zed_Extension SHALL include program definitions in the code outline
3. THE Zed_Extension SHALL display program names as outline items

### Requirement 8: Auto-closing Pairs Configuration

**User Story:** As a Stata developer, I want auto-closing pairs for brackets and Stata's unique quote syntax, so that I can type faster.

#### Acceptance Criteria

1. THE Zed_Extension SHALL configure auto-closing for curly braces `{` → `}`
2. THE Zed_Extension SHALL configure auto-closing for square brackets `[` → `]`
3. THE Zed_Extension SHALL configure auto-closing for parentheses `(` → `)`
4. THE Zed_Extension SHALL configure auto-closing for double quotes `"` → `"`
5. THE Zed_Extension SHALL configure auto-closing for Stata local macro quotes: `` ` `` → `'`
6. THE Zed_Extension SHALL rely on Zed's built-in bracket/autoclose engine behavior for interactions inside strings/compound strings (no custom runtime quote logic in the extension)

### Requirement 9: Comment Configuration

**User Story:** As a Stata developer, I want to toggle comments using keyboard shortcuts, so that I can quickly comment and uncomment code.

#### Acceptance Criteria

1. THE Zed_Extension SHALL configure line comment prefixes in the language config
2. THE Zed_Extension SHALL configure `//` as the primary line comment prefix
3. IF Zed supports multiple line comment prefixes, THEN the Zed_Extension SHALL also configure `*` as an alternative line comment prefix
4. THE Zed_Extension SHALL configure `/*` and `*/` as block comment delimiters

### Requirement 10: LSP Integration

**User Story:** As a Stata developer, I want LSP features like completions, diagnostics, and go-to-definition, so that I have a productive editing experience.

#### Acceptance Criteria

1. THE Zed_Extension SHALL implement the `language_server_command` method to start the Sight_Server
2. THE Zed_Extension SHALL bundle the Sight_Server binary as part of the extension (similar to the VS Code extension)
3. THE Zed_Extension SHALL start the Sight_Server with `--stdio` transport
4. THE Sight_Server SHALL be compiled into a standalone executable (e.g., using `bun build --compile`) to remove runtime dependencies for the end user
4. THE Zed_Extension SHALL register the language server for the Stata language
5. THE Zed_Extension SHALL pass appropriate initialization options to the Sight_Server

### Requirement 11: Server Provisioning Strategy

**User Story:** As a user, I want a simple, offline-capable installation. As a maintainer, I want to distribute self-contained extension bundles.

#### Acceptance Criteria

1.  **Bundled Binary**: THE Zed_Extension SHALL always include the compiled `sight-server` binary directly in the extension package.
2.  **Platform Specificity**: THE build process SHALL produce separate extension bundles for each supported platform (macOS/Linux, x64/arm64).
3.  **No Runtime Downloads**: THE Zed_Extension SHALL NOT attempt to download any binaries or dependencies at runtime.
4.  **Command Database**: THE Zed_Extension SHALL bundle the command database caches.

### Requirement 12: Extension Metadata

**User Story:** As a Zed user browsing extensions, I want clear metadata about the Stata extension, so that I can understand what it provides.

#### Acceptance Criteria

1. THE Extension_Manifest SHALL specify id as "sight" (matching the project name)
2. THE Extension_Manifest SHALL specify name as "Sight - Stata Language Server" (matching the VS Code extension display name)
3. THE Extension_Manifest SHALL specify a description as "Language support for Stata using LSP" (matching the VS Code extension)
4. THE Extension_Manifest SHALL specify the repository URL as "https://github.com/jbearak/sight"
5. THE Extension_Manifest SHALL specify authors
6. THE Extension_Manifest SHALL use schema_version 1

### Requirement 13: Version Synchronization

**User Story:** As a maintainer, I want the Zed extension version to stay synchronized with the main project version, so that releases are consistent across all platforms.

#### Acceptance Criteria

1. THE Zed_Extension version in `extension.toml` SHALL match the version in the root `package.json`
2. THE Zed_Extension version in `Cargo.toml` SHALL match the version in the root `package.json`
3. WHEN the version bump scripts (`scripts/bump-version.ts`) are run, THEN the Zed_Extension version files SHALL be updated automatically
4. THE version bump script SHALL update `zed-extension/extension.toml`
5. THE version bump script SHALL update `zed-extension/Cargo.toml`
6. THE version bump script SHALL update `zed-extension/tree-sitter-stata/package.json`


### Requirement 14: Setup Script Integration

**User Story:** As a developer setting up the project, I want the setup script to build and install the Zed extension automatically, so that I can start using it immediately.

#### Acceptance Criteria

1. THE setup.sh script SHALL build the Zed extension as part of the setup process
2. THE setup.sh script SHALL check if Zed is installed on the system
3. IF Zed is installed, THEN the setup.sh script SHALL install the Zed extension as a dev extension
4. THE setup.sh script SHALL handle the case where Zed is not installed gracefully (skip installation without error)
5. THE setup.sh script SHALL provide feedback to the user about whether the Zed extension was installed

### Requirement 15: Documentation

**User Story:** As a developer or contributor, I want clear documentation about building and developing the Zed extension, so that I can understand the build process and contribute effectively.

#### Acceptance Criteria

1. THE `DEVELOPMENT.md` file SHALL document the build prerequisites (Rust, Cargo, Bun, Tree-sitter CLI)
2. THE `DEVELOPMENT.md` file SHALL document the step-by-step build process for the Zed extension
3. THE `AGENTS.md` file SHALL be updated to include the Zed extension in the system overview
4. THE `setup.sh` script SHALL be updated to automate these build steps

### Requirement 16: Release Automation (CI/CD)

**User Story:** As a maintainer, I want to automatically generate installable Zed extension archives as part of the existing release pipeline.

#### Acceptance Criteria

1. THE project SHALL extend the existing tag-triggered GitHub Actions workflow `.github/workflows/release-build.yml` ("Release Build") to build Zed extension archives for each supported platform.
2. The build SHALL produce separate extension archives for each target:
    *   macOS arm64
    *   Linux x86_64
    *   Linux aarch64
    *   Windows x86_64
    *   Windows arm64
3. EACH archive SHALL contain the full extension structure: `extension.toml`, `extension.wasm`, `languages/`, `tree-sitter-stata/`, AND the target-specific `server/sight-server` binary.
4. The build workflow SHALL upload the archives as GitHub Actions workflow artifacts, alongside the existing release artifacts.
5. THE project SHALL extend the existing manually-triggered GitHub Actions workflow `.github/workflows/release-publish.yml` ("Release Publish", triggered via `workflow_dispatch`) to attach the Zed extension archives to the GitHub Release for the selected tag.
6. The archive names SHALL follow the convention: `sight-zed-extension-{os}-{arch}.tar.gz` (or `.zip` on Windows if preferred, but the naming scheme must be consistent and documented).
