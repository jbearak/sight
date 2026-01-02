# Implementation Plan: Binary Installation

## Overview

This plan implements installation scripts for the Sight LSP binary, enabling users to install it to `~/bin/sight-language-server` for PATH-based access, and updates `lsp.json` to use the portable reference.

## Tasks

- [x] 1. Add platform detection utility
  - [x] 1.1 Create shared platform detection in `scripts/build-binary.ts`
    - Add `detect_platform()` function returning platform, arch, and binary name
    - Handle darwin/linux/windows platforms and arm64/x64 architectures
    - Add `.exe` suffix for Windows binaries
    - _Requirements: 1.2, 2.2_
  - [x] 1.2 Write property test for platform binary selection
    - **Property 1: Platform Binary Selection**
    - **Validates: Requirements 1.2, 2.2**

- [x] 2. Add build:current command
  - [x] 2.1 Add `build_current()` function to `scripts/build-binary.ts`
    - Use `detect_platform()` to determine current platform
    - Build only the binary for the current platform
    - Display the path to the built binary on completion
    - _Requirements: 2.1, 2.3_
  - [x] 2.2 Update `package.json` with `build:current` script
    - Add `"build:current": "bun scripts/build-binary.ts current"`
    - _Requirements: 2.1_

- [x] 3. Checkpoint - Verify build:current works
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Create install script
  - [x] 4.1 Create `scripts/install.ts`
    - Detect current platform and find corresponding binary in `bin/`
    - Create `~/bin` directory if it doesn't exist
    - Copy binary to `~/bin/sight-language-server`
    - Set executable permissions (chmod 755 on Unix)
    - Check if `~/bin` is in PATH
    - Display success message with PATH instructions if needed
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 5.1, 5.2, 5.3_
  - [x] 4.2 Write property test for PATH detection
    - **Property 2: PATH Detection**
    - **Validates: Requirements 5.1**
  - [x] 4.3 Update `package.json` with `install` script
    - Add `"install": "bun scripts/install.ts"`
    - _Requirements: 1.1_

- [x] 5. Create uninstall script
  - [x] 5.1 Create `scripts/uninstall.ts`
    - Check if `~/bin/sight-language-server` exists
    - Remove the binary if it exists
    - Display appropriate message (success or nothing to uninstall)
    - _Requirements: 4.1, 4.2, 4.3_
  - [x] 5.2 Update `package.json` with `uninstall` script
    - Add `"uninstall": "bun scripts/uninstall.ts"`
    - _Requirements: 4.1_

- [x] 6. Update lsp.json
  - [x] 6.1 Change command from platform-specific path to `sight-language-server`
    - Update `"command": "./bin/sight-darwin-arm64"` to `"command": "sight-language-server"`
    - _Requirements: 3.1, 3.2_

- [x] 7. Update documentation
  - [x] 7.1 Update README.md with installation instructions
    - Document `bun run build:current` for building
    - Document `bun run install` for installation
    - Document PATH setup for bash/zsh/fish
    - Document `bun run uninstall` for removal
    - _Requirements: 3.3_
  - [x] 7.2 Update AGENTS.md with new scripts
    - Document `build:current`, `install`, `uninstall` scripts
    - _Requirements: 3.3_

- [x] 8. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All tasks including property tests are required
- The installed binary is named `sight-language-server` to avoid conflicts with other tools
- PATH instructions cover bash, zsh, and fish shells
- The install script requires the binary to be built first via `build:current` or `build:binary`
