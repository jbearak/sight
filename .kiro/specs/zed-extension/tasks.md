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
**Validates: Requirements 3.1-3.21**

- [ ] 2.1 Create `zed-extension/tree-sitter-stata/` directory structure with `package.json`, `grammar.js`, and Rust bindings
- [ ] 2.2 Implement grammar rules for comments (line comments with `//`, `*`, `///` and block comments with `/* */`)
- [ ] 2.3 Implement grammar rules for string literals (double-quoted strings and compound strings with `` `"..."' `` syntax)
- [ ] 2.4 Implement grammar rules for local macro references with `` `name' `` syntax, supporting nesting up to 6 levels
- [ ] 2.5 Implement grammar rules for global macro references with `$name` and `${name}` syntax
- [ ] 2.6 Implement grammar rules for program definitions (`program define name ... end` and `program name ... end`)
- [ ] 2.7 Implement grammar rules for control flow keywords (`if`, `else`, `foreach`, `forvalues`, `forv`, `while`, `continue`, `break`, `end`)
- [ ] 2.8 Implement grammar rules for prefix keywords (`by`, `bysort`, `bys`, `quietly`, `qui`, `noisily`, `noi`, `capture`, `cap`, `sortpreserve`)
- [ ] 2.9 Implement grammar rules for file execution commands (`do`, `run`, `include`)
- [ ] 2.10 Implement grammar rules for data commands (`generate`, `gen`, `egen`, `replace`, `drop`, `keep`, `use`, `save`, `merge`, `append`, etc.)
- [ ] 2.11 Implement grammar rules for output commands (`display`, `list`, `tabulate`, `describe`, `summarize`, etc.)
- [ ] 2.12 Implement grammar rules for macro commands (`local`, `global`, `tempvar`, `tempname`, `tempfile`)
- [ ] 2.13 Implement grammar rules for Mata blocks (`mata ... end`) with external scanner
- [ ] 2.14 Implement grammar rules for Stata types (`byte`, `int`, `long`, `float`, `double`, `str1`-`str2045`, `strL`)
- [ ] 2.15 Implement grammar rules for built-in variables (`_n`, `_N`, `_b`, `_coef`, `_cons`, `_rc`, `_se`, `_pi`)
- [ ] 2.16 Implement grammar rules for missing values (`.`, `.a`-`.z`)
- [ ] 2.17 Implement grammar rules for operators (arithmetic, comparison, logical, assignment)
- [ ] 2.18 Implement grammar rules for numeric literals (integers, decimals, scientific notation)
- [ ] 2.19 Create external scanner (`src/scanner.c`) for Mata block content handling

## Task 3: Create Language Configuration Files
**Validates: Requirements 2.2-2.4, 8.1-8.7, 9.1-9.4**

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
- [ ] 4.7 Add highlight queries for numeric literals (`@number`)
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

## Task 11: Create Release Automation
**Validates: Requirements 16.1-16.6**

- [ ] 11.1 Create `.github/workflows/release-extension.yml` workflow file
- [ ] 11.2 Configure workflow to trigger on new tags
- [ ] 11.3 Add build matrix for all target platforms (macOS arm64, Linux x64/arm64, Windows x64/arm64)
- [ ] 11.4 Add steps to build server binary for each platform
- [ ] 11.5 Add steps to build WASM extension
- [ ] 11.6 Add steps to assemble extension bundle with all required files
- [ ] 11.7 Add steps to create and upload platform-specific archives to GitHub Release

## Task 12: Property-Based Tests
**Validates: Design Correctness Properties 1-5**

- [ ]* 12.1 Create property test for grammar parsing all comment styles (Property 1)
- [ ]* 12.2 Create property test for nested local macro parsing up to depth 6 (Property 2)
- [ ]* 12.3 Create property test for version synchronization across all config files (Property 3)
- [ ]* 12.4 Create property test for highlight queries covering all node types (Property 4)
- [ ]* 12.5 Create property test for symmetric bracket pairs in brackets.scm (Property 5)
