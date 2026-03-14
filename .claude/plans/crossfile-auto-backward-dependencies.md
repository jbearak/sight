# crossFile.backwardDependencies=auto

## Overview

Port from Raven the `backwardDependencies=auto` feature. When enabled (default),
the LSP auto-discovers parent files by scanning the workspace for `do`/`run`/`include`
commands, eliminating the need for `@lsp-done-by`/`@lsp-included-by` directives.

## Architecture

New `DependencyGraph` class alongside existing `ReverseDependencyIndex`.

- `DependencyGraph` maintains bidirectional edges from workspace scan + live edits
- `ScopeResolver.resolve()` synthesizes `Directive[]` from graph when auto mode + no explicit directives
- `has_auto_parents` field on `ResolvedScope` (separate from `has_directives`)
- Diagnostic deferral until workspace scan completes
- Config: `crossFile.backwardDependencies: 'auto' | 'explicit'` (default 'auto')

## Build Sequence

- [x] Phase 1: Types + DependencyGraph class
- [x] Phase 2: Indexer population
- [x] Phase 3: ScopeResolver integration
- [x] Phase 4: Config wiring
- [x] Phase 5: Diagnostics deferral
- [x] Phase 6: Completion provider adjustment
- [x] Phase 7: Server factory wiring
- [x] Phase 8: Comprehensive tests
