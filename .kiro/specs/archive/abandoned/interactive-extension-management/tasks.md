# Implementation Plan: Interactive Extension Management

## Overview

This implementation plan converts the setup.sh script to provide interactive extension conflict resolution while maintaining backward compatibility. The approach focuses on modular helper functions and clear separation of concerns between argument parsing, conflict detection, and user interaction.

## Tasks

- [x] 1. Add command-line argument parsing for --yes/-y flag
  - Parse command-line arguments to detect --yes or -y flags
  - Set AUTO_YES variable based on flag presence
  - Maintain compatibility with existing script usage
  - _Requirements: 5.1, 5.4, 5.5_

- [x]* 1.1 Write property test for argument parsing
  - **Property 6: Flag Recognition Flexibility**
  - **Validates: Requirements 5.4**

- [x] 2. Create extension conflict detection function
  - Implement detect_incompatible_extensions() function
  - Return array of conflicting extension names for given editor
  - Support extensible detection for future incompatible extensions
  - _Requirements: 1.1, 3.1_

- [ ]* 2.1 Write unit tests for extension detection
  - Test detection with various editor states
  - Test with no conflicts, single conflict, multiple conflicts
  - _Requirements: 1.1, 3.1_

- [x] 3. Implement interactive conflict resolution helper
  - Create handle_extension_conflict() function
  - Present three numbered options to user
  - Handle user input validation and re-prompting
  - Execute chosen action (disable/uninstall/skip)
  - _Requirements: 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 4.1, 4.2, 4.3, 4.4, 4.5_

- [ ]* 3.1 Write property test for interactive prompting
  - **Property 1: Interactive Mode Always Prompts Before Action**
  - **Validates: Requirements 1.1**

- [ ]* 3.2 Write property test for input validation
  - **Property 3: Input Validation Persistence**
  - **Validates: Requirements 1.5, 4.1, 4.2, 4.3, 4.4, 4.5**

- [ ]* 3.3 Write property test for prompt content
  - **Property 4: Prompt Content Completeness**
  - **Validates: Requirements 1.4, 2.1, 2.2, 2.3, 2.4, 2.5**

- [x] 4. Refactor main installation loop
  - Integrate conflict detection into editor processing loop
  - Add conditional logic for AUTO_YES vs interactive mode
  - Handle multiple conflicts per editor independently
  - Implement proper logging for auto mode actions
  - _Requirements: 1.2, 3.2, 3.3, 5.2, 5.3_

- [ ]* 4.1 Write property test for auto mode behavior
  - **Property 2: Auto Mode Disables Without Prompting**
  - **Validates: Requirements 1.2, 5.1, 5.2**

- [ ]* 4.2 Write property test for multiple conflict handling
  - **Property 5: Multiple Conflict Independence**
  - **Validates: Requirements 3.1, 3.2, 3.3**

- [ ]* 4.3 Write property test for auto mode logging
  - **Property 7: Auto Mode Logging**
  - **Validates: Requirements 5.3**

- [x] 5. Update script documentation and help text
  - Add --yes/-y flag to script header comments
  - Document the new interactive behavior
  - Add usage examples for both interactive and automated modes
  - _Requirements: 5.5_

- [ ] 6. Checkpoint - Test complete setup flow
  - Ensure all tests pass, ask the user if questions arise.
  - Verify backward compatibility with existing usage
  - Test interactive mode with various scenarios
  - Test automated mode with --yes/-y flags

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests validate universal correctness properties across all inputs
- The implementation maintains full backward compatibility with existing setup.sh usage
- Testing focuses on bash script behavior validation through manual and automated scenarios