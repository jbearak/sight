# Implementation Plan: Option Extraction

## Overview

This implementation adds option extraction to the SMCL extractor, updates the cache format to include options, and integrates hardcoded options as a fallback. The work is organized into phases: types/interfaces first, then extraction logic, then cache integration, and finally testing.

## Tasks

- [x] 1. Update type definitions
  - [x] 1.1 Add ExtractedOption interface to smcl-extractor.ts
    - Define name, min_abbreviation, description, has_argument, argument_type fields
    - _Requirements: 1.1, 1.2, 1.3_
  - [x] 1.2 Update ExtractedCommand interface to include options array
    - Add `options: ExtractedOption[]` field
    - _Requirements: 3.4_
  - [x] 1.3 Update CommandInfo in command-database/types.ts to include options
    - Add `options: OptionInfo[]` field (required, not optional)
    - Define OptionInfo with name, min_abbreviation, description, has_argument
    - _Requirements: 4.1, 4.2, 6.1_

- [x] 2. Implement option extraction in smcl-extractor.ts
  - [x] 2.1 Add regex patterns for option parsing
    - OPT_ABBREV_PATTERN for `{opt abbrev:rest}`
    - OPT_SIMPLE_PATTERN for `{opt name}`
    - OPT_ARG_PATTERN for `{opt name(argtype)}`
    - OPT_ABBREV_ARG_PATTERN for `{opt abbrev:rest(argtype)}`
    - OPTH variants for hyperlinked options
    - SYNOPT_WRAPPER_PATTERN for `{synopt:{opt ...}}`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_
  - [x] 2.2 Implement extract_options_section function
    - Locate Options section using `{marker options}` or `{title:Options}`
    - Extract content until next section marker
    - Handle `{dlgtab:}` subsections
    - _Requirements: 2.1, 2.2, 2.4_
  - [x] 2.3 Implement parse_option_pattern function
    - Parse single option pattern and return ExtractedOption or null
    - Handle all pattern variants (abbrev, simple, with args)
    - Extract description text and clean SMCL tags
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.6, 5.3, 5.4_
  - [x] 2.4 Implement extract_options_from_section function
    - Find all option patterns in section
    - Parse each pattern using parse_option_pattern
    - Deduplicate by name (first occurrence wins)
    - Skip malformed patterns gracefully
    - _Requirements: 5.1, 5.2_
  - [x] 2.5 Update extract_commands_from_file to include options
    - Call extract_options_section and extract_options_from_section
    - Associate options with each extracted command
    - _Requirements: 3.2, 3.4_
  - [x] 2.6 Write property test for name and abbreviation extraction
    - **Property 1: Name and Abbreviation Extraction**
    - **Validates: Requirements 1.1, 1.2**
  - [x] 2.7 Write property test for argument detection
    - **Property 2: Argument Detection**
    - **Validates: Requirements 1.3, 1.4**
  - [x] 2.8 Write property test for synopt wrapper unwrapping
    - **Property 3: Synopt Wrapper Unwrapping**
    - **Validates: Requirements 1.5**
  - [x] 2.9 Write property test for description cleaning
    - **Property 4: Description Extraction and Cleaning**
    - **Validates: Requirements 1.6, 5.3, 5.4**

- [x] 3. Checkpoint - Verify extraction logic
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Update cache generation
  - [x] 4.1 Update generate-cache.ts to pass options through
    - Modify extract_minimal_metadata to include options from ExtractedCommand
    - Update CommandInfo construction to include options array
    - _Requirements: 4.1, 4.2_
  - [x] 4.2 Implement hardcoded options fallback
    - Create merge_options function to combine SMCL and BUILTIN_COMMANDS options
    - Convert BUILTIN_COMMANDS OptionInfo format to cache format
    - SMCL options take precedence over hardcoded
    - _Requirements: 7.1, 7.2, 7.3, 7.4_
  - [x] 4.3 Write property test for hardcoded options fallback
    - **Property 10: Hardcoded Options Fallback**
    - **Validates: Requirements 7.3, 7.4**

- [x] 5. Update CommandDatabase to expose options
  - [x] 5.1 Update to_provider_command_info in command-database/index.ts
    - Map cache OptionInfo to provider OptionInfo format
    - Convert min_abbreviation (number) to minAbbreviation (string)
    - _Requirements: 4.3, 4.4_
  - [x] 5.2 Write property test for cache round-trip
    - **Property 9: Cache Round-Trip**
    - **Validates: Requirements 8.1**

- [x] 6. Checkpoint - Verify cache integration
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Additional property tests
  - [x] 7.1 Write property test for options section boundary
    - **Property 5: Options Section Boundary**
    - **Validates: Requirements 2.1, 2.2, 2.4**
  - [x] 7.2 Write property test for malformed pattern resilience
    - **Property 6: Malformed Pattern Resilience**
    - **Validates: Requirements 5.1**
  - [x] 7.3 Write property test for duplicate deduplication
    - **Property 7: No Duplicate Options**
    - **Validates: Requirements 5.2**
  - [x] 7.4 Write property test for multi-command options
    - **Property 8: Multi-Command Options Association**
    - **Validates: Requirements 3.2, 3.4**

- [x] 8. Integration testing
  - [x] 8.1 Test extraction from real sthlp files
    - Test regress.sthlp (many options with abbreviations)
    - Test summarize.sthlp (simple options)
    - Test generate.sthlp (multi-command file)
    - Verify option counts match expected values
    - _Requirements: 8.2_
  - [x] 8.2 Regenerate command cache with options
    - Run generate-cache.ts to produce new cache
    - Verify cache includes options for commands
    - Verify existing completion tests pass
    - _Requirements: 6.3_

- [x] 9. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
