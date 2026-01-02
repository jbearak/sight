# Implementation Plan: Workspace Root Fallback Fix

## Overview

This implementation fixes the workspace root fallback path resolution by adding a single line to call `document_store.set_workspace_root()` during server initialization. The analyzer already has the fallback logic; it just needs the workspace root to be set.

## Tasks

- [x] 1. Fix server initialization to set workspace root on document store
  - [x] 1.1 Add document_store.set_workspace_root() call in server.ts
    - Locate the workspace folders initialization block (around line 347)
    - Add call to `document_store.set_workspace_root(folder_paths[0])` after `forward_scope_resolver.set_workspace_roots()`
    - Only set if `folder_paths.length > 0`
    - _Requirements: 1.1_

- [x] 2. Checkpoint - Verify core fix works
  - Ensure all existing tests pass
  - Manually verify workspace root fallback works
  - Ask the user if questions arise

- [x] 3. Write property tests for workspace root fallback
  - [x] 3.1 Write Property 1: Workspace Root Fallback Resolution test
    - Generate random file paths without leading directory
    - Create file at workspace-relative location only (not script-relative)
    - Verify analyzer resolves to workspace-relative path
    - Verify ForwardCall.path contains workspace-relative path
    - **Property 1: Workspace Root Fallback Resolution**
    - **Validates: Requirements 2.1, 3.1, 3.3**
    - _Requirements: 2.1, 3.1, 3.3_

  - [x] 3.2 Write Property 2: Script-Relative Precedence test
    - Generate random file paths
    - Create file at script-relative location
    - Verify analyzer uses script-relative path even if workspace-relative also exists
    - **Property 2: Script-Relative Precedence**
    - **Validates: Requirements 2.2**
    - _Requirements: 2.2_

  - [x] 3.3 Write Property 3: Missing File Handling test
    - Generate random file paths
    - Don't create file at either location
    - Verify analyzer returns script-relative path
    - **Property 3: Missing File Handling**
    - **Validates: Requirements 2.3, 3.2**
    - _Requirements: 2.3, 3.2_

  - [x] 3.4 Write Property 4: Working Directory Precedence test
    - Generate random file paths with working_directory config set
    - Verify analyzer resolves relative to working_directory
    - Verify workspace root fallback is not used when working_directory is set
    - **Property 4: Working Directory Precedence**
    - **Validates: Requirements 2.4**
    - _Requirements: 2.4_

- [x] 4. Final checkpoint - Ensure all tests pass
  - Run full test suite with `bun test`
  - Ensure all property tests pass (minimum 100 iterations each)
  - Ask the user if questions arise

## Notes

- The fix is minimal: one line added to server.ts
- The analyzer's `resolve_forward_call_path` already has the fallback logic implemented
- The document store already has `set_workspace_root()` method
- Property tests validate the existing fallback logic works correctly when workspace_root is set
- Existing property tests in `working-directory-path-resolution.prop.test.ts` already test some of this behavior

