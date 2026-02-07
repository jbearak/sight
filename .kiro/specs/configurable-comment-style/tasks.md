# Implementation Plan: Configurable Comment Style

## Overview

Implement a `sight.lineCommentStyle` setting that dynamically controls VS Code's line comment character for Stata files, and link the existing `sight.formatting.preferredCommentStyle` to defer to it by default. Changes span the client extension, server-side types, config validation, and documentation.

## Tasks

- [x] 1. Register the new setting and update the existing setting in package.json
  - [x] 1.1 Add `sight.lineCommentStyle` to `contributes.configuration.properties` in `client/package.json`
    - Type: enum, values: `"//"`, `"*"`, default: `"//"`
    - Include description and enumDescriptions per design
    - _Requirements: 1.1, 1.2, 4.1, 4.2, 4.3, 4.4_
  - [x] 1.2 Update `sight.formatting.preferredCommentStyle` in `client/package.json`
    - Add `"line"` as a new enum value (first in the list)
    - Change default from `"//"` to `"line"`
    - Update description and enumDescriptions
    - _Requirements: 5.1, 5.2_

- [x] 2. Create the language configuration manager and wire it into the extension
  - [x] 2.1 Create `client/src/language-config.ts`
    - Export `read_line_comment_style()` that reads `sight.lineCommentStyle` from workspace config and returns `'//'` or `'*'`
    - Export `apply_language_configuration(line_comment)` that calls `vscode.languages.setLanguageConfiguration('stata', ...)` with the full language config (matching `language-configuration.json`) and the dynamic `lineComment`
    - Include the base language configuration object as a module constant
    - _Requirements: 1.3, 2.2, 3.1, 3.2_
  - [x] 2.2 Update `client/src/extension.ts` to use the language config manager
    - Import from `language-config.ts`
    - On activation: call `apply_language_configuration(read_line_comment_style())` and push disposable to `context.subscriptions`
    - Register `workspace.onDidChangeConfiguration` listener that re-applies when `sight.lineCommentStyle` changes (dispose previous, apply new)
    - _Requirements: 1.3, 2.1, 3.3_

- [x] 3. Update server-side types and config validation for the "line" option
  - [x] 3.1 Update `src/types/index.ts`
    - Add `'line'` to the `preferredCommentStyle` union in both `CommentFormattingConfig` and `StataLSPConfig.formatting`
    - Add optional `lineCommentStyle?: '//' | '*'` field to `StataLSPConfig`
    - _Requirements: 5.1_
  - [x] 3.2 Update `src/server-handlers.ts` DEFAULT_SETTINGS
    - Change `preferredCommentStyle` default from `'//'` to `'line'`
    - Add `lineCommentStyle: '//'` to DEFAULT_SETTINGS
    - _Requirements: 5.2_
  - [x] 3.3 Update `src/utils/config-validator.ts`
    - Accept `'line'` as a valid `preferredCommentStyle` value in `validate_comment_formatting_config`
    - After validation, resolve `'line'` to the effective style by reading `lineCommentStyle` from the config (default `'//'`)
    - Update `is_valid_comment_style` to accept `'line'`
    - _Requirements: 5.3, 5.4_
  - [x] 3.4 Write property tests for config validation
    - **Property 2: "line" resolution defers to lineCommentStyle**
    - **Validates: Requirements 5.1, 5.3**
    - **Property 3: Explicit preferredCommentStyle bypasses lineCommentStyle**
    - **Validates: Requirements 5.4**

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Update documentation
  - [x] 5.1 Update `README.md` settings table
    - Add `sight.lineCommentStyle` row to the settings table
    - Update `sight.formatting.preferredCommentStyle` row with new default `"line"` and new `"line"` option
    - _Requirements: 6.1, 6.2_
  - [x] 5.2 Add usage example to `README.md`
    - Add a brief example showing how to configure `sight.lineCommentStyle` to `"*"`
    - _Requirements: 6.3_
  - [x] 5.3 Update `COMMENT_NORMALIZATION.md` if it references the `preferredCommentStyle` default
    - Update any references to the old default value
    - _Requirements: 6.2_

- [x] 6. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- The language configuration manager is client-only (no LSP server involvement for comment toggling)
- The server-side changes are only needed for the `"line"` resolution in the formatter's `preferredCommentStyle`
- Property tests use `fast-check` with minimum 100 iterations per property
