# Sight LSP Specification Archive

This directory contains archived specifications that are no longer active in the current development cycle. Specifications are organized into subdirectories based on their archival reason.

## Archive Categories

### completed/
Specifications that have been fully implemented and are no longer needed for active development. These specs served their purpose and their requirements have been integrated into the codebase.

### superseded/
Specifications that have been replaced by newer, more comprehensive specifications. The functionality may still be relevant, but the approach or design has been superseded by better solutions.

### abandoned/
Specifications that were started but abandoned due to changing requirements, technical constraints, or strategic decisions. These specs represent paths not taken and may contain valuable research or design insights.

## Archive Process

When archiving a specification:

1. **Move the entire spec directory** to the appropriate archive subdirectory
2. **Update the REGISTRY.md** to reflect the archived status and archive date
3. **Update any cross-references** in active specifications to note the archived status
4. **Preserve all original content** - do not modify the archived specification files
5. **Document the archival reason** in the archive category README

## Retrieval Process

Archived specifications can be retrieved if needed:

1. Move the spec directory back to the main specs directory
2. Update REGISTRY.md to mark as active
3. Review and update any outdated dependencies or cross-references
4. Ensure compatibility with current codebase and architecture

## Archive Metadata

Each archived specification retains its original:
- Requirements, design, and task documents
- Cross-reference information
- Dependency relationships
- Implementation artifacts

This ensures full traceability and enables future analysis or retrieval if needed.