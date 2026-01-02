# Implementation Plan: macOS Bash Compatibility

## Overview

Refactor `setup.sh` to use POSIX-compliant syntax that works with macOS's default bash 3.2. Changes are minimal and focused on replacing specific incompatible patterns.

## Tasks

- [x] 1. Fix VSIX file discovery
  - Replace `ls -t client/*.vsix | head -1` with `find`-based approach
  - Use `find client -maxdepth 1 -name "*.vsix" -print0 | sort -rz | head -z -n1`
  - Handle case where no VSIX files exist
  - _Requirements: 5.1, 5.2_

- [x] 2. Fix arithmetic increment syntax
  - Replace `((INSTALLED++))` with `INSTALLED=$((INSTALLED + 1))`
  - _Requirements: 2.1, 2.2_

- [x] 3. Fix read command to use -r flag
  - Change `read -p "Please choose (1/2/3): " choice` to `read -r -p "Please choose (1/2/3): " choice`
  - _Requirements: 4.1_

- [x] 4. Refactor extension detection to avoid process substitution
  - Remove the `detect_incompatible_extensions` function
  - Inline the extension check directly in the editor loop
  - Replace `while ... done < <(detect_incompatible_extensions "$editor")` with direct grep check
  - Ensure `skip_installation` variable persists correctly (no subshell)
  - _Requirements: 1.1, 1.2, 1.3, 3.1, 3.2, 3.3_

- [x] 5. Checkpoint - Verify script syntax
  - Run `bash -n setup.sh` to verify no syntax errors
  - Run `shellcheck setup.sh` if available to check for issues
  - Ensure all tests pass, ask the user if questions arise.

- [ ]* 6. Write property tests for bash compatibility
  - [ ]* 6.1 Write property test for no bash 4+ syntax
    - **Property 1: No Bash 4+ Specific Syntax**
    - **Validates: Requirements 1.1, 1.2, 2.1, 2.2, 3.2**
  - [ ]* 6.2 Write property test for read -r flag usage
    - **Property 2: Read Commands Use -r Flag**
    - **Validates: Requirements 4.1**
  - [ ]* 6.3 Write property test for find-based VSIX discovery
    - **Property 3: VSIX Discovery Uses Find**
    - **Validates: Requirements 5.1**

- [x] 7. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- The main changes are in tasks 1-4 which fix the actual compatibility issues
- Property tests verify the script maintains compatibility going forward
