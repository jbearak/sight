# Implementation Tasks

## Task 1: Create Extension Directory Structure
**Validates: Requirements 1.1-1.6**

- [x] 1.1 Create `zed-extension/` directory at project root
- [x] 1.2 Create `zed-extension/extension.toml` with required metadata (id, name, version, schema_version, authors, description, repository)
- [x] 1.3 Create `zed-extension/Cargo.toml` for Rust/WebAssembly compilation
- [x] 1.4 Create `zed-extension/src/lib.rs` implementing the extension trait
- [x] 1.5 Create `zed-extension/languages/stata/` directory structure
- [x] 1.6 Copy LICENSE file (GPL-3.0) to `zed-extension/LICENSE`

## Task 2: Create Tree-sitter Grammar
**Validates: Requirements 3.1-3.15**

- [x] 2.1 Create external `tree-sitter-stata` repository with `package.json`, `grammar.js`, and Rust bindings (`bindings/rust/lib.rs`, `bindings/rust/build.rs`)
- [x] 2.2 Implement grammar rules for comments:
  - `//` and `///` line comments
  - `*` comments ONLY when `*` is the first non-whitespace token on the line (requires external scanner)
  - `/* ... */` block comments
- [x] 2.3 Implement grammar rules for string literals:
  - double-quoted strings
  - compound strings with `` `\"...\"' `` syntax
- [x] 2.4 Implement grammar rules for local and global macro references:
  - local macros with `` `name' `` syntax
  - global macros with `$name` and `${name}` syntax
- [x] 2.5 Implement depth-encoded parsing for nested highlighting (up to depth 6):
  - compound strings as `compound_string_depth_1` .. `compound_string_depth_6`
  - local macros as `local_macro_depth_1` .. `local_macro_depth_6`
  - wrap-around behavior after depth 6
  - local macro depth is based only on local macro nesting (not offset by compound string nesting)
- [x] 2.6 Implement grammar rules for program definitions (`program define name ... end` and `program name ... end`)
- [x] 2.7 Implement grammar rules for Mata blocks in all valid forms:
  - Multiline blocks: `mata` or `mata:` followed by newline, content, then `end`
  - Brace-delimited blocks: `mata {` ... `}`
  - Inline expressions: `mata:` or `mata` followed by expression on same line
- [x] 2.8 Implement generic command parsing (treat command names as identifiers; avoid embedding a versioned command list)
- [x] 2.9 Implement basic atoms for highlighting (identifiers, numbers, missing values, built-in variables) and operator tokens
- [x] 2.10 Create external scanner (`src/scanner.c`) to support:
  - line-start detection token (`$._line_start`) to safely recognize `*` comments

## Task 2b: Enhance Tree-sitter Grammar for TextMate Parity
**Validates: Requirements 3.6, 3.12, 3.16-3.19**

These enhancements bring the Tree-sitter grammar to parity with the TextMate grammar for syntax highlighting.

- [x] 2b.1 Add global macro references inside double strings:
  - Update `double_string` to allow `$name` and `${name}` patterns inside
  - Ensure global_macro nodes are created within the string
- [x] 2b.2 Add global macro references inside local macros:
  - Update `local_macro_depth_*` rules to allow `global_macro` as content
  - Example: `` `$global' `` should parse with nested global_macro
- [x] 2b.3 Add control flow keyword nodes:
  - Conditional keywords: `if`, `else`
  - Loop keywords: `foreach`, `forvalues`, `forv`, `while`
  - Control keywords: `continue`, `break`
  - Block terminator: `end`
- [x] 2b.4 Add Stata type keyword nodes:
  - Numeric types: `byte`, `int`, `long`, `float`, `double`
  - String types: `str1` through `str2045`, `strL` (use regex pattern)
- [x] 2b.5 Expand built-in variables to include all TextMate-recognized variables:
  - Add: `_skip`, `_dup`, `_newline`, `_column`, `_continue`, `_request`, `_char`
- [x] 2b.6 Add interaction operator `#` to operator list
- [x] 2b.7 Update highlights.scm with captures for new node types:
  - Control flow keywords → `@keyword`
  - Type keywords → `@type`
  - New built-in variables → `@variable.builtin`
  - Interaction operator → `@operator`
- [x] 2b.8 Regenerate parser and verify all tests pass

## Task 3: Create Language Configuration Files
**Validates: Requirements 2.2-2.4, 8.1-8.6, 9.1-9.4**

- [x] 3.1 Create `zed-extension/languages/stata/config.toml` with language configuration
- [x] 3.2 Configure file extension associations (`.do`, `.ado`, `.mata`)
- [x] 3.3 Configure auto-closing pairs for brackets (`{`, `[`, `(`, `"`)
- [x] 3.4 Configure auto-closing for Stata local macro quotes (`` ` `` → `'`)
- [x] 3.5 Configure line comment prefixes (`//`, `*`)
- [x] 3.6 Configure block comment delimiters (`/*`, `*/`)

## Task 4: Create Syntax Highlighting Queries
**Validates: Requirements 4.1-4.13**

- [x] 4.1 Create `zed-extension/languages/stata/highlights.scm` file
- [x] 4.2 Add highlight queries for comments (`@comment`)
- [x] 4.3 Add highlight queries for double-quoted strings (`@string`)
- [x] 4.4 Add highlight queries for depth-based compound strings (distinct captures for depth 1-6)
- [x] 4.5 Add highlight queries for depth-based local macros (distinct captures for depth 1-6)
- [x] 4.6 Add highlight queries for global macros as non-depth (`@variable`)
- [x] 4.7 Add highlight queries for keywords (`@keyword`)
- [x] 4.8 Add highlight queries for program names (`@function`)
- [x] 4.9 Add highlight queries for generic commands (`@function`)
- [x] 4.10 Add highlight queries for numeric literals (`@number`)
- [x] 4.11 Add highlight queries for operators (`@operator`)
- [x] 4.12 Add highlight queries for Stata types (`@type`)

## Task 5: Create Bracket and Indentation Queries
**Validates: Requirements 5.1-5.6, 6.1-6.3**

- [x] 5.1 Create `zed-extension/languages/stata/brackets.scm` with bracket matching queries
- [x] 5.2 Add bracket matching for curly braces, square brackets, parentheses
- [x] 5.3 Add bracket matching for double quotes and Stata local macro delimiters (`` ` `` and `'`)
- [x] 5.4 Create `zed-extension/languages/stata/indents.scm` with indentation queries
- [x] 5.5 Add indent rules for block openers (`program`, `if`, `else`, `foreach`, `forvalues`, `while`, `mata`)
- [x] 5.6 Add outdent rules for block closers (`end`, `}`, `else`)

## Task 6: Create Code Outline Queries
**Validates: Requirements 7.1-7.3**

- [x] 6.1 Create `zed-extension/languages/stata/outline.scm` with outline queries
- [x] 6.2 Add outline queries for program definitions

## Task 7: Implement Rust Extension
**Validates: Requirements 10.1-10.5, 11.1-11.3**

- [x] 7.1 Implement `zed_extension_api::Extension` trait in `src/lib.rs`
- [x] 7.2 Implement `language_server_command` method to locate and spawn bundled `sight-server` binary
- [x] 7.3 Add error handling for missing server binary

## Task 8: Update Version Synchronization Script
**Validates: Requirements 13.1-13.6**

- [x] 8.1 Update `scripts/bump-version.ts` to update `zed-extension/extension.toml` version
- [x] 8.2 Update `scripts/bump-version.ts` to update `zed-extension/Cargo.toml` version
- [x] 8.3 Update `scripts/bump-version.ts` to skip tree-sitter-stata package.json (lives in separate repo)

## Task 9: Update Setup Script
**Validates: Requirements 14.1-14.5**

- [x] 9.1 Add Zed extension build steps to `setup.sh` (Tree-sitter grammar generation)
- [x] 9.2 Add server binary bundling to `setup.sh` (copy to `zed-extension/server/`)
- [x] 9.3 Add command database cache copying to `setup.sh`
- [x] 9.4 Add Zed detection and dev extension installation to `setup.sh`
- [x] 9.5 Add graceful handling when Zed is not installed

## Task 10: Update Documentation
**Validates: Requirements 15.1-15.4**

- [x] 10.1 Update `DEVELOPMENT.md` with Zed extension build prerequisites (Rust, Cargo, tree-sitter-cli)
- [x] 10.2 Update `DEVELOPMENT.md` with step-by-step Zed extension build process
- [x] 10.3 Update `DEVELOPMENT.md` with local testing instructions for Zed extension
- [x] 10.4 Update `AGENTS.md` to include Zed extension in system overview

## Task 11: Extend Existing Release Workflows (CI)
**Validates: Requirements 16.1-16.6**

- [x] 11.1 Extend `.github/workflows/release-build.yml` to build Zed extension archives for each target platform (darwin-arm64, linux-x64, linux-arm64, windows-x64, windows-arm64)
- [x] 11.2 Add steps in `release-build.yml` to build the Zed WASM extension, assemble the extension bundle, and compress into platform archives
- [x] 11.3 Upload the Zed extension archives as part of the existing workflow artifacts for the tag build
- [x] 11.4 Extend `.github/workflows/release-publish.yml` to download the Zed extension archives from the matching `release-build.yml` run
- [x] 11.5 In `release-publish.yml`, attach the Zed extension archives to the GitHub Release for the selected tag

## Task 12: Unit Tests
**Validates: Testing Strategy - Unit Tests**

- [x] 12.1 Create grammar unit test file `tests/unit/zed-extension-grammar.test.ts`
- [x] 12.2 Add unit tests for comment parsing (all 4 comment styles)
- [x] 12.3 Add unit tests for string parsing (double strings, compound strings, escaped quotes)
- [x] 12.4 Add unit tests for macro parsing (local macros, global macros, positional args)
- [x] 12.5 Add unit tests for Mata block parsing (all 5 forms)
- [x] 12.6 Add unit tests for program definition parsing (with/without `define`)
- [x] 12.7 Add unit tests for macro definition parsing (local, global, tempvar)
- [x] 12.8 Add unit tests for query file coverage (highlights.scm, brackets.scm, indents.scm)
- [x] 12.9 Add unit tests for configuration files (extension.toml, config.toml, version consistency)
- [x] 12.10 Add unit tests for macros inside strings (global macros in double strings, local macros in compound strings)
- [x] 12.11 Add unit tests for global macros inside local macros (nested macro references)

## Task 13: Property-Based Tests
**Validates: Design Correctness Properties 1-10**

- [x] 13.1 Create PBT file `tests/property/zed-extension-grammar.prop.test.ts`
- [x] 13.2 Implement Property 1: Line comments preserve arbitrary content
- [x] 13.3 Implement Property 2: Block comments preserve arbitrary content
- [x] 13.4 Implement Property 3: Nested local macros parse to correct depth (1-6)
- [x] 13.5 Implement Property 4: Nested compound strings parse to correct depth (1-6)
- [x] 13.6 Implement Property 5: All Mata block forms parse as mata_block
- [x] 13.7 Implement Property 6: Double strings preserve arbitrary content
- [x] 13.8 Implement Property 7: Global macros parse with valid identifiers
- [x] 13.9 Implement Property 8: Program definitions parse with valid names
- [x] 13.10 Implement Property 9: Valid Stata identifiers parse correctly
- [x] 13.11 Implement Property 10: Numbers parse in all valid formats

## Task 14: TextMate Parity Tests
**Validates: Requirements 3.1 (Tree-sitter grammar based on TextMate grammar)**

These tests verify the Tree-sitter grammar produces equivalent node types for constructs that the TextMate grammar highlights.

- [x] 14.1 Create parity test file `tests/unit/zed-extension-textmate-parity.test.ts`
- [x] 14.2 Add parity tests for comment scopes (comment.block, comment.line.star, comment.line.double-slash, comment.line.triple-slash)
- [x] 14.3 Add parity tests for string scopes (string.quoted.double, string.quoted.compound.depth1-6)
- [x] 14.4 Add parity tests for macro scopes (variable.other.macro.local.depth1-6, variable.other.macro.global)
- [x] 14.5 Add parity tests for Mata block scopes (keyword.control.mata, meta.embedded.block.mata)
- [x] 14.6 Add parity tests for program definition scopes (storage.type.function, entity.name.function)
- [x] 14.7 Add parity tests for keyword scopes (keyword.control.conditional, keyword.control.flow, keyword.control.prefix)
- [x] 14.8 Add parity tests for type scopes (support.type.stata for byte, int, long, float, double, str*)
- [x] 14.9 Add parity tests for built-in variable scopes (_n, _N, _b, _coef, _cons, _rc, _se, _pi)
- [x] 14.10 Add parity tests for missing value scopes (., .a, .b, ..., .z)
- [x] 14.11 Add parity tests for operator scopes (arithmetic, comparison, logical, assignment)
- [x] 14.12 Add parity tests for number scopes (integer, decimal, scientific notation)
- [x] 14.13 Add parity tests for macros inside double strings (global macro expansion)
- [x] 14.14 Add parity tests for global macros inside local macros
