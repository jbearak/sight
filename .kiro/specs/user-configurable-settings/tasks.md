# Implementation Plan: User-Configurable Settings

## Overview

This implementation exposes all `StataLSPConfig` settings to users via VS Code's settings UI by adding a `contributes.configuration` section to `client/package.json` and documenting the settings in the README. It also removes the architecturally incorrect `normalizeOnSave` setting, since format-on-save is the editor's responsibility (via `editor.formatOnSave`).

## Tasks

- [x] 1. Remove normalizeOnSave from the codebase
  - [x] 1.1 Remove `normalizeOnSave` from `StataLSPConfig` interface in `src/types/index.ts`
    - Remove from both `StataLSPConfig` and `CommentFormattingConfig` interfaces
    - _Requirements: 8.1_
  - [x] 1.2 Remove `normalizeOnSave` handling from server code
    - Remove from `DEFAULT_SETTINGS` in `src/server-handlers.ts`
    - Remove the `normalizeOnSave` check logic in `server-handlers.ts`
    - Remove validation logic in `src/utils/config-validator.ts`
    - _Requirements: 8.1, 8.2_
  - [x] 1.3 Update README to document using `editor.formatOnSave`
    - Remove references to `normalizeOnSave`
    - Add note that users should use VS Code's `editor.formatOnSave` setting
    - _Requirements: 8.3, 8.4_
  - [x] 1.4 Update any tests that reference `normalizeOnSave`
    - _Requirements: 8.1_

- [x] 2. Add configuration schema to package.json
  - Add `contributes.configuration` section to `client/package.json`
  - Define all settings matching `StataLSPConfig` structure (excluding `normalizeOnSave`)
  - Include type, default, description, and constraints for each setting
  - _Requirements: 1.1-1.5, 2.1-2.2, 3.1-3.6, 4.1-4.2, 5.1, 7.1, 7.2, 7.3_

- [x] 3. Update README with configuration documentation
  - [x] 3.1 Add Configuration section to README.md
    - Document all settings organized by category
    - Include setting name, type, default value, and description for each
    - _Requirements: 9.1, 9.2, 9.3_
  - [x] 3.2 Add example configuration snippets
    - Show common use cases (e.g., disable diagnostics, change formatting style)
    - _Requirements: 9.4_

- [x] 4. Checkpoint - Verify settings appear in VS Code
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Write property test for configuration schema completeness
  - **Property 1: Configuration Schema Completeness**
  - Verify all StataLSPConfig fields have corresponding package.json entries
  - **Validates: Requirements 1.1-1.5, 2.1-2.2, 3.1-3.6, 4.1-4.2, 5.1, 7.1**

- [x] 6. Write property test for README documentation completeness
  - **Property 2: README Documentation Completeness**
  - Verify all package.json settings are documented in README
  - **Validates: Requirements 9.1, 9.2, 9.3, 9.5**

- [x] 7. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- The LSP server already handles configuration via `get_document_settings()` and `validate_comment_formatting_config()`
- `normalizeOnSave` is being removed because format-on-save is the editor's responsibility (use `editor.formatOnSave`)
- Property tests use fast-check with minimum 100 iterations
