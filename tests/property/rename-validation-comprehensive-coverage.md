# Rename Validation Property Tests - Comprehensive Coverage

This document outlines the comprehensive property-based tests created to verify the rename from "stata-lsp" to "sight" across all aspects of the codebase.

## Test Coverage Overview

### Property 1: Configuration Keys Use 'sight.' Prefix

**Tests:**
- `should verify all configuration keys in package.json use sight. prefix`
- `should verify configuration key structure follows sight.category.property pattern`
- `should verify DEFAULT_SETTINGS structure maps to sight. configuration`

**Coverage:**
- Validates all VS Code configuration keys start with `sight.`
- Ensures no legacy `stata-lsp.` or `stataLSP.` prefixes remain
- Verifies proper categorization (diagnostics, formatting, indexing, etc.)
- Confirms DEFAULT_SETTINGS structure aligns with sight configuration schema

### Property 2: Command Identifiers Use 'sight.' Prefix

**Tests:**
- `should verify all command identifiers in package.json use sight. prefix`
- `should verify server handler command registration uses sight. prefix`
- `should verify command naming consistency across package.json and server-handlers`

**Coverage:**
- Validates all VS Code commands start with `sight.`
- Ensures server-side command registration matches client-side declarations
- Verifies consistency between package.json and server-handlers.ts
- Confirms no legacy command prefixes remain

### Property 3: Diagnostic Sources Are 'sight'

**Tests:**
- `should verify diagnostic source naming convention`
- `should verify diagnostic source consistency in DiagnosticsProvider`

**Coverage:**
- Validates all diagnostic messages use "sight" as source
- Ensures no legacy "stata-lsp" or "stataLSP" sources remain
- Covers all diagnostic types (lexer, parser, semantic, context, directive, cross-file)
- Verifies DiagnosticsProvider implementation consistency

### Property 4: Config File Resolution Works with '.sight.json'

**Tests:**
- `should verify workspace config uses .sight.json filename`
- `should verify workspace config file references in source code`
- `should verify workspace config mapping function handles sight schema`
- `should verify config file path construction uses sight naming`

**Coverage:**
- Validates workspace configuration file is named `.sight.json`
- Ensures no references to `.stata-lsp.json` remain
- Verifies config mapping function handles sight schema correctly
- Tests path construction and file resolution logic

### Property 5: Comprehensive Rename Validation

**Tests:**
- `should verify no legacy stata-lsp references remain in key files`
- `should verify consistent naming across configuration hierarchy`
- `should verify package.json display name and description use Sight branding`
- `should verify configuration title uses Sight branding`

**Coverage:**
- Scans key files for any remaining legacy references
- Validates consistent "sight" branding across all components
- Ensures package metadata uses proper Sight branding
- Verifies configuration UI elements use correct naming

### Property 6: Cross-file Validation

**Tests:**
- `should verify all sight. prefixed items are properly categorized`
- `should verify workspace config schema completeness`

**Coverage:**
- Validates all sight-prefixed configurations have proper structure
- Ensures configuration descriptions don't contain legacy references
- Verifies workspace config schema handles all expected properties
- Tests mapping between public schema and internal configuration

## Property-Based Testing Approach

### Fast-Check Integration
- Uses `fast-check` library for property-based testing
- Generates test cases from actual configuration data
- Ensures comprehensive coverage of all configuration keys and commands

### Test Data Sources
- **Real Configuration**: Tests use actual package.json configuration keys
- **Source Code Analysis**: Extracts command identifiers from server-handlers.ts
- **File System Validation**: Checks actual file contents for legacy references

### Validation Patterns
- **Positive Assertions**: Verifies correct "sight" prefixes are present
- **Negative Assertions**: Ensures legacy "stata-lsp" references are absent
- **Structural Validation**: Confirms proper configuration hierarchy
- **Cross-Reference Validation**: Ensures consistency between related files

## Files Covered

### Client-Side Files
- `client/package.json` - Configuration schema, commands, branding
- `client/src/extension.ts` - Extension activation and commands

### Server-Side Files
- `src/server-handlers.ts` - Command registration and default settings
- `src/utils/workspace-config.ts` - Configuration file handling
- `src/providers/diagnostics.ts` - Diagnostic source attribution

### Documentation
- `README.md` - User-facing documentation and examples

## Test Execution

### Property Test Characteristics
- **Deterministic**: Uses actual configuration data as test inputs
- **Comprehensive**: Covers all configuration keys and commands
- **Exhaustive**: Tests every relevant file and code path
- **Maintainable**: Automatically adapts to configuration changes

### Coverage Metrics
- **Configuration Keys**: Tests all sight.* keys in package.json
- **Commands**: Validates all sight.* commands
- **File References**: Scans all relevant source files
- **Schema Mapping**: Tests all workspace configuration properties

## Benefits

### Regression Prevention
- Prevents accidental reintroduction of legacy naming
- Catches inconsistencies during development
- Validates rename completeness across the entire codebase

### Maintenance Assurance
- Automatically validates new configuration additions
- Ensures consistent naming conventions for future features
- Provides confidence in rename operation completeness

### Documentation Validation
- Verifies user-facing documentation uses correct naming
- Ensures configuration examples use proper prefixes
- Validates help text and descriptions are updated

This comprehensive test suite provides complete coverage of the rename validation requirements, ensuring that all aspects of the "stata-lsp" to "sight" rename are properly implemented and maintained.