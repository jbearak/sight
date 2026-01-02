# Sight LSP Specification Archival Execution Plan

## Executive Summary

This plan identifies 23 specifications for archival based on the strategic shift away from VS Code-specific functionality toward core LSP capabilities. The archival focuses on VS Code extension features that conflict with the current direction while preserving all core LSP functionality and maintaining dependency integrity.

## Archival Strategy

### Phase 1: VS Code Extension Features (Abandoned)
**Target: 15 specifications**
These specs focus on VS Code-specific functionality that conflicts with the core LSP direction.

#### Immediate Archival Candidates (No Dependencies)
1. `interactive-extension-management` - VS Code extension conflict detection
2. `extension-conflict-detection` - VS Code extension management  
3. `textmate-grammar-enhancement` - VS Code syntax highlighting
4. `textmate-command-sync` - VS Code grammar synchronization
5. `string-nesting-colorization` - VS Code color customization
6. `quote-snippets` - VS Code snippet functionality
7. `macos-bash-compatibility` - Installation script improvements
8. `binary-installation` - Installation process (conflicts with LSP focus)
9. `standalone-binary-distribution` - Distribution mechanism
10. `typescript-typecheck-integration` - Development tooling

#### Secondary Archival (After Dependency Resolution)
11. `macro-definition-highlighting` - Depends on textmate-grammar-enhancement
12. `user-configurable-settings` - Heavy VS Code configuration focus
13. `comment-style-normalization` - Formatting feature (lower priority)
14. `rename-to-sight` - Project renaming (completed or obsolete)
15. `completion-improvements` - Contains VS Code-specific completion features

### Phase 2: Completed/Superseded Features (Completed)
**Target: 5 specifications**
These specs appear to be completed or superseded by current implementation.

1. `case-sensitivity-fix` - Core bug fix likely completed
2. `single-quote-string-fix` - Lexer bug fix likely completed  
3. `nested-macro-reference-parsing` - Parser bug fix likely completed
4. `forvalues-parsing-fix` - Parser bug fix likely completed
5. `assignment-expression-parsing` - Parser enhancement likely completed

### Phase 3: Scope Reduction (Abandoned)
**Target: 3 specifications**
These specs are too ambitious for current scope or have technical constraints.

1. `incremental-parsing` - Complex performance optimization
2. `cooperative-async-parsing` - Complex performance optimization
3. `disk-symbol-cache` - Complex caching system

## Dependency Analysis

### Safe Archival Order

#### Round 1: No Dependencies
- `interactive-extension-management`
- `extension-conflict-detection` 
- `textmate-command-sync`
- `string-nesting-colorization`
- `macos-bash-compatibility`
- `typescript-typecheck-integration`
- `incremental-parsing`
- `cooperative-async-parsing`
- `disk-symbol-cache`

#### Round 2: After Round 1
- `textmate-grammar-enhancement` (after textmate-command-sync)
- `binary-installation` (after standalone-binary-distribution)
- `macro-definition-highlighting` (after textmate-grammar-enhancement)

#### Round 3: Complex Dependencies
- `quote-snippets` (check completion-improvements dependency)
- `user-configurable-settings` (check all VS Code config dependencies)
- `completion-improvements` (check quote-snippets dependency)
- `rename-to-sight` (check all project-wide references)

### Dependency Preservation

**Critical Dependencies to Maintain:**
- `stata-lsp` - Core foundation (DO NOT ARCHIVE)
- `forward-scope-resolution` - Core cross-file functionality (DO NOT ARCHIVE)
- `working-directory-inheritance` - Core path resolution (DO NOT ARCHIVE)
- `syntax-command-parsing` - Core parser functionality (DO NOT ARCHIVE)
- `option-extraction` - Core completion functionality (DO NOT ARCHIVE)

**Dependencies to Break Safely:**
- VS Code extension specs → Core LSP specs (archive VS Code side)
- Installation/distribution specs → Core functionality (archive installation side)
- Performance optimization specs → Core functionality (defer optimizations)

## Risk Mitigation

### Low Risk Archives
- Installation and distribution specs (external to core functionality)
- VS Code-specific UI and configuration specs
- Development tooling and build process specs
- Completed bug fixes and parser improvements

### Medium Risk Archives  
- Performance optimization specs (may be needed later)
- Advanced completion features (may impact user experience)
- Configuration management (may impact usability)

### High Risk Archives (Avoid)
- Core LSP functionality specs
- Cross-file resolution specs
- Fundamental parsing and analysis specs
- Active development specs with many dependents

## Execution Steps

### Step 1: Prepare Archive Structure ✓
- [x] Create `.kiro/specs/archive/` directory structure
- [x] Create README files for each archive category
- [x] Document archival process and criteria

### Step 2: Round 1 Archival (No Dependencies)
```bash
# Move specs with no dependencies
mv .kiro/specs/interactive-extension-management .kiro/specs/archive/abandoned/
mv .kiro/specs/extension-conflict-detection .kiro/specs/archive/abandoned/
mv .kiro/specs/textmate-command-sync .kiro/specs/archive/abandoned/
mv .kiro/specs/string-nesting-colorization .kiro/specs/archive/abandoned/
mv .kiro/specs/macos-bash-compatibility .kiro/specs/archive/abandoned/
mv .kiro/specs/typescript-typecheck-integration .kiro/specs/archive/abandoned/
mv .kiro/specs/incremental-parsing .kiro/specs/archive/abandoned/
mv .kiro/specs/cooperative-async-parsing .kiro/specs/archive/abandoned/
mv .kiro/specs/disk-symbol-cache .kiro/specs/archive/abandoned/
```

### Step 3: Round 2 Archival (After Dependencies Resolved)
```bash
# Move specs after their dependencies are archived
mv .kiro/specs/textmate-grammar-enhancement .kiro/specs/archive/abandoned/
mv .kiro/specs/standalone-binary-distribution .kiro/specs/archive/abandoned/
mv .kiro/specs/binary-installation .kiro/specs/archive/abandoned/
mv .kiro/specs/macro-definition-highlighting .kiro/specs/archive/abandoned/
```

### Step 4: Completed Features Archival
```bash
# Move completed bug fixes and features
mv .kiro/specs/case-sensitivity-fix .kiro/specs/archive/completed/
mv .kiro/specs/single-quote-string-fix .kiro/specs/archive/completed/
mv .kiro/specs/nested-macro-reference-parsing .kiro/specs/archive/completed/
mv .kiro/specs/forvalues-parsing-fix .kiro/specs/archive/completed/
mv .kiro/specs/assignment-expression-parsing .kiro/specs/archive/completed/
```

### Step 5: Complex Dependencies (Manual Review)
- Manually review `quote-snippets`, `user-configurable-settings`, `completion-improvements`
- Check for active cross-references in remaining specs
- Archive only if no active dependencies remain

### Step 6: Update Registry
- Update `.kiro/specs/REGISTRY.md` with archived status and dates
- Update cross-references in active specifications
- Regenerate dependency analysis

## Success Criteria

### Quantitative Targets
- Archive 23 specifications (22% of total)
- Reduce VS Code-specific specs from 88 to ~65
- Maintain all core LSP functionality specs (18 specs)
- Preserve all critical dependency chains

### Qualitative Targets
- Clear separation between core LSP and VS Code functionality
- Simplified specification landscape focused on core features
- Preserved ability to retrieve archived specs if needed
- Maintained development velocity on core features

## Rollback Plan

If archival causes issues:

1. **Immediate Rollback**: Move any problematic spec back to active status
2. **Dependency Restoration**: Restore any broken dependency chains
3. **Registry Update**: Update REGISTRY.md to reflect rollback
4. **Impact Assessment**: Analyze what went wrong and adjust strategy

## Post-Archival Maintenance

### Ongoing Tasks
- Monitor for references to archived specs in new development
- Update documentation to reflect archived functionality
- Maintain archive organization and documentation
- Periodic review of archived specs for potential retrieval

### Success Metrics
- Reduced complexity in active specification management
- Faster development velocity on core LSP features
- Clearer project scope and direction
- Maintained code quality and functionality