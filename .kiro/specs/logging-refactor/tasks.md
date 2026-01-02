# Implementation Plan: Logging Refactor

## Overview

This plan implements a centralized Logger service that routes all production logs through the LSP client. The implementation follows a three-phase approach: create the Logger service with tests, update production modules to use it, and verify all tests pass.

## Tasks

- [x] 1. Create Logger service with core functionality
  - Create `src/utils/logger.ts` with Logger class
  - Implement singleton pattern with getInstance()
  - Implement debug, info, warn, error methods
  - Implement verbosity filtering logic
  - Implement message formatting with timestamp and level
  - Implement fallback to console.debug when no channel provided
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [ ]* 1.1 Write unit tests for Logger service
  - Test all log level methods exist and are callable
  - Test Logger initialization with callback
  - Test message formatting includes timestamp and level
  - Test fallback to console.debug when no channel
  - Test singleton pattern returns same instance
  - Test default verbosity is "info"
  - Test verbosity configuration works
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 5.1, 5.4, 5.5_

- [ ]* 1.2 Write property tests for Logger service
  - **Property 1: Verbosity Filtering** - For any log level and verbosity setting, verify correct filtering
  - **Property 2: Message Formatting** - For any message, verify format includes timestamp and level
  - **Property 3: Fallback Logging** - For any message without channel, verify console.debug is called
  - **Property 4: Singleton Instance** - For any two getInstance calls, verify same instance returned
  - **Property 5: Channel Error Handling** - For any callback that throws, verify error is caught
  - **Property 6: Message Formatting Error Handling** - For any message, verify fallback on format error
  - _Requirements: 1.3, 1.4, 1.5, 5.2, 5.3, 6.1, 6.2, 7.1, 7.2_

- [x] 2. Initialize Logger in server.ts
  - Import Logger in server.ts
  - Initialize Logger in onInitialized handler with connection.console.log callback
  - Set verbosity to "info" by default
  - _Requirements: 3.2, 3.3_

- [ ]* 2.1 Write unit test for Logger initialization in server.ts
  - Test Logger is initialized with connection.console.log callback
  - Test Logger is initialized with "info" verbosity
  - _Requirements: 3.2, 3.3_

- [x] 3. Update src/indexer/index.ts to use Logger
  - Replace console.error calls with logger.error()
  - Replace console.info calls with logger.info()
  - Replace console.debug calls with logger.debug()
  - Replace console.warn calls with logger.warn()
  - _Requirements: 2.2_

- [ ]* 3.1 Write unit tests for indexer logging
  - Test that indexer logs are routed through Logger
  - _Requirements: 2.2_

- [x] 4. Update src/comment-processor/comment-processor.ts to use Logger
  - Replace all console.warn calls with logger.warn()
  - _Requirements: 2.3_

- [ ]* 4.1 Write unit tests for comment-processor logging
  - Test that comment-processor logs are routed through Logger
  - _Requirements: 2.3_

- [x] 5. Update src/scope-resolver/index.ts to use Logger
  - Replace console.debug calls with logger.debug()
  - Replace console.warn calls with logger.warn()
  - Update logger initialization to use Logger instead of custom logger
  - _Requirements: 2.4_

- [ ]* 5.1 Write unit tests for scope-resolver logging
  - Test that scope-resolver logs are routed through Logger
  - _Requirements: 2.4_

- [x] 6. Update src/utils/debounce-manager.ts to use Logger
  - Replace console.warn calls with logger.warn()
  - Replace console.error calls with logger.error()
  - Replace console.debug calls with logger.debug()
  - _Requirements: 2.5_

- [ ]* 6.1 Write unit tests for debounce-manager logging
  - Test that debounce-manager logs are routed through Logger
  - _Requirements: 2.5_

- [x] 7. Update src/providers/formatter.ts to use Logger
  - Replace console.warn calls with logger.warn()
  - _Requirements: 2.6_

- [ ]* 7.1 Write unit tests for formatter logging
  - Test that formatter logs are routed through Logger
  - _Requirements: 2.6_

- [x] 8. Checkpoint - Verify all tests pass
  - Run all unit tests: `bun test tests/unit/`
  - Run all property tests: `bun test tests/property/`
  - Verify no test failures
  - _Requirements: All_

- [x] 9. Verify production code logging
  - Search for remaining console.* calls in src/ (excluding server.ts)
  - Verify all production console calls have been replaced with logger
  - Verify server.ts still uses connection.console.log()
  - _Requirements: 2.1, 3.1, 3.3_

- [x] 10. Verify scripts and tests are unchanged
  - Verify scripts/ directory has no changes
  - Verify tests/ directory has no changes to existing test logging
  - Verify generate-cache.ts, sync-grammar.ts, bump-version.ts still use console.*
  - _Requirements: 4.1, 4.2, 4.3_

- [x] 11. Final checkpoint - Ensure all tests pass
  - Run full test suite: `bun test`
  - Verify no regressions
  - Verify Logger is working correctly across all modules

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- Logger should be imported as: `import { logger } from './utils/logger';`
- All modules should use the singleton logger instance
