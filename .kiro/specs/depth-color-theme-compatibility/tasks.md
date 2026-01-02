# Implementation Plan: Depth Color Theme Compatibility

## Overview

This implementation adds universal theme support for depth colors by using VS Code's theme detection API and a universal fallback selector. The changes are primarily in the client extension's depth-colors module.

## Tasks

- [x] 1. Add theme detection functions to depth-colors-core.ts
  - Add `isDarkTheme()` function that checks `ColorThemeKind`
  - Add `getThemeColorPalette()` function that returns appropriate palette
  - Add `isDepthColorRule()` helper to identify depth color rules
  - Export new functions for use in depth-colors.ts
  - _Requirements: 1.3, 2.1, 2.2_

- [x] 2. Update mergeDepthColors to include universal fallback
  - [x] 2.1 Modify `mergeDepthColors()` to add `[*]` selector rules
    - Keep existing `[*Dark*]` and `[*Light*]` selectors
    - Add universal `[*]` selector with runtime-detected colors
    - _Requirements: 1.1, 1.2, 3.1_
  - [x] 2.2 Write property test for universal color application
    - **Property 1: Universal Color Application**
    - **Validates: Requirements 1.1, 1.2**

- [x] 3. Implement theme-kind-appropriate palette selection
  - [x] 3.1 Update `buildUniversalDepthColorRules()` to use theme detection
    - Call `getThemeColorPalette()` to get appropriate colors
    - Build rules using the detected palette
    - _Requirements: 1.3, 2.1, 2.2_
  - [x] 3.2 Write property test for palette selection
    - **Property 2: Theme-Kind-Appropriate Palette Selection**
    - **Validates: Requirements 1.3, 2.1, 2.2**

- [x] 4. Implement theme change handler
  - [x] 4.1 Add `registerThemeChangeHandler()` function
    - Track previous theme kind state
    - Listen to `onDidChangeActiveColorTheme` event
    - Update universal fallback colors when kind changes
    - _Requirements: 2.3, 5.1, 5.2, 5.3_
  - [x] 4.2 Add `updateUniversalFallbackColors()` function
    - Remove existing universal depth rules
    - Add new rules based on current theme
    - _Requirements: 2.3, 5.3_
  - [x] 4.3 Write property test for theme change handling
    - **Property 3: Dynamic Theme Change Handling**
    - **Validates: Requirements 2.3, 5.1, 5.2, 5.3**

- [x] 5. Update extension.ts to register theme change handler
  - Import and call `registerThemeChangeHandler()` during activation
  - Add disposable to context.subscriptions
  - _Requirements: 5.1_

- [x] 6. Update hasDepthColorRules to check universal selector
  - Modify to also check `[*]` section for existing rules
  - Ensure backward compatibility with existing checks
  - _Requirements: 4.1, 4.2_

- [x] 7. Update resetDepthColors to handle universal selector
  - Remove depth rules from `[*]` section in addition to `[*Dark*]` and `[*Light*]`
  - Re-apply fresh rules to all three selectors
  - _Requirements: 4.3_

- [x] 8. Write property tests for preservation and reset
  - [x] 8.1 Write property test for user customization preservation
    - **Property 5: User Customization Preservation**
    - **Validates: Requirements 4.1, 4.2**
  - [x] 8.2 Write property test for reset functionality
    - **Property 6: Reset Functionality**
    - **Validates: Requirements 4.3**

- [x] 9. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Update README documentation
  - Document the universal theme support
  - Explain that colors now work with all themes
  - Update the "Automatic Color Configuration" section
  - _Requirements: 1.1, 1.2_

## Notes

- All tasks are required for comprehensive implementation
- Each task references specific requirements for traceability
- The implementation is primarily in `client/src/depth-colors-core.ts` and `client/src/depth-colors.ts`
- Property tests should use fast-check library (already used in the project)
