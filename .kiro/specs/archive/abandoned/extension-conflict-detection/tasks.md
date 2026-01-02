# Implementation Plan: Extension Conflict Detection

## Overview

This plan implements extension conflict detection for the Sight VS Code client. The implementation is split into pure core functions (testable without VS Code APIs) and a main detector class that integrates with VS Code.

## Tasks

- [x] 1. Create core conflict detection functions
  - [x] 1.1 Create `conflict-detector-core.ts` with pure functions
    - Implement `isConflictingExtension()` function
    - Implement `findConflictingExtensions()` function
    - Implement `formatConflictMessage()` function
    - Implement `formatConflictTooltip()` function
    - Implement `isStataFile()` function
    - Export `STATA_FILE_EXTENSIONS` constant
    - _Requirements: 1.2, 1.3, 1.4, 1.5_

  - [x] 1.2 Write property tests for conflict detection
    - **Property 1: Conflict Detection Correctness**
    - **Property 2: Self-Exclusion Invariant**
    - **Validates: Requirements 1.2, 1.3, 1.4**

  - [x] 1.3 Write property tests for output structure and formatting
    - **Property 3: Output Structure Completeness**
    - **Property 4: Message Formatting Completeness**
    - **Validates: Requirements 1.5, 2.2, 3.2**

- [x] 2. Implement ConflictDetector class
  - [x] 2.1 Create `conflict-detector.ts` with ConflictDetector class
    - Implement constructor with context and outputChannel
    - Implement `detectConflicts()` method using core functions
    - Implement `checkAndNotify()` main entry point
    - Implement `showConflictWarning()` with action buttons
    - Implement `updateStatusBar()` with active editor check
    - Implement `isStataFileActive()` method
    - Implement `showConflictHelp()` for status bar click
    - Implement `dispose()` for cleanup
    - _Requirements: 1.1, 2.1, 2.3, 2.4, 2.5, 2.6, 2.7, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

  - [x] 2.2 Write property tests for warning and status bar decisions
    - **Property 5: Warning Suppression After Dismissal**
    - **Property 6: Status Bar Visibility Decision**
    - **Validates: Requirements 2.8, 3.1, 3.4, 3.5, 3.7, 3.8**

- [x] 3. Integrate into extension activation
  - [x] 3.1 Update `extension.ts` to use ConflictDetector
    - Import ConflictDetector
    - Initialize ConflictDetector in activate()
    - Register onDidChangeActiveTextEditor listener
    - Add ConflictDetector to subscriptions for disposal
    - _Requirements: 1.1, 3.7, 3.8_

- [x] 4. Checkpoint - Ensure all tests pass
  - All 2383 tests pass, including 35 conflict detection tests.

## Notes

- All tasks including property tests are required
- Pure functions in `conflict-detector-core.ts` enable testing without VS Code API mocks
- The `isStataFile()` function checks file extensions: `.do`, `.ado`, `.mata`
- Status bar only shows when conflicts exist AND a Stata file is active
- One-time warning uses `globalState` to track dismissal
- Warning notification has four buttons: Disable, Uninstall, Learn More, Dismiss
