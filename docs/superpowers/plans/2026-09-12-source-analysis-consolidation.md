# Source analysis consolidation

## Evidence and decision

Reviewed against Sight `620b21ce` and Raven's consolidation history.
Three independent design reviews considered a focused cleanup, shared
source analysis, and a unified analysis store. This change takes the
bounded shared-analysis approach. It removes repeated computation and
shared algorithms without replacing document lifecycle ownership.

Raven's relevant changes:

- [3c1d65a5](https://github.com/jbearak/raven/commit/3c1d65a5156b2a23c14c7e3c2e904f05efeb428b)
  introduced a content provider with open-buffer precedence over indexed
  files and disk. A common interface needs an explicit authority rule.
- [dc3856d7](https://github.com/jbearak/raven/commit/dc3856d7dc0218ebe286d89a106f1681234bf5d8)
  routed diagnostics through the snapshot implementation. That migration
  had to preserve call-site snippets in cycle diagnostics.
- `166190b0` then removed the six superseded diagnostic collectors. Move
  consumers first, verify parity, and delete the old implementations.
- `ca9e8c76` and `527f0121` consolidated open and closed analysis
  ownership. [80f7da20](https://github.com/jbearak/raven/commit/80f7da2096ba9542f8157b4bf1947fb9ffae5592)
  completed substantial transactional installation and race handling.
  Sharing cached objects does not by itself prevent stale writers.
- `bf78d517`, `a58cf076`, and `9a0ce2b8` illustrate later correctness
  work around closed-artifact eviction, stale scans overwriting watcher
  updates, and scan reuse missing a closed-index revision.

## Existing behavior

`WorkspaceIndexer.index_file`, `ScopeResolver.parse_content`, and
`DocumentStore.create_document_state` each lex, parse, and analyze Stata
source. The indexer and resolver parse directives without passing their
token stream, causing comment helpers to lex again. The document store
passes tokens but reparses forward directives after its full directive
parse has already returned them.

All three paths assemble command and directive forward calls. Command
calls use the line-sensitive `cd` timeline; directive calls use the
file-wide working directory. The indexer sorts their combined list by
call-site line. The document store tolerates malformed-URI failures and
retains analyzer calls where projection fails.

The document store currently invokes full scope resolution just to get
an inherited working directory. This also analyzes the root file and
traverses execution scope before document analysis. Real diagnostics
subsequently request full scope resolution themselves.

Several apparent duplicates have separate responsibilities:

- CLI and LSP already use the same `DiagnosticsProvider`. Operator,
  indentation, syntax, and execution-scope checks are distinct rules.
- Workspace symbols support completion and navigation. Only execution
  scope suppresses undefined-symbol diagnostics.
- CLI target selection permits explicit excluded or external files and
  reports decoding failures. Index discovery has different selection,
  file-limit, and failure-reporting contracts.
- `.mata` indexing extracts function definitions through its own path.
- CLI workers intentionally have separate one-document stores, keeping
  diagnostics independent of parallel target order.

## Alternatives

A focused cleanup would only reuse existing token/directive results and
replace the working-directory probe. It has the smallest lifecycle risk,
but leaves shared parsing and forward-call algorithms in several places.

The chosen approach also gives closed-file parsing and forward-call
preparation one implementation. Its dependencies are in-process language
processing and existing filesystem/path-resolution helpers. It introduces
no new persistent cache or source-authority layer.

A unified analysis store could remove more parsing and disk reads across
indexing, scope resolution, and CLI diagnostics. It requires a separate
ownership migration. Semantic analysis mutates program signatures in the
AST and depends on workspace program metadata. An indexed semantic result
cannot substitute for an open-document result. A future store must model
these inputs, mutable results, open/disk generations, eviction, and
transactional graph updates before sharing complete analysis objects.

## Stages

1. Share closed-file parsing, pass its tokens into directive parsing, and
   reuse the document store's directive result. Add a focused document
   working-directory lookup consuming already-parsed directives. Preserve
   automatic parent selection, normalized directive order, cancellation,
   and the full resolver's depth convention. Keep index scanning's
   explicit-only working-directory lookup unchanged. Review this stage
   before proceeding.
2. Share forward-call preparation across all three owners. Preserve
   command versus directive working-directory semantics, ordering, and
   the document store's recovery behavior. Delete the old assembly code.
   Run a cold architectural review and regression checks.
3. Run independent line-ending, typecheck, test, and lint gates. Benchmark
   the base revision and final revision using identical workloads and
   compare diagnostics as well as work counts, latency, and memory. Open
   a PR, address CI and CodeRabbit findings, and merge when clean.

The focused working-directory probe deliberately stops warming the full
scope cache or registering ancestor backward relationships as incidental
effects. Genuine scope resolution retains those responsibilities. Parsed
ancestor files still populate the existing forward relationship cache.
DocumentStore continues staging its own backward registrations until a
current operation commits.

## Validation

Exercise automatic and explicit parents, working-directory precedence,
depth limits, standalone files, cancellation, and close/reopen races.
Compare forward-call results across all three consumers, including
in-script `cd`, directive calls, malformed URIs, and embedded languages.
Retain the existing cache, references, CLI determinism, and document
lifecycle suites.

The benchmark records actual lexer, parser, and semantic-analyzer work
alongside elapsed time and diagnostic output. Include cold workspace
indexing plus diagnostics and repeated edits. Report reductions without
claiming elimination of intentionally contextual semantic analysis.
