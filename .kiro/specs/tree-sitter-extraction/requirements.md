# Requirements Document

## Introduction

This document specifies the requirements for extracting the tree-sitter-stata grammar from the sight monorepo into a standalone repository. Zed editor requires tree-sitter grammars to be hosted in separate repositories that can be dynamically fetched during extension installation. The current implementation bundles the grammar within the zed-extension directory, which is incompatible with Zed's architecture.

## Glossary

- **Tree_Sitter_Grammar**: A parser generator tool and incremental parsing library that generates parsers from grammar definitions
- **Grammar_Repository**: A standalone Git repository containing a tree-sitter grammar implementation
- **Zed_Extension**: A plugin for the Zed editor that provides language support
- **External_Scanner**: A C file (scanner.c) that handles tokenization logic too complex for the grammar DSL
- **Query_Files**: Tree-sitter query files (.scm) used for syntax highlighting, indentation, and other editor features
- **Rust_Bindings**: Rust language bindings that allow the grammar to be used from Rust code

## Requirements

### Requirement 1: Create Standalone Grammar Repository

**User Story:** As a Zed extension developer, I want the tree-sitter-stata grammar in its own repository, so that Zed can dynamically fetch it during extension installation.

#### Acceptance Criteria

1. THE Grammar_Repository SHALL be named "tree-sitter-stata" to associate it with the sight project
2. THE Grammar_Repository SHALL contain the grammar.js file defining the Stata grammar rules
3. THE Grammar_Repository SHALL contain the src/scanner.c external scanner for line-start detection
4. THE Grammar_Repository SHALL contain the src/parser.c generated parser file
5. THE Grammar_Repository SHALL contain the src/node-types.json generated node types
6. THE Grammar_Repository SHALL contain the src/grammar.json generated grammar JSON
7. THE Grammar_Repository SHALL contain the src/tree_sitter/ header files (parser.h, alloc.h, array.h)

### Requirement 2: Include Rust Bindings

**User Story:** As a Rust developer, I want Rust bindings included in the grammar repository, so that the grammar can be used from Rust code and Zed extensions.

#### Acceptance Criteria

1. THE Grammar_Repository SHALL contain bindings/rust/lib.rs with the Rust language bindings
2. THE Grammar_Repository SHALL contain bindings/rust/build.rs with the build script for compiling the grammar
3. THE Grammar_Repository SHALL contain a Cargo.toml at the root level for Rust package configuration
4. WHEN the Rust bindings are compiled, THE Grammar_Repository SHALL produce a working tree-sitter language

### Requirement 3: Include Query Files

**User Story:** As an editor integrator, I want query files included in the grammar repository, so that syntax highlighting and other features work correctly.

#### Acceptance Criteria

1. THE Grammar_Repository SHALL contain queries/highlights.scm for syntax highlighting
2. THE Query_Files SHALL define highlighting for comments, strings, keywords, macros, and other Stata constructs
3. THE Grammar_Repository MAY contain additional query files for injections if needed

### Requirement 4: Include Package Configuration

**User Story:** As a package consumer, I want proper package configuration files, so that the grammar can be installed via npm and cargo.

#### Acceptance Criteria

1. THE Grammar_Repository SHALL contain a package.json with npm package configuration
2. THE Grammar_Repository SHALL contain a tree-sitter.json with tree-sitter metadata
3. THE package.json SHALL specify the correct repository URL pointing to https://github.com/jbearak/tree-sitter-stata
4. THE Cargo.toml SHALL specify the correct repository URL pointing to https://github.com/jbearak/tree-sitter-stata
5. THE package.json SHALL include scripts for generate, build, test, and parse operations

### Requirement 5: Include Test Files

**User Story:** As a grammar maintainer, I want test files included in the repository, so that grammar correctness can be verified.

#### Acceptance Criteria

1. THE Grammar_Repository SHALL contain test Stata files for validating parser behavior
2. THE Grammar_Repository SHALL contain a test/ directory with tree-sitter corpus tests if they exist
3. WHEN tree-sitter test is run, THE Grammar_Repository SHALL pass all tests

### Requirement 6: Push to GitHub

**User Story:** As a Zed extension developer, I want the grammar repository hosted on GitHub, so that Zed can fetch it during extension installation.

#### Acceptance Criteria

1. THE Grammar_Repository SHALL be pushed to GitHub under the same organization/user as the sight repository
2. THE Grammar_Repository SHALL have a valid LICENSE file (GPL-3.0 to match existing)
3. THE Grammar_Repository SHALL have a README.md documenting usage and installation
4. THE Grammar_Repository SHALL be tagged with a version matching the current grammar version (0.1.8)

### Requirement 7: Update Zed Extension Configuration

**User Story:** As a Zed extension developer, I want the zed-extension to reference the external grammar repository, so that Zed can dynamically fetch the grammar.

#### Acceptance Criteria

1. WHEN the extension.toml is updated, THE Zed_Extension SHALL reference the external GitHub repository URL instead of a local file path
2. THE extension.toml grammars.stata section SHALL specify the GitHub repository URL
3. THE extension.toml grammars.stata section SHALL specify a valid Git revision (tag or commit hash)
4. THE Zed_Extension SHALL NOT contain the tree-sitter-stata directory after extraction

### Requirement 8: Preserve Language Configuration

**User Story:** As a Zed user, I want the language configuration to remain unchanged, so that Stata syntax highlighting and editing features continue to work.

#### Acceptance Criteria

1. THE Zed_Extension SHALL retain the languages/stata/ directory with all query files
2. THE languages/stata/config.toml SHALL remain unchanged
3. THE languages/stata/highlights.scm SHALL remain unchanged
4. THE languages/stata/brackets.scm SHALL remain unchanged
5. THE languages/stata/indents.scm SHALL remain unchanged
6. THE languages/stata/outline.scm SHALL remain unchanged

### Requirement 9: Clean Up Monorepo

**User Story:** As a repository maintainer, I want the bundled grammar code removed from the monorepo, so that there is a single source of truth for the grammar.

#### Acceptance Criteria

1. WHEN extraction is complete, THE sight repository SHALL NOT contain the zed-extension/tree-sitter-stata directory
2. THE sight repository SHALL NOT contain duplicate grammar files
3. THE grammars/stata directory SHALL be updated or removed as appropriate for Zed's fetching mechanism

### Requirement 10: Document Grammar Repository Relationship

**User Story:** As a contributor or user, I want documentation explaining the relationship between the sight repository and the tree-sitter-stata repository, so that I understand how to use and contribute to both.

#### Acceptance Criteria

1. THE sight repository SHALL contain documentation explaining that the tree-sitter grammar lives in a separate repository
2. THE sight repository documentation SHALL include a link to the tree-sitter-stata repository
3. THE sight repository documentation SHALL explain how to update the grammar version in the Zed extension
4. THE tree-sitter-stata repository SHALL contain a README.md explaining its purpose and relationship to the sight project
5. THE tree-sitter-stata README SHALL include installation instructions for npm and cargo
6. THE tree-sitter-stata README SHALL include instructions for contributing grammar changes
7. THE tree-sitter-stata README SHALL include instructions for testing the grammar
