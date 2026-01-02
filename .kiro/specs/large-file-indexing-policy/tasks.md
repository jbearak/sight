# Implementation Plan: Large-File Indexing Policy

## Overview

Add configurable file size thresholds to the workspace indexer. Files exceeding the threshold are skipped during workspace scanning but indexed when explicitly opened.

## Tasks

- [x] 1. Add configuration type for indexing settings
  - Add `indexing.maxFileSizeBytes` to `StataLSPConfig` in `src/types/index.ts`
  - Default value: 512 * 1024 (500KB)
  - _Requirements: 1.1_

- [x] 2. Implement configurable threshold in WorkspaceIndexer
  - [x] 2.1 Add `size_threshold_bytes` field with 500KB default
    - Add private field to WorkspaceIndexer class
    - _Requirements: 1.1_
  - [x] 2.2 Add `skipped_files` tracking map
    - Map<string, number> to track path → size for skipped files
    - _Requirements: 4.2_
  - [x] 2.3 Add `configure()` method to read threshold from config
    - Validate threshold is positive number
    - Log warning and use default if invalid
    - _Requirements: 1.2, 1.3_
  - [x] 2.4 Add `get_skipped_files()` method
    - Return copy of skipped files map
    - _Requirements: 4.2_
  - [x] 2.5 Write property test for config validation
    - **Property 1: Config Validation**
    - **Validates: Requirements 1.1, 1.2, 1.3**

- [x] 3. Update index_file to use configurable threshold
  - [x] 3.1 Replace hardcoded MAX_FILE_SIZE_BYTES with `size_threshold_bytes`
    - Update size check in `index_file` method
    - _Requirements: 2.1_
  - [x] 3.2 Track skipped files in `skipped_files` map
    - Add file path and size when skipping
    - _Requirements: 2.2, 4.2_
  - [x] 3.3 Update log message to include threshold value
    - _Requirements: 2.2_
  - [x] 3.4 Write property test for skip threshold enforcement
    - **Property 2: Skip Threshold Enforcement**
    - **Validates: Requirements 2.1**
  - [x] 3.5 Write property test for metrics accuracy
    - **Property 3: Metrics Accuracy**
    - **Validates: Requirements 2.3, 4.1**
  - [x] 3.6 Write property test for skipped files list accuracy
    - **Property 4: Skipped Files List Accuracy**
    - **Validates: Requirements 4.2**

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Wire configuration to indexer
  - [x] 5.1 Call `configure()` when LSP initializes with workspace settings
    - Update server initialization to pass config to indexer
    - _Requirements: 1.1, 1.2_
  - [x] 5.2 Log summary of skipped files after indexing completes
    - Include count and list of skipped file paths
    - _Requirements: 4.3_

- [x] 6. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- DocumentStore already indexes opened files without size checks, so Requirement 3.1 is already satisfied
- The existing `files_skipped` metric in IndexerMetrics will be used (no changes needed)
