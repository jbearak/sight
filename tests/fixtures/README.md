# Test Fixtures

This directory contains Stata files used as test fixtures for the LSP test suite.

## Files

- `apple.do` - Test file for cross-file directive functionality
- `orange.do` - Test file with `@lsp-included-by: apple` directive for cross-file scope resolution

These files are referenced in integration tests and should not be deleted.
