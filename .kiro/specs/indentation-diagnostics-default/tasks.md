# Implementation Plan: Indentation Diagnostics Default

## Overview

This implementation changes the default value of `diagnostics.indentation` from `true` to `false` and exposes the setting in VS Code's settings UI. The changes are minimal and localized to configuration files and documentation.

## Tasks

- [x] 1. Change server-side default value
  - [x] 1.1 Update DEFAULT_SETTINGS in server-handlers.ts
    - Change `diagnostics.indentation` from `true` to `false`
    - _Requirements: 1.1_

- [x] 1.2 Write unit test for default value
  - Verify `DEFAULT_SETTINGS.diagnostics.indentation === false`
  - _Requirements: 1.1_

- [x] 2. Add VS Code settings schema
  - [x] 2.1 Add sight.diagnostics.indentation to client/package.json
    - Add to `contributes.configuration.properties`
    - Type: boolean, default: false
    - Include description explaining the setting
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [x] 3. Checkpoint - Verify settings work
  - Ensure the setting appears in VS Code Settings UI when searching for "indentation"
  - Ensure the default behavior is no indentation diagnostics

- [x] 4. Update documentation
  - [x] 4.1 Update README Examples section
    - Add note below "Missing indentation" heading explaining diagnostics are disabled by default
    - Add link to Configuration section for enabling
    - _Requirements: 4.1, 4.2_

  - [x] 4.2 Update README Configuration section
    - Change default value in Diagnostics table from `true` to `false`
    - Add "Why Indentation Diagnostics Are Disabled by Default" subsection
    - Update `.sight.json` example to show `false` as default
    - _Requirements: 4.3, 4.4_

- [x] 5. Final checkpoint
  - Ensure all tests pass
  - Verify documentation is accurate

## Notes

- The implementation is minimal - only configuration defaults and documentation change
- No code logic changes are needed since the analyzer already respects the config value
- Property tests are not included since the existing test suite already covers the analyzer's config-respecting behavior
