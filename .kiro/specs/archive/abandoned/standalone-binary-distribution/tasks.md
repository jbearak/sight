# Implementation Plan: Standalone Binary Distribution

## Overview

This plan implements stdio transport support, CLI argument parsing, Bun-based binary compilation, and Kiro CLI configuration for the Sight LSP server.

## Tasks

- [x] 1. Add CLI entry point with argument parsing
  - [x] 1.1 Create `src/cli.ts` with argument parsing logic
    - Parse `--stdio`, `--node-ipc`, `--quiet`, `--help`, `--version` flags
    - Default to stdio transport when no flag provided
    - Exit with error on unknown flags
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.4_
  - [x] 1.2 Write property test for transport selection determinism
    - **Property 1: Transport Selection Determinism**
    - **Validates: Requirements 1.1, 1.2, 1.3**
  - [x] 1.3 Write property test for unknown flag rejection
    - **Property 2: Unknown Flag Rejection**
    - **Validates: Requirements 2.3**

- [x] 2. Refactor server for transport flexibility
  - [x] 2.1 Extract server factory function from `src/server.ts`
    - Create `create_server(options: ServerOptions)` function
    - Support both stdio and Node IPC transports
    - Route logging to stderr when using stdio
    - _Requirements: 1.4, 1.5_
  - [x] 2.2 Update `src/server.ts` to use factory with CLI options
    - Import CLI module and parse arguments
    - Pass transport selection to server factory
    - _Requirements: 1.1, 1.2, 1.3_

- [x] 3. Checkpoint - Verify stdio transport works
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Create build script for bundling and compilation
  - [x] 4.1 Create `scripts/build-binary.ts` with Bun build API
    - Implement `build_bundle()` for single JS file output
    - Implement `build_binary()` for native executables
    - Support all target platforms (darwin-arm64, linux-x64, linux-arm64, windows-x64, windows-arm64)
    - Embed command database cache as asset
    - _Requirements: 3.1, 3.2, 3.3, 4.1, 4.2, 4.4, 4.6_
  - [x] 4.2 Update `package.json` with new build scripts
    - Add `build:bundle`, `build:binary`, `build:all` scripts
    - Update `bin` entry to point to bundled output
    - _Requirements: 3.5_

- [x] 5. Checkpoint - Verify binary builds work
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Add Kiro CLI configuration
  - [x] 6.1 Create `lsp.json` in project root
    - Configure Sight LSP for Stata files
    - Configure TypeScript LSP for TS files
    - Use relative path to local binary
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

- [x] 7. Update documentation
  - [x] 7.1 Update README.md with standalone binary usage
    - Document CLI flags (`--stdio`, `--node-ipc`, `--quiet`, `--help`, `--version`)
    - Document how to build binaries
    - Document Kiro CLI integration
    - _Requirements: 5.5, 6.1, 6.2, 6.3_
  - [x] 7.2 Update AGENTS.md with build and CLI details
    - Document new build scripts (`build:bundle`, `build:binary`, `build:all`)
    - Document CLI entry point and transport options
    - Document the `lsp.json` configuration
    - _Requirements: 6.4, 6.5_

- [x] 8. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All tasks including property tests are required
- The build script uses Bun's compile feature for cross-platform binaries
- Stdio transport is the standard for standalone LSP servers
- The `lsp.json` enables automatic LSP loading in Kiro CLI
