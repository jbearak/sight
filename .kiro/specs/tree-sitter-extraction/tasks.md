# Implementation Plan: Tree-Sitter Grammar Extraction

## Overview

This plan extracts the tree-sitter-stata grammar from the sight monorepo into a standalone GitHub repository named "tree-sitter-stata", updates the Zed extension to reference the external repository, and adds documentation to both repositories.

## Tasks

- [ ] 1. Create standalone grammar repository
  - [x] 1.1 Initialize new Git repository for tree-sitter-stata
    - Create new directory outside sight monorepo
    - Initialize Git repository
    - _Requirements: 1.1, 6.1_
  
  - [x] 1.2 Copy grammar implementation files
    - Copy grammar.js from zed-extension/tree-sitter-stata/
    - Copy src/ directory (scanner.c, parser.c, grammar.json, node-types.json, tree_sitter/)
    - Copy bindings/rust/ directory (lib.rs, build.rs)
    - Copy queries/highlights.scm
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.1, 2.2, 3.1_
  
  - [x] 1.3 Copy and update package configuration files
    - Copy package.json and update name to "tree-sitter-stata" and repository URL to https://github.com/jbearak/tree-sitter-stata
    - Copy Cargo.toml and update name to "tree-sitter-stata" and repository URL
    - Copy tree-sitter.json
    - _Requirements: 2.3, 4.1, 4.2, 4.3, 4.4, 4.5_
  
  - [x] 1.4 Copy test files
    - Create test/ directory
    - Copy test.do, test2.do, test3.do to test/
    - _Requirements: 5.1, 5.2_
  
  - [x] 1.5 Add LICENSE file
    - Copy GPL-3.0 license from existing tree-sitter-stata directory
    - _Requirements: 6.2_

- [ ] 2. Create documentation for grammar repository
  - [x] 2.1 Create README.md for tree-sitter-stata
    - Add overview section explaining the grammar's purpose
    - Add installation instructions for npm and cargo
    - Add usage examples for Node.js and Rust
    - Add development instructions (generate, build, test)
    - Add link to sight repository
    - Add contribution guidelines
    - _Requirements: 6.3, 10.4, 10.5, 10.6, 10.7_

- [ ] 3. Verify grammar repository
  - [x] 3.1 Run tree-sitter generate and verify parser regenerates
    - Execute tree-sitter generate
    - Verify no errors
    - **Property 2: Grammar tests pass**
    - **Validates: Requirements 5.3**
  
  - [x] 3.2 Run cargo test and verify Rust bindings compile
    - Execute cargo test in grammar repository
    - Verify grammar loads successfully
    - **Property 1: Grammar compilation produces working language**
    - **Validates: Requirements 2.4**

- [x] 4. Checkpoint - Verify grammar repository is complete
  - Ensure all files are present
  - Ensure tree-sitter test passes
  - Ensure cargo test passes
  - Ask the user if questions arise

- [ ] 5. Push grammar repository to GitHub
  - [x] 5.1 Create GitHub repository
    - Create new repository named tree-sitter-stata under jbearak account
    - _Requirements: 6.1_
  
  - [x] 5.2 Push code and create version tag
    - Add remote origin
    - Push main branch
    - Create and push tag v0.1.8
    - _Requirements: 6.4_

- [ ] 6. Update Zed extension configuration
  - [x] 6.1 Update extension.toml grammar reference
    - Change grammars.stata.repository from file:// path to https://github.com/jbearak/tree-sitter-stata
    - Change grammars.stata.rev from HEAD to v0.1.8
    - _Requirements: 7.1, 7.2, 7.3_
  
  - [x] 6.2 Verify languages/stata/ directory is preserved
    - Confirm config.toml, highlights.scm, brackets.scm, indents.scm, outline.scm are unchanged
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

- [ ] 7. Clean up sight monorepo
  - [x] 7.1 Remove bundled tree-sitter-stata directory
    - Delete zed-extension/tree-sitter-stata/ directory
    - _Requirements: 7.4, 9.1_
  
  - [x] 7.2 Update or remove grammars/stata directory
    - Remove grammars/stata/ if it only contains .git reference
    - _Requirements: 9.3_
  
  - [x] 7.3 Verify no duplicate grammar files remain
    - Search for grammar.js, scanner.c in zed-extension
    - Confirm no duplicates exist
    - _Requirements: 9.2_

- [ ] 8. Update sight repository documentation
  - [x] 8.1 Add documentation about grammar repository relationship
    - Update README.md or DEVELOPMENT.md with section about tree-sitter-stata
    - Include link to tree-sitter-stata repository
    - Explain how to update grammar version in Zed extension
    - _Requirements: 10.1, 10.2, 10.3_

- [x] 9. Final checkpoint - Verify complete extraction
  - Verify tree-sitter-stata repository is accessible on GitHub
  - Verify Zed extension builds with external grammar reference
  - Verify sight repository no longer contains bundled grammar
  - Ask the user if questions arise

## Notes

- The grammar repository URL is https://github.com/jbearak/tree-sitter-stata
- Version 0.1.8 is used based on current package.json/Cargo.toml versions
- The grammars/stata directory appears to be a Git submodule placeholder and should be removed
