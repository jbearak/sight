---
Last Updated: 2025-01-01
Change History:
  - 2025-01-01: Added standardized change tracking headers
Dependencies:
  - stata-lsp: [Core dependency]
Status: Active
Related Specs:
  - restore-test-regime: [Related diagnostics spec]
  - comment-style-normalization: [Related diagnostics spec]
  - quote-auto-delete-simplification: [Related diagnostics spec]
---

# Requirements Document

## Introduction

This feature enhances the existing large-file handling in the Stata LSP indexer by making the size threshold configurable and improving visibility when files are skipped. The current implementation already skips files >10MB; this adds user control and better feedback.

## Glossary

- **Indexer**: The component that scans workspace files to build symbol tables
- **Size_Threshold**: The file size limit above which files are skipped during workspace indexing
- **Skipped_File**: A file excluded from indexing due to exceeding Size_Threshold

## Requirements

### Requirement 1: Configurable Size Threshold

**User Story:** As a developer, I want to configure the file size limit for indexing, so that I can tune the LSP for my workspace characteristics.

#### Acceptance Criteria

1. THE Indexer SHALL read Size_Threshold from LSP configuration (default: 500KB)
2. WHEN Size_Threshold is configured by the user, THE Indexer SHALL validate it is a positive number
3. IF Size_Threshold is invalid, THEN THE Indexer SHALL use the default value and log a warning

### Requirement 2: Skip Large Files

**User Story:** As a developer with large data-generation scripts, I want the LSP to skip oversized files during workspace indexing, so that the editor doesn't freeze.

#### Acceptance Criteria

1. WHEN a file exceeds Size_Threshold, THE Indexer SHALL skip it during workspace indexing
2. WHEN a file is skipped, THE Indexer SHALL log a debug message with the file path and size
3. THE Indexer SHALL track the count of skipped files in metrics

### Requirement 3: Index Opened Large Files

**User Story:** As a developer, I want the LSP to index large files when I explicitly open them, so that I get LSP features for files I'm actively editing.

#### Acceptance Criteria

1. WHEN a Skipped_File is opened in the editor, THE Document_Store SHALL index it regardless of size
2. WHEN indexing an opened large file, THE Indexer SHALL log an info message noting the file size

### Requirement 4: Report Skipped Files

**User Story:** As a developer, I want to know which files were skipped during indexing, so that I understand the LSP's coverage.

#### Acceptance Criteria

1. WHEN indexing completes, THE Indexer SHALL include skipped file count in metrics
2. THE Indexer SHALL provide a method to retrieve the list of Skipped_Files
3. WHEN files are skipped, THE Indexer SHALL report this via LSP log message
