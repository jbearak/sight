# Requirements Document

## Introduction

This feature addresses 9 architectural findings from a review of the Sight Stata LSP server. The findings cover resource lifecycle management, debounce correctness, handler allocation efficiency, cancellation token compliance, position lookup performance, map cleanup, logging overhead, and completion caching. Each finding maps to one or more requirements below.

## Glossary

- **LSP_Server**: The Sight Stata Language Server Protocol server process, implemented in `server-factory.ts` and `server-handlers.ts`
- **Debounce_Manager**: The `DocumentDebounceManager` class in `src/utils/debounce-manager.ts` that coalesces rapid document changes
- **Document_Store**: The `DocumentStore` class in `src/document-store.ts` that manages parsed document state (tokens, AST, symbols)
- **Workspace_Indexer**: The `WorkspaceIndexer` class in `src/indexer/index.ts` that scans workspace files for symbols
- **Scope_Resolver**: The `ScopeResolver` class in `src/scope-resolver/index.ts` that resolves cross-file directive chains
- **Forward_Scope_Resolver**: The `ForwardScopeResolver` class in `src/forward-scope-resolver/` that resolves forward call directives
- **Pending_Revalidations_Map**: The `Map<string, { cancelled: boolean }>` in `server-factory.ts` that tracks in-flight cross-file revalidation tokens
- **Handler_Dependencies**: The `HandlerDependencies` interface in `server-handlers.ts` that bundles provider references for request handlers
- **Validate_Text_Document**: The `validate_text_document` function in `server-factory.ts` that performs lex/parse/analyze and publishes diagnostics
- **Completion_Handler**: The completion request handler created by `create_completion_handler` in `server-handlers.ts`
- **CancellationToken**: The LSP `CancellationToken` passed to request handlers, used to detect when the client has cancelled a request

## Requirements

### Requirement 1: Graceful Shutdown and Resource Cleanup

**User Story:** As an LSP client, I want the server to cleanly release all resources on shutdown, so that no orphaned timers, dangling promises, or leaked memory persist after the server stops.

#### Acceptance Criteria

1. WHEN the LSP_Server receives a shutdown request, THE LSP_Server SHALL cancel all pending entries in the Pending_Revalidations_Map by setting each entry's `cancelled` flag to `true`
2. WHEN the LSP_Server receives a shutdown request, THE LSP_Server SHALL invoke a `dispose` method on the Debounce_Manager that cancels all pending timers and clears the parse queue
3. WHEN the LSP_Server receives a shutdown request, THE LSP_Server SHALL await all active update promises in the Document_Store before completing the shutdown response
4. WHEN the LSP_Server receives a shutdown request, THE LSP_Server SHALL dispose the Scope_Resolver and Forward_Scope_Resolver file caches
5. WHEN the Debounce_Manager `dispose` method is called, THE Debounce_Manager SHALL clear all pending timers, empty the parse queue, and reject further `schedule_validation` calls

### Requirement 2: Debounced Parse Pipeline

**User Story:** As a developer editing a Stata file, I want the server to coalesce rapid keystrokes into a single lex/parse/analyze cycle, so that the server does not perform redundant work on every character typed.

#### Acceptance Criteria

1. WHEN a document change event fires, THE LSP_Server SHALL defer the `document_store.update` call (lex/parse/analyze) into the Debounce_Manager callback rather than executing it eagerly
2. WHEN multiple document change events fire within the debounce window for the same URI, THE Debounce_Manager SHALL execute only one lex/parse/analyze cycle using the latest content
3. WHEN the debounced callback executes, THE LSP_Server SHALL perform the lex/parse/analyze cycle and then publish diagnostics within the same callback invocation

### Requirement 3: Cross-File Revalidation Through Debounce

**User Story:** As a developer working with multi-file Stata projects, I want cross-file revalidations to be coalesced through the debounce manager, so that rapid edits do not trigger redundant revalidation cascades.

#### Acceptance Criteria

1. WHEN a cross-file revalidation is triggered for a callee or caller document, THE LSP_Server SHALL route the revalidation through the Debounce_Manager instead of calling Validate_Text_Document directly via `setTimeout`
2. WHEN multiple revalidation requests arrive for the same URI within the debounce window, THE Debounce_Manager SHALL coalesce them into a single revalidation

### Requirement 4: Stable Handler Registration

**User Story:** As an LSP server maintainer, I want request handlers to be registered once and reuse a stable reference to dependencies, so that the server avoids allocating new closures and dependency objects on every request.

#### Acceptance Criteria

1. THE LSP_Server SHALL create each request handler (completion, hover, definition, references, document symbols, workspace symbols, formatting, range formatting, execute command) once during initialization and register the resulting function with the connection
2. WHEN a request handler needs access to provider references, THE LSP_Server SHALL read them from a mutable container object rather than constructing a new Handler_Dependencies object per request
3. WHEN provider instances are initialized after the connection is established, THE LSP_Server SHALL update the mutable container so that previously registered handlers see the new providers

### Requirement 5: CancellationToken Checking in Providers

**User Story:** As a developer working with large Stata files, I want the server to bail out of long-running hover, definition, and references computations when I move the cursor, so that stale requests do not block fresh ones.

#### Acceptance Criteria

1. WHEN a hover request is being processed and the CancellationToken signals cancellation, THE LSP_Server SHALL abort the hover computation and return null
2. WHEN a definition request is being processed and the CancellationToken signals cancellation, THE LSP_Server SHALL abort the definition computation and return null
3. WHEN a references request is being processed and the CancellationToken signals cancellation, THE LSP_Server SHALL abort the references computation and return null
4. WHEN a token scan or AST traversal loop runs inside a provider, THE provider SHALL check `token.isCancellationRequested` periodically (at minimum once per 500 iterations) and exit early when cancellation is detected

### Requirement 6: Efficient Token Position Lookup

**User Story:** As a developer hovering over tokens in a large Stata file, I want position lookups to complete in sub-linear time, so that hover and definition responses remain fast regardless of file size.

#### Acceptance Criteria

1. THE Document_Store SHALL provide a `get_token_at_position(line, character)` method on DocumentState that returns the token at a given position without scanning all tokens linearly
2. WHEN the `get_token_at_position` method is called, THE Document_Store SHALL use a precomputed index (line-bucketed token map or binary search over sorted token ranges) to locate the token in O(log n) or better time complexity
3. WHEN a document is updated, THE Document_Store SHALL rebuild the token position index as part of the update cycle

### Requirement 7: Pending Revalidations Map Cleanup

**User Story:** As an LSP server running for extended sessions, I want the pending revalidations map to be cleaned up after each revalidation completes, so that the map does not accumulate stale entries indefinitely.

#### Acceptance Criteria

1. WHEN a revalidation callback completes (either successfully or via cancellation), THE LSP_Server SHALL delete the corresponding entry from the Pending_Revalidations_Map
2. WHEN a new revalidation is scheduled for a URI that already has a pending entry, THE LSP_Server SHALL cancel the existing entry and replace it with the new one

### Requirement 8: Gated Debug Logging in Hot Paths

**User Story:** As an LSP server maintainer, I want verbose debug logging in the validation pipeline to be gated behind a configuration flag, so that production users do not pay the serialization and IPC cost of debug messages on every keystroke.

#### Acceptance Criteria

1. THE LSP_Server SHALL support a `debug` configuration setting that controls whether verbose logging is emitted during document validation
2. WHILE the `debug` setting is disabled, THE LSP_Server SHALL skip all `connection.console.log` calls in the Validate_Text_Document function and cross-file revalidation scheduling
3. WHILE the `debug` setting is disabled, THE LSP_Server SHALL skip the call to `scope_resolver.get_reverse_deps_debug_info()` to avoid building the debug string
4. WHILE the `debug` setting is enabled, THE LSP_Server SHALL emit the same verbose logging that currently exists unconditionally

### Requirement 9: Context-Aware Completion Caching

**User Story:** As a developer using autocompletion, I want the server to return `isIncomplete: false` when the completion list is exhaustive and not macro-related, so that the client can cache results and avoid redundant round-trips on every keystroke.

#### Acceptance Criteria

1. WHEN the Completion_Handler produces a completion list that is not in a macro context, THE Completion_Handler SHALL return `isIncomplete: false`
2. WHEN the Completion_Handler produces a completion list that is in a macro context (local macro, global macro, or compound quote trigger), THE Completion_Handler SHALL return `isIncomplete: true`
3. WHEN the Completion_Handler returns `isIncomplete: false`, THE completion list SHALL be exhaustive for the current trigger context
