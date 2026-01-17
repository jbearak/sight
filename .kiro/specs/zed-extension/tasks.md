# Implementation Tasks

## Task 1: Create Extension Directory Structure
**Validates: Requirements 1.1-1.6**

- [ ] 1.1 Create `zed-extension/` directory at project root
- [ ] 1.2 Create `zed-extension/extension.toml` with required metadata (id, name, version, schema_version, authors, description, repository)
- [ ] 1.3 Create `zed-extension/Cargo.toml` for Rust/WebAssembly compilation
- [ ] 1.4 Create `zed-extension/src/lib.rs` implementing the extension trait
- [ ] 1.5 Create `zed-extension/languages/stata/` directory structure
- [ ] 1.6 Copy LICENSE file (GPL-3.0) to `zed-extension/LICENSE`

## Task 2: Create Tree-sitter Grammar
**Validates: Requirements 3.1-3.12**

- [ ] 2.1 Create `zed-extension/tree-sitter-stata/` directory structure with `package.json`, `grammar.js`, and Rust bindings
- [ ] 2.2 Implement grammar rules for comments:
  - `//` and `///` line comments
  - `*` comments ONLY when `*` is the first non-whitespace token on the line (requires line-awareness)
  - `/* ... */` block comments
- [ ] 2.3 Implement grammar rules for string literals (double-quoted strings and compound strings with `` `\"...\"' `` syntax)
- [ ] 2.4 Implement grammar rules for local and global macro references (`` `name' ``, `$name`, `${name}`)
- [ ] 2.5 Implement grammar rules for program definitions (`program define name ... end` and `program name ... end`)
- [ ] 2.6 Implement grammar rules for Mata blocks (`mata ... end`) with external scanner support
- [ ] 2.7 Implement generic command parsing (treat command names as identifiers; avoid embedding a versioned command list)
- [ ] 2.8 Implement basic atoms for highlighting (identifiers, numbers, missing values, built-in variables) and operator tokens as needed
- [ ] 2.9 Create/extend external scanner (`src/scanner.c`) to support:
  - Mata block content tokenization (`$._mata_block_content`)
  - line-start detection token (`$._line_start`) to safely recognize `*` comments
  - (Note: existing public grammars lack this; implement custom scanner based on generic examples/TextMate logic)

## Task 3: Create Language Configuration Files
**Validates: Requirements 2.2-2.4, 8.1-8.6, 9.1-9.4**

- [ ] 3.1 Create `zed-extension/languages/stata/config.toml` with language configuration
- [ ] 3.2 Configure file extension associations (`.do`, `.ado`, `.mata`)
- [ ] 3.3 Configure auto-closing pairs for brackets (`{`, `[`, `(`, `"`)
- [ ] 3.4 Configure auto-closing for Stata local macro quotes (`` ` `` → `'`)
- [ ] 3.5 Configure line comment prefixes (`//`, `*`)
- [ ] 3.6 Configure block comment delimiters (`/*`, `*/`)

## Task 4: Create Syntax Highlighting Queries
**Validates: Requirements 4.1-4.9**

- [ ] 4.1 Create `zed-extension/languages/stata/highlights.scm` file
- [ ] 4.2 Add highlight queries for comments (`@comment`)
- [ ] 4.3 Add highlight queries for string literals (`@string`)
- [ ] 4.4 Add highlight queries for local and global macros (`@variable`)
- [ ] 4.5 Add highlight queries for keywords (`@keyword`)
- [ ] 4.6 Add highlight queries for program names (`@function`)
- [ ] 4.7 Add highlight queries for generic commands (`@function`)
- [ ] 4.8 Add highlight queries for numeric literals (`@number`)
- [ ] 4.8 Add highlight queries for operators (`@operator`)
- [ ] 4.9 Add highlight queries for Stata types (`@type`)

## Task 5: Create Bracket and Indentation Queries
**Validates: Requirements 5.1-5.6, 6.1-6.3**

- [ ] 5.1 Create `zed-extension/languages/stata/brackets.scm` with bracket matching queries
- [ ] 5.2 Add bracket matching for curly braces, square brackets, parentheses
- [ ] 5.3 Add bracket matching for double quotes and Stata local macro delimiters (`` ` `` and `'`)
- [ ] 5.4 Create `zed-extension/languages/stata/indents.scm` with indentation queries
- [ ] 5.5 Add indent rules for block openers (`program`, `if`, `else`, `foreach`, `forvalues`, `while`, `mata`)
- [ ] 5.6 Add outdent rules for block closers (`end`, `}`, `else`)

## Task 6: Create Code Outline Queries
**Validates: Requirements 7.1-7.3**

- [ ] 6.1 Create `zed-extension/languages/stata/outline.scm` with outline queries
- [ ] 6.2 Add outline queries for program definitions

## Task 7: Implement Rust Extension
**Validates: Requirements 10.1-10.5, 11.1-11.3**

- [ ] 7.1 Implement `zed_extension_api::Extension` trait in `src/lib.rs`
- [ ] 7.2 Implement `language_server_command` method to locate and spawn bundled `sight-server` binary
- [ ] 7.3 Add error handling for missing server binary

## Task 8: Update Version Synchronization Script
**Validates: Requirements 13.1-13.5**

- [ ] 8.1 Update `scripts/bump-version.ts` to update `zed-extension/extension.toml` version
- [ ] 8.2 Update `scripts/bump-version.ts` to update `zed-extension/Cargo.toml` version
- [ ] 8.3 Update `scripts/bump-version.ts` to update `zed-extension/tree-sitter-stata/package.json` version

## Task 9: Update Setup Script
**Validates: Requirements 14.1-14.5**

- [ ] 9.1 Add Zed extension build steps to `setup.sh` (Tree-sitter grammar generation)
- [ ] 9.2 Add server binary bundling to `setup.sh` (copy to `zed-extension/server/`)
- [ ] 9.3 Add command database cache copying to `setup.sh`
- [ ] 9.4 Add Zed detection and dev extension installation to `setup.sh`
- [ ] 9.5 Add graceful handling when Zed is not installed

## Task 10: Update Documentation
**Validates: Requirements 15.1-15.4**

- [ ] 10.1 Update `DEVELOPMENT.md` with Zed extension build prerequisites (Rust, Cargo, tree-sitter-cli)
- [ ] 10.2 Update `DEVELOPMENT.md` with step-by-step Zed extension build process
- [ ] 10.3 Update `DEVELOPMENT.md` with local testing instructions for Zed extension
- [ ] 10.4 Update `AGENTS.md` to include Zed extension in system overview

## Task 11: Extend Existing Release Workflows (CI)
**Validates: Requirements 16.1-16.6**

- [ ] 11.1 Extend `.github/workflows/release-build.yml` to build Zed extension archives for each target platform
- [ ] 11.2 Add steps in `release-build.yml` to build the Zed WASM extension, assemble the extension bundle, and compress into platform archives
- [ ] 11.3 Upload the Zed extension archives as part of the existing workflow artifacts for the tag build
- [ ] 11.4 Extend `.github/workflows/release-publish.yml` to download the Zed extension archives from the matching `release-build.yml` run
- [ ] 11.5 In `release-publish.yml`, attach the Zed extension archives to the GitHub Release for the selected tag

## Task 12: Property-Based Tests
**Validates: Design Correctness Properties 1-5**

- [ ]* 12.1 Create property test for grammar parsing all comment styles (Property 1)
- [ ]* 12.2 Create property test for nested local macro parsing up to depth 6 (Property 2)
- [ ]* 12.3 Create property test for version synchronization across all config files (Property 3)
- [ ]* 12.4 Create property test for highlight queries covering all node types (Property 4)
- [ ]* 12.5 Create property test for symmetric bracket pairs in brackets.scm (Property 5)
