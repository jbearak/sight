# Rename Validation Property Tests

This document describes the comprehensive property-based tests created to validate the rename from "stata-lsp" to "sight" across the entire codebase.

## Test Coverage

### 1. Configuration Keys Use 'sight.' Prefix

**Property 1.1: Package.json Configuration Keys**
- Validates all configuration properties in `client/package.json` use the `sight.` prefix
- Tests every configuration key dynamically extracted from the package.json
- Ensures no legacy `stata-lsp.` prefixes remain

**Property 1.2: DEFAULT_SETTINGS Structure**
- Verifies the internal `DEFAULT_SETTINGS` structure matches expected sight configuration schema
- Validates nested properties for diagnostics, formatting, indexing, etc.
- Ensures the internal structure supports the sight.* configuration keys

### 2. Command Identifiers Use 'sight.' Prefix

**Property 2.1: Package.json Commands**
- Validates all command identifiers in `client/package.json` use the `sight.` prefix
- Tests every command dynamically extracted from the contributes.commands section

**Property 2.2: Server Handler Commands**
- Extracts command identifiers from `src/server-handlers.ts` executeCommandProvider
- Validates all server-side command registrations use the `sight.` prefix
- Ensures consistency between client and server command definitions

### 3. Diagnostic Sources Are 'sight'

**Property 3.1: Diagnostic Source Validation**
- Tests that all diagnostic types (lexer, parser, semantic, context, directive errors) use 'sight' as source
- Validates the diagnostic source field is consistently set to 'sight'

**Property 3.2: DiagnosticsProvider Consistency**
- Verifies the DiagnosticsProvider uses the correct 'sight' source
- Ensures no legacy 'stata-lsp' or 'stataLSP' sources remain

### 4. Config File Resolution Works with `sight.toml`

**Property 4.1: Config Filename Validation**
- Validates the active project config uses `sight.toml` as the filename
- Validates `.sight.json` is only detected as an unsupported stale config
- Ensures no legacy `.stata-lsp.json` references remain

**Property 4.2: Config Mapping Function**
- Tests the `map_public_config_to_partial_config` function with sight schema
- Validates proper mapping of crossFile configuration properties
- Uses property-based testing with generated valid configuration objects

**Property 4.3: Config Path Construction**
- Tests config file path construction uses sight naming convention
- Validates path.join operations produce correct `sight.toml` paths

### 5. Comprehensive Rename Validation

**Property 5.1: Legacy Reference Detection**
- Scans key files (package.json, server-handlers.ts, config-file types) for legacy references
- Ensures no `stata-lsp.`, `stataLSP.`, or `.stata-lsp.json` references remain
- Validates presence of appropriate sight references

**Property 5.2: Naming Consistency**
- Tests consistency across the entire naming hierarchy
- Validates all components use the same 'sight' base name
- Ensures coherent branding across configuration, commands, diagnostics, and files

## Property-Based Testing Approach

The tests use `fast-check` for property-based testing with the following strategies:

1. **Dynamic Extraction**: Configuration keys and commands are extracted dynamically from actual files, ensuring tests stay current with code changes.

2. **Comprehensive Coverage**: Tests cover all aspects of the rename - configuration, commands, diagnostics, and file naming.

3. **Negative Testing**: Tests explicitly check for absence of legacy references.

4. **Generated Inputs**: Uses property-based generation for configuration objects to test edge cases.

5. **File System Validation**: Tests read actual files to validate real-world usage.

## Test Execution

The tests run with varying numbers of iterations:
- Simple validation: 1-10 runs
- Dynamic extraction: Based on actual count of items found
- Generated inputs: 20-50 runs for thorough coverage

All tests follow the existing property test patterns in the codebase and integrate with the Bun test framework.

## Maintenance

These tests will automatically detect:
- New configuration keys that don't follow the sight.* pattern
- New commands that don't use the sight.* prefix
- Any reintroduction of legacy stata-lsp references
- Changes to the config file naming convention

The tests serve as both validation and documentation of the rename requirements.
