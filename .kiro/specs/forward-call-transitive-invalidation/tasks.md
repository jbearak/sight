# Implementation Plan: Forward Call Transitive Invalidation

## Overview

This implementation ensures that when a callee file changes, all files that transitively depend on the callers via backward directives are also revalidated.

## Tasks

- [ ] 1. Update schedule_caller_revalidation to include backward directive dependents
  - [ ] 1.1 Modify `schedule_caller_revalidation` in server-factory.ts
    - For each caller URI, get its transitive backward directive dependents
    - Add all dependents to the revalidation set
    - Use existing `get_transitive_backward_directive_children()` method
    - Deduplicate URIs using a Set
    - _Requirements: 1.1, 1.2, 1.3, 2.3_

- [ ] 2. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 3. Integration testing
  - [ ] 3.1 Write integration test for forward call to backward directive propagation
    - Create four files: loop.do, import_metadata.do, survey.do, bh_vars.do
    - loop.do calls import_metadata.do and survey.do
    - survey.do has @lsp-done-by: loop.do
    - bh_vars.do has @lsp-included-by: survey.do
    - import_metadata.do defines global merp
    - bh_vars.do uses $merp
    - Edit import_metadata.do to remove global merp
    - Verify bh_vars.do gets updated diagnostics (undefined macro warning)
    - **Property 1: Callee Change Propagates to Backward Directive Dependents**
    - **Validates: Requirements 1.1, 1.2**

- [ ] 4. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- The fix is minimal: add ~10 lines to `schedule_caller_revalidation`
- Reuses existing `get_transitive_backward_directive_children()` method
- Uses Set for automatic deduplication

