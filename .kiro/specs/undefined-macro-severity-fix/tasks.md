# Implementation Tasks

## Task 1: Remove undefined_symbol from DEFAULT_SETTINGS
- [ ] 1.1 Remove `undefined_symbol: 'warning'` from `cross_file.diagnostics` in `DEFAULT_SETTINGS` object in `src/server-handlers.ts`
**Validates: Requirement 3.1**

## Task 2: Update CrossFileConfig Type
- [ ] 2.1 Remove `undefined_symbol` field from `CrossFileConfig.diagnostics` interface in `src/types/index.ts`
**Validates: Requirement 3.5**

## Task 3: Update DiagnosticsProvider
- [ ] 3.1 Modify `convert_semantic_diagnostic` method in `src/providers/diagnostics.ts` to use individual severity settings directly instead of checking `cross_file.diagnostics.undefined_symbol`
**Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 3.2**

## Task 4: Remove Workspace Config Mapping
- [ ] 4.1 Remove the mapping for `undefinedSymbol` from `map_stata_lsp_json_to_partial_config` in `src/utils/workspace-config.ts`
**Validates: Requirement 3.3**

## Task 5: Remove Config Validator Logic
- [ ] 5.1 Remove validation for `undefined_symbol` from `validate_comment_formatting_config` in `src/utils/config-validator.ts`
**Validates: Requirement 3.4**

## Task 6: Update README Documentation
- [ ] 6.1 Remove `crossFile.diagnostics.undefinedSymbol` from the configuration table in `README.md`
- [ ] 6.2 Remove `undefinedSymbol` from the example `.sight.json` in `README.md`
**Validates: Requirement 3.6**

## Task 7: Update Test Files
- [ ] 7.1 Update `tests/test-config-helper.ts` to remove `undefined_symbol` from default cross_file config
- [ ] 7.2 Update `tests/property/diagnostic-suppression.test.ts` to test individual severity settings instead of `crossFile.diagnostics.undefinedSymbol`
- [ ] 7.3 Update `tests/property/config-mapping-type-safety.prop.test.ts` to remove `undefinedSymbol` mapping tests
- [ ] 7.4 Update `tests/property/rename-validation-comprehensive.prop.test.ts` to remove `undefinedSymbol` from generated configs
**Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2**

## Task 8: Property-Based Tests for Severity Settings
- [ ] 8.1 Write property test verifying `diagnostics.severity.undefinedMacro` is respected for all valid severity values
- [ ] 8.2 Write property test verifying `diagnostics.severity.undefinedVariable` is respected for all valid severity values
- [ ] 8.3 Write property test verifying default behavior when no severity settings are configured
**Validates: Properties 1, 2; Requirements 1.1-1.5, 2.1, 2.2**
